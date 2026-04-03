import { createClient, type ClickHouseClient } from '@clickhouse/client';
import type { VesselState, PriceUpdate, NewsEvent, ZoneStats } from '../types/index.ts';
import { ZONES } from './zones.ts';

let client: ClickHouseClient | null = null;

// Batch buffer for AIS positions
let positionBuffer: Array<Record<string, unknown>> = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

const FLUSH_INTERVAL_MS = 5_000;
const BATCH_SIZE_LIMIT = 1000;

/**
 * Initialize ClickHouse client connection.
 */
export function initClickHouse(): ClickHouseClient {
  if (client) return client;

  const host = process.env['CLICKHOUSE_HOST'] ?? 'localhost';
  const port = process.env['CLICKHOUSE_PORT'] ?? '8123';
  const database = process.env['CLICKHOUSE_DB'] ?? 'deepscope';
  const username = process.env['CLICKHOUSE_USER'] ?? 'default';
  const password = process.env['CLICKHOUSE_PASSWORD'] ?? 'deepscope123';

  client = createClient({
    url: `http://${host}:${port}`,
    database,
    username,
    password,
    clickhouse_settings: {
      async_insert: 1,
      wait_for_async_insert: 0,
    },
  });

  // Start periodic flush
  flushTimer = setInterval(() => {
    flushPositionBuffer().catch((err) =>
      console.error('[ClickHouse] Flush error:', err),
    );
  }, FLUSH_INTERVAL_MS);

  console.log(`[ClickHouse] Connected to ${host}:${port}/${database}`);
  return client;
}

/**
 * Get the ClickHouse client, initializing if needed.
 */
export function getClient(): ClickHouseClient {
  if (!client) return initClickHouse();
  return client;
}

/**
 * Close the ClickHouse connection and flush remaining data.
 */
export async function closeClickHouse(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  // Flush remaining positions
  await flushPositionBuffer();
  if (client) {
    await client.close();
    client = null;
  }
}

// ---- Batch Insert: AIS Positions ----

/**
 * Add an AIS position to the write buffer. Flushes automatically every 5s or at 1000 records.
 */
export function bufferPosition(vessel: VesselState): void {
  positionBuffer.push({
    timestamp: new Date(vessel.lastUpdate).toISOString(),
    mmsi: vessel.mmsi,
    ship_name: vessel.name,
    ship_type: vessel.shipType,
    flag: vessel.flag,
    latitude: vessel.latitude,
    longitude: vessel.longitude,
    sog: vessel.speed,
    cog: vessel.course,
    heading: vessel.heading,
    nav_status: vessel.navStatus,
    destination: vessel.destination,
    draught: vessel.draught,
    imo: vessel.imo,
    zone: vessel.zone,
  });

  if (positionBuffer.length >= BATCH_SIZE_LIMIT) {
    flushPositionBuffer().catch((err) =>
      console.error('[ClickHouse] Batch flush error:', err),
    );
  }
}

/**
 * Flush the position buffer to ClickHouse.
 */
async function flushPositionBuffer(): Promise<void> {
  if (positionBuffer.length === 0) return;

  const batch = positionBuffer;
  positionBuffer = [];

  try {
    const ch = getClient();
    await ch.insert({
      table: 'ais_positions',
      values: batch,
      format: 'JSONEachRow',
    });
    console.log(`[ClickHouse] Flushed ${batch.length} positions`);
  } catch (err) {
    console.error(`[ClickHouse] Failed to flush ${batch.length} positions:`, err);
    // Re-add to buffer on failure (avoid data loss)
    positionBuffer = [...batch, ...positionBuffer];
  }
}

// ---- Insert: Vessel Metadata ----

/**
 * Upsert vessel metadata (uses ReplacingMergeTree so latest wins).
 */
export async function upsertVesselMetadata(vessel: VesselState & {
  callSign?: string;
  dimensionA?: number;
  dimensionB?: number;
  dimensionC?: number;
  dimensionD?: number;
  firstSeen?: string;
}): Promise<void> {
  const ch = getClient();
  const now = new Date().toISOString();

  await ch.insert({
    table: 'vessel_metadata',
    values: [{
      mmsi: vessel.mmsi,
      ship_name: vessel.name,
      ship_type: vessel.shipType,
      flag: vessel.flag,
      imo: vessel.imo,
      call_sign: vessel.callSign ?? '',
      destination: vessel.destination,
      draught: vessel.draught,
      dimension_a: vessel.dimensionA ?? 0,
      dimension_b: vessel.dimensionB ?? 0,
      dimension_c: vessel.dimensionC ?? 0,
      dimension_d: vessel.dimensionD ?? 0,
      first_seen: vessel.firstSeen ?? now,
      last_seen: now,
      risk_score: vessel.riskScore,
    }],
    format: 'JSONEachRow',
  });
}

// ---- Insert: Price Data ----

/**
 * Insert commodity/forex price data.
 */
export async function insertPriceData(prices: PriceUpdate[]): Promise<void> {
  if (prices.length === 0) return;
  const ch = getClient();

  await ch.insert({
    table: 'price_data',
    values: prices.map((p) => ({
      timestamp: p.timestamp,
      symbol: p.symbol,
      price: p.price,
      currency: p.currency,
      source: p.source,
    })),
    format: 'JSONEachRow',
  });
}

// ---- Insert: News Events ----

/**
 * Insert news events.
 */
export async function insertNewsEvents(events: NewsEvent[]): Promise<void> {
  if (events.length === 0) return;
  const ch = getClient();

  await ch.insert({
    table: 'news_events',
    values: events.map((e) => ({
      timestamp: e.publishedAt,
      title: e.title,
      url: e.url,
      source: e.source,
      domain: e.domain,
      sentiment_score: e.sentimentScore,
      sentiment: e.sentiment,
      keywords: e.keywords,
      language: 'en',
    })),
    format: 'JSONEachRow',
  });
}

// ---- Insert: Intelligence Alerts ----

/**
 * Insert an intelligence alert.
 */
export async function insertAlert(alert: {
  type: string;
  severity: string;
  title: string;
  description: string;
  evidence: string;
}): Promise<void> {
  const ch = getClient();
  await ch.insert({
    table: 'intelligence_alerts',
    values: [{
      timestamp: new Date().toISOString(),
      type: alert.type,
      severity: alert.severity,
      title: alert.title,
      description: alert.description,
      evidence: alert.evidence,
      resolved: 0,
    }],
    format: 'JSONEachRow',
  });
}

// ---- Queries ----

/**
 * Get total vessel count, optionally filtered by zone and time range.
 */
export async function getVesselCount(
  zone?: string,
  timeRangeHours: number = 24,
): Promise<number> {
  const ch = getClient();
  const cutoff = new Date(Date.now() - timeRangeHours * 3600_000).toISOString();

  let query = `
    SELECT uniqExact(mmsi) as count
    FROM ais_positions
    WHERE timestamp >= '${cutoff}'
  `;
  if (zone) {
    query += ` AND zone = '${zone}'`;
  }

  const result = await ch.query({ query, format: 'JSONEachRow' });
  const rows = await result.json<{ count: string }>();
  return parseInt(rows[0]?.count ?? '0', 10);
}

/**
 * Get recent AIS positions, optionally filtered by zone.
 */
export async function getRecentPositions(
  zone?: string,
  limit: number = 100,
): Promise<Array<Record<string, unknown>>> {
  const ch = getClient();
  const cutoff = new Date(Date.now() - 3600_000).toISOString(); // last hour

  let query = `
    SELECT *
    FROM ais_positions
    WHERE timestamp >= '${cutoff}'
  `;
  if (zone) {
    query += ` AND zone = '${zone}'`;
  }
  query += ` ORDER BY timestamp DESC LIMIT ${limit}`;

  const result = await ch.query({ query, format: 'JSONEachRow' });
  return result.json();
}

/**
 * Get price history for a symbol.
 */
export async function getPriceHistory(
  symbol: string,
  rangeDays: number = 7,
): Promise<Array<Record<string, unknown>>> {
  const ch = getClient();
  const cutoff = new Date(Date.now() - rangeDays * 86400_000).toISOString();

  const query = `
    SELECT *
    FROM price_data
    WHERE symbol = '${symbol}'
      AND timestamp >= '${cutoff}'
    ORDER BY timestamp ASC
  `;

  const result = await ch.query({ query, format: 'JSONEachRow' });
  return result.json();
}

/**
 * Get recent news events.
 */
export async function getNewsEvents(
  timeRangeHours: number = 24,
  limit: number = 50,
): Promise<Array<Record<string, unknown>>> {
  const ch = getClient();
  const cutoff = new Date(Date.now() - timeRangeHours * 3600_000).toISOString();

  const query = `
    SELECT *
    FROM news_events
    WHERE timestamp >= '${cutoff}'
    ORDER BY timestamp DESC
    LIMIT ${limit}
  `;

  const result = await ch.query({ query, format: 'JSONEachRow' });
  return result.json();
}

/**
 * Get zone statistics: tanker count, total ships, avg speed, anchored count per zone.
 */
export async function getZoneStats(): Promise<ZoneStats[]> {
  const ch = getClient();
  const cutoff = new Date(Date.now() - 3600_000).toISOString(); // last hour

  const query = `
    SELECT
      zone,
      uniqExact(mmsi) as total_ships,
      uniqExactIf(mmsi, ship_type >= 80 AND ship_type <= 89) as tanker_count,
      round(avg(sog), 1) as avg_speed,
      uniqExactIf(mmsi, nav_status = 1) as anchored_count
    FROM ais_positions
    WHERE timestamp >= '${cutoff}'
      AND zone IS NOT NULL
      AND zone != ''
    GROUP BY zone
    ORDER BY total_ships DESC
  `;

  const result = await ch.query({ query, format: 'JSONEachRow' });
  const rows = await result.json<{
    zone: string;
    total_ships: string;
    tanker_count: string;
    avg_speed: string;
    anchored_count: string;
  }>();

  return rows.map((row) => ({
    zone: row.zone,
    zoneName: ZONES[row.zone]?.name ?? row.zone,
    totalShips: parseInt(row.total_ships, 10),
    tankerCount: parseInt(row.tanker_count, 10),
    avgSpeed: parseFloat(row.avg_speed),
    anchoredCount: parseInt(row.anchored_count, 10),
  }));
}

/**
 * Get recent intelligence alerts.
 */
export async function getRecentAlerts(
  limit: number = 20,
): Promise<Array<Record<string, unknown>>> {
  const ch = getClient();

  const query = `
    SELECT *
    FROM intelligence_alerts
    WHERE resolved = 0
    ORDER BY timestamp DESC
    LIMIT ${limit}
  `;

  const result = await ch.query({ query, format: 'JSONEachRow' });
  return result.json();
}
