import WebSocket from 'ws';
import type { AISMessage, VesselState } from '../types/index.ts';
import { decodeFlagFromMMSI } from '../services/mmsi-decoder.ts';
import { getVesselZone, getZoneBoundingBoxes } from '../services/zones.ts';
import { calculateRiskScore } from '../services/risk-scorer.ts';
import { bufferPosition, upsertVesselMetadata } from '../services/clickhouse.ts';

/**
 * AIS Stream Worker
 *
 * Connects to aisstream.io WebSocket API, processes vessel position reports
 * and static data messages, maintains an in-memory vessel state map, and
 * pushes updates for fan-out to WebSocket clients.
 *
 * Fallback: if the stream connects but stays silent for SILENCE_TIMEOUT_MS,
 * the worker automatically switches to demo mode with realistic mock vessels.
 * When real messages arrive again, demo mode is disabled.
 */

// In-memory vessel state
const vessels = new Map<number, VesselState>();

// Reconnection state
let reconnectAttempt = 0;
const MAX_RECONNECT_DELAY = 60_000;
const BASE_RECONNECT_DELAY = 5_000;

// Stats
let messageCount = 0;
let lastStatsLog = Date.now();
const STATS_LOG_INTERVAL = 30_000;

// Data source tracking
let dataSource: 'live' | 'demo' | 'offline' = 'offline';
let isStreamConnected = false;
let firstConnectionTime = 0; // Time of FIRST successful WS connection (never reset on reconnect)
let lastRealMessageTime = 0; // Time of last actual vessel message (0 = no vessel message ever)
let mockModeActive = false;
let mockIntervalId: ReturnType<typeof setInterval> | null = null;
let mockVesselsMmsis = new Set<number>();

// Silence detection: 3 minutes after first connection with no vessel messages → demo mode
const SILENCE_TIMEOUT_MS = 3 * 60_000; // 3 minutes
const SILENCE_CHECK_INTERVAL = 15_000; // Check every 15 seconds

// Callback for pushing updates to main server
type UpdateCallback = (type: string, data: unknown) => void;
let onUpdate: UpdateCallback = () => {};

/**
 * Set the callback for vessel updates (called from main server).
 */
export function setUpdateCallback(cb: UpdateCallback): void {
  onUpdate = cb;
}

/**
 * Get all current vessel states.
 */
export function getAllVessels(): VesselState[] {
  return Array.from(vessels.values());
}

/**
 * Get a single vessel by MMSI.
 */
export function getVessel(mmsi: number): VesselState | undefined {
  return vessels.get(mmsi);
}

/**
 * Get all vessels in a specific zone.
 */
export function getVesselsByZone(zone: string): VesselState[] {
  return Array.from(vessels.values()).filter((v) => v.zone === zone);
}

/**
 * Returns 'live' when real AIS data is flowing,
 * 'demo' when using simulated vessels due to stream silence,
 * 'offline' when not connected at all.
 */
export function getDataSource(): 'live' | 'demo' | 'offline' {
  return dataSource;
}

/**
 * Process a PositionReport message from AIS stream.
 */
function processPositionReport(msg: AISMessage): void {
  const pos = msg.Message.PositionReport;
  if (!pos || !pos.Valid) return;

  const mmsi = msg.MetaData.MMSI;
  const lat = pos.Latitude;
  const lon = pos.Longitude;

  const flagInfo = decodeFlagFromMMSI(mmsi);
  const zone = getVesselZone(lat, lon);

  const existing = vessels.get(mmsi);

  const now = Date.now();
  const aisGapMinutes = existing ? (now - existing.lastUpdate) / 60_000 : 0;

  const vessel: VesselState = {
    mmsi,
    name: msg.MetaData.ShipName?.trim() || existing?.name || `MMSI-${mmsi}`,
    shipType: existing?.shipType ?? 0,
    flag: flagInfo.code,
    latitude: lat,
    longitude: lon,
    speed: pos.Sog,
    course: pos.Cog,
    heading: pos.TrueHeading,
    navStatus: pos.NavigationalStatus,
    destination: existing?.destination ?? '',
    draught: existing?.draught ?? 0,
    imo: existing?.imo ?? 0,
    lastUpdate: now,
    riskScore: 0,
    zone,
  };

  const risk = calculateRiskScore(vessel, aisGapMinutes);
  vessel.riskScore = risk.score;

  vessels.set(mmsi, vessel);
  bufferPosition(vessel);
  onUpdate('vessel_update', vessel);

  if (risk.score >= 70 && (!existing || existing.riskScore < 70)) {
    onUpdate('alert', {
      timestamp: new Date().toISOString(),
      type: 'shadow_fleet',
      severity: risk.level,
      title: `High-risk vessel detected: ${vessel.name} (${mmsi})`,
      description: `Risk score ${risk.score}/100. Flag: ${flagInfo.name} (${flagInfo.code}). Zone: ${zone ?? 'unknown'}.`,
      evidence: JSON.stringify(risk.factors),
      resolved: false,
    });
  }
}

/**
 * Process a ShipStaticData message from AIS stream.
 */
function processStaticData(msg: AISMessage): void {
  const staticData = msg.Message.ShipStaticData;
  if (!staticData || !staticData.Valid) return;

  const mmsi = msg.MetaData.MMSI;
  const existing = vessels.get(mmsi);

  if (existing) {
    existing.name = staticData.Name?.trim() || existing.name;
    existing.shipType = staticData.Type;
    existing.imo = staticData.ImoNumber;
    existing.destination = staticData.Destination?.trim() || existing.destination;
    existing.draught = staticData.MaximumStaticDraught;

    const risk = calculateRiskScore(existing, 0);
    existing.riskScore = risk.score;

    vessels.set(mmsi, existing);

    upsertVesselMetadata({
      ...existing,
      callSign: staticData.CallSign,
      dimensionA: staticData.Dimension.A,
      dimensionB: staticData.Dimension.B,
      dimensionC: staticData.Dimension.C,
      dimensionD: staticData.Dimension.D,
    }).catch((err) => console.error('[AIS] Failed to upsert vessel metadata:', err));
  } else {
    const flagInfo = decodeFlagFromMMSI(mmsi);
    const lat = msg.MetaData.Latitude;
    const lon = msg.MetaData.Longitude;
    const zone = getVesselZone(lat, lon);

    const vessel: VesselState = {
      mmsi,
      name: staticData.Name?.trim() || `MMSI-${mmsi}`,
      shipType: staticData.Type,
      flag: flagInfo.code,
      latitude: lat,
      longitude: lon,
      speed: 0,
      course: 0,
      heading: 0,
      navStatus: 0,
      destination: staticData.Destination?.trim() || '',
      draught: staticData.MaximumStaticDraught,
      imo: staticData.ImoNumber,
      lastUpdate: Date.now(),
      riskScore: 0,
      zone,
    };

    const risk = calculateRiskScore(vessel, 0);
    vessel.riskScore = risk.score;

    vessels.set(mmsi, vessel);

    upsertVesselMetadata({
      ...vessel,
      callSign: staticData.CallSign,
      dimensionA: staticData.Dimension.A,
      dimensionB: staticData.Dimension.B,
      dimensionC: staticData.Dimension.C,
      dimensionD: staticData.Dimension.D,
    }).catch((err) => console.error('[AIS] Failed to upsert new vessel metadata:', err));
  }
}

/**
 * Log statistics periodically.
 */
function logStats(): void {
  const now = Date.now();
  if (now - lastStatsLog < STATS_LOG_INTERVAL) return;

  const elapsed = (now - lastStatsLog) / 1000;
  const rate = messageCount / elapsed;
  console.log(
    `[AIS] Stats: ${vessels.size} active vessels | ${rate.toFixed(1)} msg/s | mode=${dataSource}`,
  );

  messageCount = 0;
  lastStatsLog = now;
}

// ---- 50 Realistic mock vessels across all monitored zones ----

interface MockVesselDef {
  mmsi: number;
  name: string;
  shipType: number;
  lat: number;
  lon: number;
  speed: number;
  course: number;
  destination: string;
  imo: number;
  draught: number;
  navStatus?: number;
}

const MOCK_VESSELS: MockVesselDef[] = [
  // -----------------------------------------------
  // Norway → Murmansk corridor (lat 65-72, lon 5-40)
  // Shadow fleet tankers hauling Russian crude
  // -----------------------------------------------
  { mmsi: 351234001, name: 'OCEAN GLORY',      shipType: 80, lat: 68.5,  lon: 15.2, speed: 12.5, course: 45,  destination: 'MURMANSK',       imo: 9234567, draught: 14.5 },
  { mmsi: 636789002, name: 'LIBERTY STAR',     shipType: 81, lat: 69.1,  lon: 20.3, speed: 11.0, course: 50,  destination: 'NOVOROSSIYSK',   imo: 9345678, draught: 13.8 },
  { mmsi: 538456003, name: 'TRUST',            shipType: 80, lat: 70.2,  lon: 25.5, speed: 0.2,  course: 0,   destination: 'MURMANSK',       imo: 9456789, draught: 15.2, navStatus: 1 },
  { mmsi: 616123004, name: 'PHOENIX',          shipType: 82, lat: 67.8,  lon: 12.1, speed: 10.8, course: 60,  destination: 'PRIMORSK',       imo: 9567890, draught: 12.1 },
  { mmsi: 372100013, name: 'NORDIC SKY',       shipType: 80, lat: 71.2,  lon: 30.1, speed: 9.5,  course: 30,  destination: 'MURMANSK',       imo: 9678112, draught: 14.8 },
  { mmsi: 370200014, name: 'POLAR STAR',       shipType: 84, lat: 66.3,  lon: 8.5,  speed: 13.2, course: 55,  destination: 'MURMANSK',       imo: 9789223, draught: 13.5 },
  { mmsi: 273100015, name: 'VOLGA EXPRESS',    shipType: 80, lat: 69.8,  lon: 35.2, speed: 8.0,  course: 20,  destination: 'MURMANSK',       imo: 9890334, draught: 16.0 },
  { mmsi: 370300016, name: 'ARCTIC PRIDE',     shipType: 81, lat: 70.5,  lon: 22.3, speed: 0.1,  course: 0,   destination: 'MURMANSK',       imo: 9901445, draught: 15.5, navStatus: 1 },
  { mmsi: 311000017, name: 'FORTUNE II',       shipType: 80, lat: 68.1,  lon: 14.7, speed: 11.5, course: 48,  destination: 'PRIMORSK',       imo: 9012556, draught: 14.0 },
  { mmsi: 636100018, name: 'SERENITY',         shipType: 81, lat: 71.0,  lon: 28.5, speed: 10.0, course: 35,  destination: 'MURMANSK',       imo: 9123667, draught: 13.2 },
  { mmsi: 229100019, name: 'NORTHERN GLORY',  shipType: 71, lat: 65.8,  lon: 6.2,  speed: 14.5, course: 70,  destination: 'ROTTERDAM',      imo: 9234778, draught: 9.5 },
  { mmsi: 257100008, name: 'NORDIC EXPLORER', shipType: 80, lat: 56.2,  lon: 3.5,  speed: 14.2, course: 0,   destination: 'ROTTERDAM',      imo: 9901234, draught: 11.5 },

  // -----------------------------------------------
  // Strait of Hormuz (lat 22-28, lon 52-60)
  // World's most critical chokepoint - 20% of global oil
  // -----------------------------------------------
  { mmsi: 422100005, name: 'IRAN TANKER 7',   shipType: 80, lat: 25.5,  lon: 56.2, speed: 8.5,  course: 270, destination: 'FUJAIRAH',       imo: 9678901, draught: 16.0 },
  { mmsi: 470200006, name: 'EMIRATES GRACE',  shipType: 81, lat: 26.1,  lon: 55.8, speed: 9.2,  course: 90,  destination: 'BANDAR ABBAS',   imo: 9789012, draught: 14.2 },
  { mmsi: 351567007, name: 'PACIFIC DREAM',   shipType: 80, lat: 25.8,  lon: 56.5, speed: 7.1,  course: 180, destination: 'BASRA',          imo: 9890123, draught: 15.8 },
  { mmsi: 470300021, name: 'AL RAWDAH',       shipType: 80, lat: 24.5,  lon: 58.5, speed: 10.5, course: 270, destination: 'JEBEL ALI',      imo: 9456112, draught: 14.8 },
  { mmsi: 422200022, name: 'CASPIAN STAR',    shipType: 80, lat: 25.2,  lon: 54.3, speed: 0.3,  course: 0,   destination: 'KHARG ISLAND',   imo: 9567223, draught: 18.5, navStatus: 1 },
  { mmsi: 470400023, name: 'GULF PROGRESS',   shipType: 70, lat: 26.5,  lon: 57.2, speed: 12.0, course: 80,  destination: 'DUBAI',          imo: 9678334, draught: 10.2 },
  { mmsi: 219100024, name: 'MAERSK HONAM',    shipType: 71, lat: 24.8,  lon: 59.5, speed: 16.5, course: 260, destination: 'SINGAPORE',      imo: 9789445, draught: 12.8 },
  { mmsi: 311200025, name: 'GLORY III',       shipType: 80, lat: 25.0,  lon: 55.5, speed: 6.5,  course: 170, destination: 'KHARK',          imo: 9890556, draught: 17.0 },
  { mmsi: 422300026, name: 'SABITI',          shipType: 84, lat: 26.8,  lon: 53.5, speed: 4.5,  course: 200, destination: 'BANDAR IMAM',    imo: 9901667, draught: 15.5 },
  { mmsi: 422400027, name: 'HORMUZ EXPRESS',  shipType: 80, lat: 23.8,  lon: 58.8, speed: 9.8,  course: 280, destination: 'BANDAR ABBAS',   imo: 9012778, draught: 16.8 },
  { mmsi: 311300028, name: 'PERSIAN GULF',    shipType: 80, lat: 25.3,  lon: 57.0, speed: 8.2,  course: 90,  destination: 'FUJAIRAH',       imo: 9123889, draught: 15.2 },
  { mmsi: 538100030, name: 'OCEAN WINNER',    shipType: 80, lat: 24.2,  lon: 59.2, speed: 0.2,  course: 0,   destination: 'FUJAIRAH',       imo: 9345001, draught: 14.5, navStatus: 1 },
  { mmsi: 422500031, name: 'GULF SUPPLIER',   shipType: 80, lat: 27.1,  lon: 54.0, speed: 7.8,  course: 130, destination: 'BANDAR IMAM',    imo: 9456112, draught: 16.2 },
  { mmsi: 311400032, name: 'STRAIT MASTER',   shipType: 83, lat: 25.7,  lon: 58.3, speed: 9.5,  course: 265, destination: 'SINGAPORE',      imo: 9567223, draught: 13.8 },

  // -----------------------------------------------
  // North Sea (lat 50-62, lon -5-10)
  // European oil hub, UK/Norway offshore fields
  // -----------------------------------------------
  { mmsi: 211200009, name: 'HANSEAT',         shipType: 70, lat: 54.8,  lon: 7.1,  speed: 16.5, course: 315, destination: 'HAMBURG',        imo: 9012345, draught: 8.2 },
  { mmsi: 232300010, name: 'BRITISH RESOLVE', shipType: 81, lat: 58.5,  lon: -1.2, speed: 12.0, course: 180, destination: 'IMMINGHAM',      imo: 9123456, draught: 13.0 },
  { mmsi: 219200033, name: 'MAERSK NAVIGATOR',shipType: 71, lat: 55.5,  lon: 8.2,  speed: 15.5, course: 290, destination: 'FELIXSTOWE',     imo: 9678334, draught: 11.5 },
  { mmsi: 257200034, name: 'HEIDRUN',         shipType: 79, lat: 60.2,  lon: 5.8,  speed: 8.5,  course: 180, destination: 'STAVANGER',      imo: 9789445, draught: 7.8 },
  { mmsi: 246100035, name: 'TRITON',          shipType: 70, lat: 52.5,  lon: 3.8,  speed: 13.2, course: 270, destination: 'ROTTERDAM',      imo: 9890556, draught: 9.2 },
  { mmsi: 232400036, name: 'MSC BELFAST',     shipType: 71, lat: 54.2,  lon: -5.5, speed: 18.0, course: 45,  destination: 'ANTWERP',        imo: 9901667, draught: 13.5 },
  { mmsi: 246200037, name: 'ROTTERDAM SPIRIT',shipType: 80, lat: 51.8,  lon: 4.2,  speed: 10.5, course: 340, destination: 'ROTTERDAM',      imo: 9012778, draught: 12.0 },
  { mmsi: 232500038, name: 'SHETLAND PIONEER',shipType: 79, lat: 59.5,  lon: -2.8, speed: 9.8,  course: 200, destination: 'ABERDEEN',       imo: 9123889, draught: 6.5 },
  { mmsi: 257300039, name: 'NORTH SEA GIANT', shipType: 80, lat: 57.8,  lon: 2.5,  speed: 11.2, course: 170, destination: 'HOUND POINT',    imo: 9234001, draught: 14.2 },
  { mmsi: 246300046, name: 'DUTCH CARRIER',   shipType: 71, lat: 53.2,  lon: 5.5,  speed: 14.8, course: 315, destination: 'AMSTERDAM',      imo: 9345112, draught: 9.8 },

  // -----------------------------------------------
  // Suez Canal (lat 27-32, lon 30-36)
  // Asia-Europe chokepoint, 12% of global trade
  // -----------------------------------------------
  { mmsi: 622400011, name: 'SUEZ PRIDE',      shipType: 70, lat: 30.5,  lon: 32.3, speed: 6.0,  course: 170, destination: 'SUEZ',           imo: 9234568, draught: 10.5 },
  { mmsi: 538700012, name: 'FORTUNE',         shipType: 80, lat: 31.2,  lon: 32.5, speed: 5.5,  course: 350, destination: 'MURMANSK',       imo: 9345679, draught: 14.0 },
  { mmsi: 416100040, name: 'EVER ATLAS',      shipType: 71, lat: 29.8,  lon: 32.6, speed: 8.5,  course: 160, destination: 'TANJUNG PELEPAS',imo: 9456790, draught: 13.5 },
  { mmsi: 622500041, name: 'AL JAZEERA',      shipType: 70, lat: 30.1,  lon: 32.4, speed: 7.2,  course: 175, destination: 'PORT SAID',      imo: 9567901, draught: 9.8 },
  { mmsi: 255100042, name: 'MEDSTAR',         shipType: 80, lat: 31.5,  lon: 32.5, speed: 6.8,  course: 340, destination: 'ALGIERS',        imo: 9679012, draught: 14.5 },
  { mmsi: 255200043, name: 'MSC ANYA',        shipType: 71, lat: 29.2,  lon: 32.7, speed: 0.2,  course: 0,   destination: 'PORT SAID',      imo: 9780123, draught: 12.0, navStatus: 1 },
  { mmsi: 370400044, name: 'ORIENT PEARL',    shipType: 71, lat: 31.8,  lon: 32.4, speed: 7.5,  course: 350, destination: 'ROTTERDAM',      imo: 9891234, draught: 11.8 },
  { mmsi: 622600045, name: 'CANAL MASTER',    shipType: 70, lat: 30.8,  lon: 32.3, speed: 5.8,  course: 165, destination: 'SUEZ',           imo: 9902345, draught: 10.2 },
];

/**
 * Activate demo/mock mode with 50 realistic pre-defined vessels.
 * Called when AISstream connects but stays silent.
 */
function activateMockMode(): void {
  if (mockModeActive) return; // Already running

  console.log('[AIS] Stream silent for 3+ minutes. Activating DEMO mode with pre-defined vessels...');
  mockModeActive = true;
  dataSource = 'demo';

  // Clear any existing live vessels (none if stream was silent anyway)
  vessels.clear();
  mockVesselsMmsis.clear();

  // Populate all mock vessels
  for (const mv of MOCK_VESSELS) {
    const flagInfo = decodeFlagFromMMSI(mv.mmsi);
    const zone = getVesselZone(mv.lat, mv.lon);

    const vessel: VesselState = {
      mmsi: mv.mmsi,
      name: mv.name,
      shipType: mv.shipType,
      flag: flagInfo.code,
      latitude: mv.lat,
      longitude: mv.lon,
      speed: mv.speed,
      course: mv.course,
      heading: mv.course,
      navStatus: mv.navStatus ?? (mv.speed < 0.5 ? 1 : 0),
      destination: mv.destination,
      draught: mv.draught,
      imo: mv.imo,
      lastUpdate: Date.now(),
      riskScore: 0,
      zone,
    };

    const risk = calculateRiskScore(vessel, 0);
    vessel.riskScore = risk.score;
    vessels.set(mv.mmsi, vessel);
    mockVesselsMmsis.add(mv.mmsi);

    bufferPosition(vessel);
    onUpdate('vessel_update', vessel);
  }

  console.log(`[AIS] DEMO mode: loaded ${MOCK_VESSELS.length} vessels across all zones`);

  // Simulate realistic movement every 10 seconds
  mockIntervalId = setInterval(() => {
    for (const mmsi of mockVesselsMmsis) {
      const vessel = vessels.get(mmsi);
      if (!vessel) continue;

      const speedKnots = vessel.speed;
      const courseRad = (vessel.course * Math.PI) / 180;
      const dt = 10 / 3600; // 10 seconds in hours

      // Move vessel along its course
      const dLat = (speedKnots * dt * Math.cos(courseRad)) / 60;
      const dLon = (speedKnots * dt * Math.sin(courseRad)) / (60 * Math.cos((vessel.latitude * Math.PI) / 180));

      vessel.latitude += dLat + (Math.random() - 0.5) * 0.001;
      vessel.longitude += dLon + (Math.random() - 0.5) * 0.001;

      // Small speed variation
      vessel.speed = Math.max(0, vessel.speed + (Math.random() - 0.5) * 0.3);

      // Small course variation
      vessel.course = (vessel.course + (Math.random() - 0.5) * 1.5 + 360) % 360;
      vessel.heading = vessel.course;

      vessel.zone = getVesselZone(vessel.latitude, vessel.longitude);
      vessel.lastUpdate = Date.now();

      const risk = calculateRiskScore(vessel, 0);
      vessel.riskScore = risk.score;

      vessels.set(mmsi, vessel);
      bufferPosition(vessel);
      onUpdate('vessel_update', vessel);
    }

    logStats();
    messageCount += mockVesselsMmsis.size;
  }, 10_000);
}

/**
 * Deactivate demo mode - called when real AIS messages start arriving again.
 */
function deactivateMockMode(): void {
  if (!mockModeActive) return;

  console.log('[AIS] Real AIS data received - switching from DEMO to LIVE mode');
  mockModeActive = false;
  dataSource = 'live';

  if (mockIntervalId !== null) {
    clearInterval(mockIntervalId);
    mockIntervalId = null;
  }

  // Remove mock vessels from state (real vessels will be added as messages arrive)
  for (const mmsi of mockVesselsMmsis) {
    vessels.delete(mmsi);
  }
  mockVesselsMmsis.clear();
}

/**
 * Start the offline/no-key mock mode (API key missing entirely).
 */
function startOfflineMockMode(): void {
  console.log('[AIS] Starting DEMO mode (no API key)...');
  dataSource = 'demo';
  mockModeActive = true;

  for (const mv of MOCK_VESSELS) {
    const flagInfo = decodeFlagFromMMSI(mv.mmsi);
    const zone = getVesselZone(mv.lat, mv.lon);

    const vessel: VesselState = {
      mmsi: mv.mmsi,
      name: mv.name,
      shipType: mv.shipType,
      flag: flagInfo.code,
      latitude: mv.lat,
      longitude: mv.lon,
      speed: mv.speed,
      course: mv.course,
      heading: mv.course,
      navStatus: mv.navStatus ?? (mv.speed < 0.5 ? 1 : 0),
      destination: mv.destination,
      draught: mv.draught,
      imo: mv.imo,
      lastUpdate: Date.now(),
      riskScore: 0,
      zone,
    };

    const risk = calculateRiskScore(vessel, 0);
    vessel.riskScore = risk.score;
    vessels.set(mv.mmsi, vessel);
    mockVesselsMmsis.add(mv.mmsi);

    bufferPosition(vessel);
    onUpdate('vessel_update', vessel);
  }

  console.log(`[AIS] DEMO mode: loaded ${MOCK_VESSELS.length} vessels`);

  // Simulate movement every 10 seconds
  mockIntervalId = setInterval(() => {
    for (const mmsi of mockVesselsMmsis) {
      const vessel = vessels.get(mmsi);
      if (!vessel) continue;

      const speedKnots = vessel.speed;
      const courseRad = (vessel.course * Math.PI) / 180;
      const dt = 10 / 3600;

      const dLat = (speedKnots * dt * Math.cos(courseRad)) / 60;
      const dLon = (speedKnots * dt * Math.sin(courseRad)) / (60 * Math.cos((vessel.latitude * Math.PI) / 180));

      vessel.latitude += dLat + (Math.random() - 0.5) * 0.001;
      vessel.longitude += dLon + (Math.random() - 0.5) * 0.001;

      vessel.speed = Math.max(0, vessel.speed + (Math.random() - 0.5) * 0.3);
      vessel.course = (vessel.course + (Math.random() - 0.5) * 1.5 + 360) % 360;
      vessel.heading = vessel.course;

      vessel.zone = getVesselZone(vessel.latitude, vessel.longitude);
      vessel.lastUpdate = Date.now();

      const risk = calculateRiskScore(vessel, 0);
      vessel.riskScore = risk.score;

      vessels.set(mmsi, vessel);
      bufferPosition(vessel);
      onUpdate('vessel_update', vessel);
    }

    logStats();
    messageCount += mockVesselsMmsis.size;
  }, 10_000);
}

/**
 * Connect to AIS stream WebSocket.
 */
function connect(): void {
  const apiKey = process.env['AISSTREAM_API_KEY'];
  if (!apiKey || apiKey === 'placeholder_get_real_key') {
    console.warn('[AIS] No valid AISSTREAM_API_KEY set. Running in DEMO mode.');
    console.warn('[AIS] Get a free key at https://aisstream.io');
    startOfflineMockMode();
    return;
  }

  console.log('[AIS] Connecting to aisstream.io...');

  const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');

  ws.on('open', () => {
    console.log('[AIS] WebSocket connected');
    reconnectAttempt = 0;
    isStreamConnected = true;

    // Only set firstConnectionTime once - reconnects don't reset the silence clock
    if (firstConnectionTime === 0) {
      firstConnectionTime = Date.now();
      console.log('[AIS] First connection established - silence clock started');
    }

    // Keep 'live' or 'demo' state on reconnect; only 'offline' gets set here initially
    if (dataSource === 'offline') {
      dataSource = 'offline'; // Will be updated when vessel messages arrive or demo activates
    }
    // If already 'live' or 'demo', don't change - preserve state across reconnects

    const boundingBoxes = getZoneBoundingBoxes();

    const subscription = {
      APIKey: apiKey,
      BoundingBoxes: boundingBoxes,
      FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
    };

    const subJson = JSON.stringify(subscription);
    ws.send(subJson);
    console.log(`[AIS] Subscribed to ${boundingBoxes.length} zones`);
    console.log(`[AIS] Subscription payload: ${subJson.substring(0, 300)}`);
    console.log(`[AIS] Silence watchdog armed: demo mode activates in ${SILENCE_TIMEOUT_MS / 60000} min if no messages arrive`);

    onUpdate('status', {
      type: 'ais_connected',
      zones: boundingBoxes.length,
      timestamp: new Date().toISOString(),
    });
  });

  ws.on('message', (data: WebSocket.Data) => {
    try {
      const raw = data.toString();
      const msg = JSON.parse(raw) as AISMessage;
      messageCount++;

      // Debug: log first 5 messages to understand format
      if (messageCount <= 5) {
        console.log(`[AIS] DEBUG msg #${messageCount} type=${msg.MessageType} keys=${Object.keys(msg.Message || {}).join(',')}`);
        if (msg.MetaData?.MMSI) {
          console.log(`[AIS] DEBUG MetaData: MMSI=${msg.MetaData.MMSI} Name=${msg.MetaData.ShipName} Lat=${msg.MetaData.Latitude} Lon=${msg.MetaData.Longitude}`);
        } else {
          // Control/status message from AISstream (connection confirmation, rate-limit notices, etc.)
          console.log(`[AIS] DEBUG control msg: ${raw.substring(0, 200)}`);
        }
      }

      // Guard: skip messages without vessel data (error responses, control messages, etc.)
      if (!msg.Message) {
        return;
      }

      // Only count actual vessel messages for silence detection
      // Control messages (MessageType: AisErrorResponse, ControlMessage, etc.) don't reset the timer
      const isVesselMessage = !!(msg.Message.PositionReport || msg.Message.ShipStaticData);

      if (isVesselMessage) {
        // Real vessel data received - reset silence timer, switch from demo if needed
        lastRealMessageTime = Date.now();
        if (dataSource !== 'live') {
          console.log(`[AIS] First real vessel data received! Switching to LIVE mode.`);
          dataSource = 'live';
          if (mockModeActive) {
            deactivateMockMode();
          }
        }
      }

      if (msg.Message.PositionReport) {
        processPositionReport(msg);
      } else if (msg.Message.ShipStaticData) {
        processStaticData(msg);
      }

      if (messageCount % 50 === 0) {
        console.log(`[AIS] Processed ${messageCount} msgs, ${vessels.size} vessels tracked (${dataSource})`);
      }

      logStats();
    } catch (err) {
      console.error('[AIS] Failed to parse message:', err);
      console.error('[AIS] Raw data (first 200 chars):', data.toString().substring(0, 200));
    }
  });

  ws.on('error', (err) => {
    console.error('[AIS] WebSocket error:', err.message);
  });

  ws.on('close', (code, reason) => {
    console.warn(`[AIS] WebSocket closed: ${code} ${reason.toString()}`);
    isStreamConnected = false;
    // Don't change dataSource here - keep showing whatever data we have
    scheduleReconnect();
  });
}

/**
 * Schedule reconnection with exponential backoff.
 */
function scheduleReconnect(): void {
  const delay = Math.min(
    BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempt),
    MAX_RECONNECT_DELAY,
  );
  reconnectAttempt++;

  console.log(`[AIS] Reconnecting in ${(delay / 1000).toFixed(0)}s (attempt ${reconnectAttempt})`);

  setTimeout(() => {
    connect();
  }, delay);
}

/**
 * Silence watchdog: if we've been connected for SILENCE_TIMEOUT_MS with no real vessel messages,
 * activate demo mode. Uses firstConnectionTime so reconnects don't reset the clock.
 */
function startSilenceWatchdog(): void {
  setInterval(() => {
    if (firstConnectionTime === 0) return; // Never connected yet
    if (mockModeActive) return; // Already in demo mode
    if (lastRealMessageTime > 0) return; // Real vessel data has arrived at some point

    const silenceDuration = Date.now() - firstConnectionTime;
    if (silenceDuration > SILENCE_TIMEOUT_MS) {
      console.warn(`[AIS] ${Math.round(silenceDuration / 1000)}s since first connection, 0 vessel messages received.`);
      console.warn(`[AIS] AISstream.io appears silent. See: github.com/aisstream/aisstream/issues`);
      activateMockMode();
    } else {
      console.log(`[AIS] Silence watchdog: ${Math.round(silenceDuration / 1000)}s elapsed, waiting for vessel data (demo mode in ${Math.round((SILENCE_TIMEOUT_MS - silenceDuration) / 1000)}s if none arrives)`);
    }
  }, SILENCE_CHECK_INTERVAL);
}

/**
 * Start the AIS worker.
 */
export function startAISWorker(): void {
  console.log('[AIS] Worker starting...');
  connect();

  // Start silence watchdog
  startSilenceWatchdog();

  // Periodic cleanup: remove non-mock vessels not seen in 2 hours
  setInterval(() => {
    const cutoff = Date.now() - 2 * 3600_000;
    let removed = 0;
    for (const [mmsi, vessel] of vessels) {
      if (!mockVesselsMmsis.has(mmsi) && vessel.lastUpdate < cutoff) {
        vessels.delete(mmsi);
        removed++;
      }
    }
    if (removed > 0) {
      console.log(`[AIS] Cleaned up ${removed} stale vessels`);
    }
  }, 300_000); // Every 5 minutes
}
