import type { PriceUpdate } from '../types/index.ts';
import { insertPriceData } from '../services/clickhouse.ts';

/**
 * Price Worker
 *
 * Fetches commodity prices from (in priority order):
 *   1. EIA API (if EIA_API_KEY is set)
 *   2. Yahoo Finance (free, no API key needed) - Brent, WTI, Gold, NatGas
 *   3. Brownian motion mock (last resort fallback)
 */

const POLL_INTERVAL_MS = 60_000; // 60 seconds

// Current prices in memory for API responses
const currentPrices = new Map<string, PriceUpdate>();

// Mock mode fallback base prices
let mockBrentPrice = 82.50;
let mockWtiPrice = 78.30;
let mockNatGasPrice = 2.85;
let mockLngPrice = 12.40;

type UpdateCallback = (type: string, data: unknown) => void;
let onUpdate: UpdateCallback = () => {};

/**
 * Set the callback for price updates.
 */
export function setPriceUpdateCallback(cb: UpdateCallback): void {
  onUpdate = cb;
}

/**
 * Get all current prices.
 */
export function getCurrentPrices(): PriceUpdate[] {
  return Array.from(currentPrices.values());
}

/**
 * Fetch real commodity prices from Yahoo Finance.
 * No API key required - uses the unofficial but reliable v8 chart endpoint.
 *
 * Symbols:
 *   BZ=F  → Brent Crude Oil Futures
 *   CL=F  → WTI Crude Oil Futures
 *   GC=F  → Gold Futures
 *   NG=F  → Natural Gas Futures
 */
async function fetchYahooFinancePrices(): Promise<PriceUpdate[]> {
  const symbols: Array<{ ticker: string; name: string; category: string }> = [
    { ticker: 'BZ%3DF', name: 'BRENT', category: 'energy' },
    { ticker: 'CL%3DF', name: 'WTI',   category: 'energy' },
    { ticker: 'GC%3DF', name: 'GOLD',  category: 'metals' },
    { ticker: 'NG%3DF', name: 'NATGAS',category: 'energy' },
  ];

  const prices: PriceUpdate[] = [];
  const now = new Date().toISOString();

  for (const sym of symbols) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym.ticker}?interval=1d&range=2d`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; DeepScope/1.0)',
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        console.warn(`[Price] Yahoo Finance ${sym.name}: HTTP ${res.status}`);
        continue;
      }

      const json = await res.json() as {
        chart?: {
          result?: Array<{
            meta?: {
              regularMarketPrice?: number;
              currency?: string;
              symbol?: string;
            };
          }>;
          error?: { code: string; description: string };
        };
      };

      if (json.chart?.error) {
        console.warn(`[Price] Yahoo Finance ${sym.name} error: ${json.chart.error.description}`);
        continue;
      }

      const price = json.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (price && price > 0) {
        prices.push({
          timestamp: now,
          symbol: sym.name,
          price: Math.round(price * 100) / 100,
          currency: 'USD',
          source: 'yahoo_finance',
        });
      }
    } catch (err) {
      // Timeout or network error for this symbol - skip
      console.warn(`[Price] Yahoo Finance ${sym.name} fetch error: ${(err as Error).message}`);
    }
  }

  return prices;
}

/**
 * Fetch prices from EIA API (petroleum spot prices for Brent + WTI).
 * Requires EIA_API_KEY env var.
 */
async function fetchEIAPrices(): Promise<PriceUpdate[]> {
  const apiKey = process.env['EIA_API_KEY'];
  if (!apiKey || apiKey === 'placeholder_get_real_key') {
    return [];
  }

  const url = new URL('https://api.eia.gov/v2/petroleum/pri/spt/data/');
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('frequency', 'daily');
  url.searchParams.set('data[0]', 'value');
  url.searchParams.set('facets[series][]', 'RBRTE');
  url.searchParams.append('facets[series][]', 'RWTC');
  url.searchParams.set('sort[0][column]', 'period');
  url.searchParams.set('sort[0][direction]', 'desc');
  url.searchParams.set('length', '30');

  try {
    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      console.error(`[Price] EIA API error: ${response.status} ${response.statusText}`);
      return [];
    }

    const json = await response.json() as {
      response?: {
        data?: Array<{
          period: string;
          series: string;
          value: number;
        }>;
      };
    };

    const data = json?.response?.data;
    if (!Array.isArray(data)) return [];

    const prices: PriceUpdate[] = [];
    for (const entry of data) {
      const symbol = entry.series === 'RBRTE' ? 'BRENT' : entry.series === 'RWTC' ? 'WTI' : entry.series;
      prices.push({
        timestamp: new Date(entry.period + 'T00:00:00Z').toISOString(),
        symbol,
        price: entry.value,
        currency: 'USD',
        source: 'EIA',
      });
    }
    return prices;
  } catch (err) {
    console.error('[Price] EIA fetch error:', err);
    return [];
  }
}

/**
 * Brownian motion fallback mock prices (only used if Yahoo Finance is also unavailable).
 */
function generateMockPrices(): PriceUpdate[] {
  const now = new Date().toISOString();

  function walk(current: number, volatility: number, mean: number): number {
    const drift = (mean - current) * 0.01;
    const noise = (Math.random() - 0.5) * volatility;
    return Math.round((current + drift + noise) * 100) / 100;
  }

  mockBrentPrice = walk(mockBrentPrice, 0.8, 82.50);
  mockWtiPrice   = walk(mockWtiPrice,   0.7, 78.30);
  mockNatGasPrice = walk(mockNatGasPrice, 0.05, 2.85);
  mockLngPrice   = walk(mockLngPrice,   0.15, 12.40);

  return [
    { timestamp: now, symbol: 'BRENT',   price: mockBrentPrice,   currency: 'USD', source: 'mock' },
    { timestamp: now, symbol: 'WTI',     price: mockWtiPrice,     currency: 'USD', source: 'mock' },
    { timestamp: now, symbol: 'NATGAS',  price: mockNatGasPrice,  currency: 'USD', source: 'mock' },
    { timestamp: now, symbol: 'LNG_JKM', price: mockLngPrice,     currency: 'USD', source: 'mock' },
  ];
}

/**
 * Single poll cycle: fetch from EIA → Yahoo Finance → mock fallback.
 */
async function poll(): Promise<void> {
  try {
    // 1. Try EIA (authoritative US government data, daily updates)
    let prices = await fetchEIAPrices();

    // 2. Yahoo Finance (real-time futures, no key needed)
    if (prices.length === 0) {
      prices = await fetchYahooFinancePrices();
      if (prices.length > 0) {
        // Add LNG_JKM from mock (Yahoo doesn't have JKM directly)
        mockLngPrice = mockLngPrice + (Math.random() - 0.5) * 0.1;
        prices.push({
          timestamp: new Date().toISOString(),
          symbol: 'LNG_JKM',
          price: Math.round(mockLngPrice * 100) / 100,
          currency: 'USD',
          source: 'estimated',
        });
      }
    }

    // 3. Full mock fallback
    if (prices.length === 0) {
      prices = generateMockPrices();
    }

    // Update in-memory state
    for (const price of prices) {
      currentPrices.set(price.symbol, price);
    }

    // Persist to ClickHouse (non-blocking)
    insertPriceData(prices).catch((err) =>
      console.error('[Price] ClickHouse insert error:', err),
    );

    // Push to WebSocket clients
    onUpdate('price_update', prices);

    const symbols = prices.map((p) => `${p.symbol}=$${p.price} (${p.source})`).join(', ');
    console.log(`[Price] Updated: ${symbols}`);
  } catch (err) {
    console.error('[Price] Poll error:', err);
  }
}

/**
 * Start the price worker.
 */
export function startPriceWorker(): void {
  console.log('[Price] Worker starting...');

  const hasEiaKey = !!(process.env['EIA_API_KEY'] && process.env['EIA_API_KEY'] !== 'placeholder_get_real_key');
  if (hasEiaKey) {
    console.log('[Price] EIA API key configured - using government data as primary source');
  } else {
    console.log('[Price] No EIA_API_KEY - using Yahoo Finance for real-time futures prices');
  }

  // Initial poll immediately
  poll();

  // Periodic polling
  setInterval(() => poll(), POLL_INTERVAL_MS);
}
