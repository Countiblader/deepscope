import 'dotenv/config';
import { initClickHouse, closeClickHouse, getZoneStats, getPriceHistory, getNewsEvents as getClickHouseNews, getRecentAlerts } from './services/clickhouse.ts';
import { ZONES } from './services/zones.ts';
import { startAISWorker, setUpdateCallback, getAllVessels, getVessel, getVesselsByZone, getDataSource } from './workers/ais.worker.ts';
import { startPriceWorker, setPriceUpdateCallback, getCurrentPrices } from './workers/price.worker.ts';
import { startNewsWorker, setNewsUpdateCallback, getRecentNews } from './workers/news.worker.ts';
import type { VesselState, PriceUpdate, NewsEvent, IntelligenceAlert } from './types/index.ts';

/**
 * DeepScope Maritime Intelligence Server
 *
 * HTTP + WebSocket server built on Bun.serve providing:
 * - REST API for vessel positions, prices, news, and zone stats
 * - WebSocket channels for real-time streaming of AIS, prices, and alerts
 * - Integrates AIS, Price, and News workers
 */

const PORT = parseInt(process.env['PORT'] ?? '4000', 10);

// ---- WebSocket client management ----

interface WSClient {
  ws: unknown; // Bun ServerWebSocket
  channels: Set<string>;
  subscribeTime: number;
}

const wsClients = new Map<string, WSClient>();
let clientIdCounter = 0;

/**
 * Broadcast a message to all WebSocket clients subscribed to a channel.
 */
function broadcast(channel: string, data: unknown): void {
  const payload = JSON.stringify({ channel, data, timestamp: Date.now() });

  for (const [, client] of wsClients) {
    if (client.channels.has(channel)) {
      try {
        (client.ws as { send: (data: string) => void }).send(payload);
      } catch {
        // Client disconnected, will be cleaned up
      }
    }
  }
}

// ---- Worker callbacks ----

setUpdateCallback((type: string, data: unknown) => {
  switch (type) {
    case 'vessel_update':
      broadcast('ais', data);
      break;
    case 'alert':
      broadcast('alerts', data);
      break;
    case 'status':
      broadcast('ais', { type: 'status', ...data as Record<string, unknown> });
      break;
  }
});

setPriceUpdateCallback((type: string, data: unknown) => {
  if (type === 'price_update') {
    broadcast('prices', data);
  }
});

setNewsUpdateCallback((type: string, data: unknown) => {
  if (type === 'news_update') {
    broadcast('alerts', { type: 'news', data });
  }
});

// ---- CORS headers ----

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function corsResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

function corsOptionsResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

// ---- Route handlers ----

function handleGetVessels(url: URL): Response {
  const zone = url.searchParams.get('zone');
  const minRisk = parseInt(url.searchParams.get('minRisk') ?? '0', 10);
  const shipType = url.searchParams.get('shipType');

  let vessels = zone ? getVesselsByZone(zone) : getAllVessels();

  // Filter by minimum risk score
  if (minRisk > 0) {
    vessels = vessels.filter((v) => v.riskScore >= minRisk);
  }

  // Filter by ship type
  if (shipType) {
    const typeNum = parseInt(shipType, 10);
    vessels = vessels.filter((v) => v.shipType === typeNum);
  }

  // Sort by risk score descending
  vessels.sort((a, b) => b.riskScore - a.riskScore);

  return corsResponse({
    count: vessels.length,
    dataSource: getDataSource(),
    vessels,
  });
}

function handleGetVesselByMMSI(mmsi: number): Response {
  const vessel = getVessel(mmsi);
  if (!vessel) {
    return corsResponse({ error: 'Vessel not found' }, 404);
  }
  return corsResponse(vessel);
}

function handleGetVesselsByZone(zone: string): Response {
  if (!ZONES[zone]) {
    return corsResponse({ error: 'Unknown zone', availableZones: Object.keys(ZONES) }, 400);
  }
  const vessels = getVesselsByZone(zone);
  vessels.sort((a, b) => b.riskScore - a.riskScore);

  return corsResponse({
    zone,
    zoneName: ZONES[zone]?.name,
    count: vessels.length,
    vessels,
  });
}

function handleGetPrices(): Response {
  const prices = getCurrentPrices();
  return corsResponse({
    count: prices.length,
    prices,
  });
}

async function handleGetPriceHistory(url: URL): Promise<Response> {
  const symbol = url.searchParams.get('symbol') ?? 'BRENT';
  const range = url.searchParams.get('range') ?? '7d';

  // Parse range string like "7d", "30d", "1h"
  const rangeMatch = range.match(/^(\d+)([dhm])$/);
  let rangeDays = 7;
  if (rangeMatch) {
    const value = parseInt(rangeMatch[1]!, 10);
    const unit = rangeMatch[2]!;
    if (unit === 'd') rangeDays = value;
    else if (unit === 'h') rangeDays = value / 24;
    else if (unit === 'm') rangeDays = value / (24 * 60);
  }

  try {
    const history = await getPriceHistory(symbol.toUpperCase(), rangeDays);
    return corsResponse({
      symbol: symbol.toUpperCase(),
      range,
      count: history.length,
      data: history,
    });
  } catch (err) {
    console.error('[API] Price history error:', err);
    return corsResponse({ error: 'Failed to fetch price history' }, 500);
  }
}

function handleGetNews(url: URL): Response {
  const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
  const domain = url.searchParams.get('domain');

  let news = getRecentNews(limit);

  if (domain) {
    news = news.filter((n) => n.domain === domain);
  }

  return corsResponse({
    count: news.length,
    events: news,
  });
}

async function handleGetZoneStats(): Promise<Response> {
  try {
    const stats = await getZoneStats();

    // If ClickHouse has no data, build stats from in-memory vessels
    if (stats.length === 0) {
      const allVessels = getAllVessels();
      const zoneMap = new Map<string, VesselState[]>();

      for (const v of allVessels) {
        if (v.zone) {
          const existing = zoneMap.get(v.zone) ?? [];
          existing.push(v);
          zoneMap.set(v.zone, existing);
        }
      }

      const inMemoryStats = Array.from(zoneMap.entries()).map(([zone, vessels]) => ({
        zone,
        zoneName: ZONES[zone]?.name ?? zone,
        totalShips: vessels.length,
        tankerCount: vessels.filter((v) => v.shipType >= 80 && v.shipType <= 89).length,
        avgSpeed: Math.round(vessels.reduce((sum, v) => sum + v.speed, 0) / vessels.length * 10) / 10,
        anchoredCount: vessels.filter((v) => v.navStatus === 1).length,
      }));

      return corsResponse({ stats: inMemoryStats });
    }

    return corsResponse({ stats });
  } catch (err) {
    console.error('[API] Zone stats error:', err);
    // Fallback to in-memory
    const allVessels = getAllVessels();
    const zoneMap = new Map<string, VesselState[]>();

    for (const v of allVessels) {
      if (v.zone) {
        const existing = zoneMap.get(v.zone) ?? [];
        existing.push(v);
        zoneMap.set(v.zone, existing);
      }
    }

    const fallbackStats = Array.from(zoneMap.entries()).map(([zone, vessels]) => ({
      zone,
      zoneName: ZONES[zone]?.name ?? zone,
      totalShips: vessels.length,
      tankerCount: vessels.filter((v) => v.shipType >= 80 && v.shipType <= 89).length,
      avgSpeed: vessels.length > 0
        ? Math.round(vessels.reduce((sum, v) => sum + v.speed, 0) / vessels.length * 10) / 10
        : 0,
      anchoredCount: vessels.filter((v) => v.navStatus === 1).length,
    }));

    return corsResponse({ stats: fallbackStats });
  }
}

function handleHealth(): Response {
  const vesselCount = getAllVessels().length;
  const priceCount = getCurrentPrices().length;
  const newsCount = getRecentNews(1).length;
  const ds = getDataSource();

  return corsResponse({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    dataSource: ds,
    workers: {
      ais: { active: true, vessels: vesselCount, dataSource: ds },
      prices: { active: true, symbols: priceCount },
      news: { active: true, articles: newsCount },
    },
    zones: Object.keys(ZONES),
  });
}

// ---- Main server ----

async function main() {
  console.log('='.repeat(60));
  console.log(' DeepScope Maritime Intelligence Server');
  console.log('='.repeat(60));

  // Initialize ClickHouse (non-blocking - don't fail if CH is down)
  try {
    initClickHouse();
    console.log('[Server] ClickHouse initialized');
  } catch (err) {
    console.warn('[Server] ClickHouse init failed (will retry on queries):', err);
  }

  // WebSocket data shape
  type WSData = { channel: string; clientId: string };

  // Start Bun HTTP + WebSocket server
  const server = Bun.serve<WSData>({
    port: PORT,

    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      // CORS preflight
      if (req.method === 'OPTIONS') {
        return corsOptionsResponse();
      }

      // WebSocket upgrade
      if (path.startsWith('/ws/')) {
        const upgraded = server.upgrade(req, {
          data: {
            channel: path.replace('/ws/', ''),
            clientId: `ws-${++clientIdCounter}`,
          },
        });
        if (upgraded) return undefined as unknown as Response;
        return corsResponse({ error: 'WebSocket upgrade failed' }, 400);
      }

      // REST API routes
      if (req.method === 'GET') {
        // GET /api/health
        if (path === '/api/health') {
          return handleHealth();
        }

        // GET /api/vessels
        if (path === '/api/vessels') {
          return handleGetVessels(url);
        }

        // GET /api/vessels/zone/:zone
        const zoneMatch = path.match(/^\/api\/vessels\/zone\/(\w+)$/);
        if (zoneMatch) {
          return handleGetVesselsByZone(zoneMatch[1]!);
        }

        // GET /api/vessels/:mmsi
        const mmsiMatch = path.match(/^\/api\/vessels\/(\d+)$/);
        if (mmsiMatch) {
          return handleGetVesselByMMSI(parseInt(mmsiMatch[1]!, 10));
        }

        // GET /api/prices
        if (path === '/api/prices') {
          return handleGetPrices();
        }

        // GET /api/prices/history
        if (path === '/api/prices/history') {
          return handleGetPriceHistory(url);
        }

        // GET /api/news
        if (path === '/api/news') {
          return handleGetNews(url);
        }

        // GET /api/zones/stats
        if (path === '/api/zones/stats') {
          return handleGetZoneStats();
        }

        // GET /api/alerts
        if (path === '/api/alerts') {
          try {
            const alerts = await getRecentAlerts();
            return corsResponse({ count: alerts.length, alerts });
          } catch {
            return corsResponse({ count: 0, alerts: [] });
          }
        }
      }

      return corsResponse({ error: 'Not found' }, 404);
    },

    websocket: {
      open(ws) {
        const { channel: wsChannel, clientId } = ws.data;
        const channels = new Set<string>();

        // Map channel path to subscription
        switch (wsChannel) {
          case 'ais':
            channels.add('ais');
            break;
          case 'prices':
            channels.add('prices');
            break;
          case 'alerts':
            channels.add('alerts');
            break;
          default:
            // Subscribe to all
            channels.add('ais');
            channels.add('prices');
            channels.add('alerts');
        }

        wsClients.set(clientId, {
          ws,
          channels,
          subscribeTime: Date.now(),
        });

        console.log(`[WS] Client ${clientId} connected (channels: ${Array.from(channels).join(', ')})`);

        // Send initial state
        const initPayload = JSON.stringify({
          channel: 'init',
          data: {
            vessels: channels.has('ais') ? getAllVessels().length : 0,
            prices: channels.has('prices') ? getCurrentPrices() : [],
            zones: Object.entries(ZONES).map(([key, zone]) => ({
              key,
              name: zone.name,
              bounds: zone.bounds,
            })),
          },
          timestamp: Date.now(),
        });
        ws.send(initPayload);
      },

      message(ws, message) {
        // Handle client messages (e.g., channel subscriptions)
        try {
          const { clientId } = ws.data;
          const client = wsClients.get(clientId);
          if (!client) return;

          const msg = JSON.parse(message.toString()) as { action?: string; channel?: string };

          if (msg.action === 'subscribe' && msg.channel) {
            client.channels.add(msg.channel);
            console.log(`[WS] Client ${clientId} subscribed to ${msg.channel}`);
          } else if (msg.action === 'unsubscribe' && msg.channel) {
            client.channels.delete(msg.channel);
            console.log(`[WS] Client ${clientId} unsubscribed from ${msg.channel}`);
          }
        } catch (err) {
          console.error('[WS] Failed to parse client message:', err);
        }
      },

      close(ws) {
        const { clientId } = ws.data;
        wsClients.delete(clientId);
        console.log(`[WS] Client ${clientId} disconnected`);
      },
    },
  });

  console.log(`[Server] HTTP + WebSocket server running on port ${PORT}`);
  console.log(`[Server] REST API: http://localhost:${PORT}/api/`);
  console.log(`[Server] WebSocket: ws://localhost:${PORT}/ws/{ais|prices|alerts}`);
  console.log('');

  // Start workers
  startAISWorker();
  startPriceWorker();
  startNewsWorker();

  console.log('');
  console.log('[Server] All workers started. Ready for connections.');
  console.log('='.repeat(60));

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[Server] Shutting down...');
    await closeClickHouse();
    server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n[Server] Terminated.');
    await closeClickHouse();
    server.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[Server] Fatal error:', err);
  process.exit(1);
});
