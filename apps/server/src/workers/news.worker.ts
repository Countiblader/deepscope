import { XMLParser } from 'fast-xml-parser';
import type { NewsEvent } from '../types/index.ts';
import { insertNewsEvents } from '../services/clickhouse.ts';

/**
 * News Worker
 *
 * Aggregates maritime and energy news from Google News RSS feeds.
 * Performs basic keyword-based sentiment analysis and deduplicates
 * articles via title hashing.
 */

const POLL_INTERVAL_MS = 120_000; // 2 minutes

// Deduplication: track seen article title hashes
const seenHashes = new Set<string>();
const MAX_SEEN_CACHE = 10_000;

// All news in memory for API
const recentNews: NewsEvent[] = [];
const MAX_NEWS_ITEMS = 500;

type UpdateCallback = (type: string, data: unknown) => void;
let onUpdate: UpdateCallback = () => {};

/**
 * Set the callback for news updates.
 */
export function setNewsUpdateCallback(cb: UpdateCallback): void {
  onUpdate = cb;
}

/**
 * Get recent news from memory.
 */
export function getRecentNews(limit: number = 50): NewsEvent[] {
  return recentNews.slice(0, limit);
}

// RSS feed URLs - Google News RSS search queries
const RSS_FEEDS: Array<{ url: string; domain: string }> = [
  {
    url: 'https://news.google.com/rss/search?q=oil+tanker+shipping&hl=en-US&gl=US&ceid=US:en',
    domain: 'oil_shipping',
  },
  {
    url: 'https://news.google.com/rss/search?q=strait+of+hormuz&hl=en-US&gl=US&ceid=US:en',
    domain: 'hormuz',
  },
  {
    url: 'https://news.google.com/rss/search?q=oil+price+crude&hl=en-US&gl=US&ceid=US:en',
    domain: 'oil_price',
  },
  {
    url: 'https://news.google.com/rss/search?q=OPEC+production+oil&hl=en-US&gl=US&ceid=US:en',
    domain: 'opec',
  },
  {
    url: 'https://news.google.com/rss/search?q=oil+sanctions+Russia+tanker&hl=en-US&gl=US&ceid=US:en',
    domain: 'sanctions',
  },
  {
    url: 'https://news.google.com/rss/search?q=shadow+fleet+dark+fleet+tanker&hl=en-US&gl=US&ceid=US:en',
    domain: 'shadow_fleet',
  },
];

// Sentiment analysis keyword lists
const POSITIVE_WORDS = new Set([
  'agreement', 'stabilize', 'peace', 'open', 'boost', 'surge', 'gain',
  'growth', 'recover', 'deal', 'cooperate', 'resolve', 'improve',
  'rally', 'strong', 'rise', 'profit', 'positive', 'optimism',
  'ease', 'relief', 'secure', 'advance', 'opportunity',
]);

const NEGATIVE_WORDS = new Set([
  'attack', 'block', 'crash', 'threat', 'war', 'sanctions', 'crisis',
  'conflict', 'disrupt', 'seize', 'bomb', 'missile', 'explosion',
  'decline', 'drop', 'fall', 'plunge', 'loss', 'risk', 'danger',
  'warning', 'closure', 'shortage', 'spill', 'accident', 'collision',
  'detention', 'violation', 'illegal', 'smuggling', 'evasion',
  'escalation', 'retaliation', 'tension', 'suspend',
]);

// Domain-specific keywords to extract from titles
const MARITIME_KEYWORDS = [
  'tanker', 'crude', 'oil', 'LNG', 'VLCC', 'supertanker', 'pipeline',
  'refinery', 'OPEC', 'sanctions', 'Iran', 'Russia', 'Hormuz', 'Suez',
  'shadow fleet', 'dark fleet', 'AIS', 'shipping', 'freight', 'charter',
  'Brent', 'WTI', 'barrel', 'production', 'embargo', 'price cap',
];

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

/**
 * Simple hash for deduplication.
 */
function hashTitle(title: string): string {
  let hash = 0;
  const normalized = title.toLowerCase().trim();
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return hash.toString(36);
}

/**
 * Analyze sentiment of a text using keyword matching.
 * Returns score (-1 to 1) and label.
 */
function analyzeSentiment(text: string): { score: number; label: 'positive' | 'negative' | 'neutral' } {
  const words = text.toLowerCase().split(/\s+/);
  let positiveCount = 0;
  let negativeCount = 0;

  for (const word of words) {
    // Strip punctuation
    const clean = word.replace(/[^a-z]/g, '');
    if (POSITIVE_WORDS.has(clean)) positiveCount++;
    if (NEGATIVE_WORDS.has(clean)) negativeCount++;
  }

  const total = positiveCount + negativeCount;
  if (total === 0) return { score: 0, label: 'neutral' };

  const score = (positiveCount - negativeCount) / total;

  let label: 'positive' | 'negative' | 'neutral';
  if (score > 0.2) label = 'positive';
  else if (score < -0.2) label = 'negative';
  else label = 'neutral';

  return { score: Math.round(score * 100) / 100, label };
}

/**
 * Extract relevant keywords from title text.
 */
function extractKeywords(text: string): string[] {
  const textLower = text.toLowerCase();
  return MARITIME_KEYWORDS.filter((kw) => textLower.includes(kw.toLowerCase()));
}

/**
 * Extract source name from Google News title (format: "Title - Source").
 */
function extractSource(title: string): { cleanTitle: string; source: string } {
  const lastDash = title.lastIndexOf(' - ');
  if (lastDash > 0) {
    return {
      cleanTitle: title.substring(0, lastDash).trim(),
      source: title.substring(lastDash + 3).trim(),
    };
  }
  return { cleanTitle: title, source: 'Unknown' };
}

/**
 * Fetch and parse a single RSS feed.
 */
async function fetchFeed(feedUrl: string, domain: string): Promise<NewsEvent[]> {
  try {
    const response = await fetch(feedUrl, {
      headers: {
        'User-Agent': 'DeepScope/1.0 Maritime Intelligence Dashboard',
      },
    });

    if (!response.ok) {
      console.error(`[News] RSS fetch failed for ${domain}: ${response.status}`);
      return [];
    }

    const xml = await response.text();
    const parsed = xmlParser.parse(xml);

    // Navigate RSS structure
    const channel = parsed?.rss?.channel;
    if (!channel) return [];

    let items = channel.item;
    if (!items) return [];
    if (!Array.isArray(items)) items = [items];

    const events: NewsEvent[] = [];

    for (const item of items) {
      const rawTitle = String(item.title || '');
      const { cleanTitle, source } = extractSource(rawTitle);
      const url = String(item.link || '');
      const pubDate = String(item.pubDate || '');

      // Dedup
      const hash = hashTitle(cleanTitle);
      if (seenHashes.has(hash)) continue;
      seenHashes.add(hash);

      // Evict old hashes if cache is too large
      if (seenHashes.size > MAX_SEEN_CACHE) {
        const iter = seenHashes.values();
        for (let i = 0; i < 1000; i++) {
          const val = iter.next().value;
          if (val) seenHashes.delete(val);
        }
      }

      // Sentiment analysis
      const sentiment = analyzeSentiment(cleanTitle);

      // Extract keywords
      const keywords = extractKeywords(cleanTitle);

      const event: NewsEvent = {
        id: hash,
        title: cleanTitle,
        url,
        source,
        domain,
        publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        sentiment: sentiment.label,
        sentimentScore: sentiment.score,
        keywords,
      };

      events.push(event);
    }

    return events;
  } catch (err) {
    console.error(`[News] Error fetching ${domain}:`, err);
    return [];
  }
}

/**
 * Single poll cycle: fetch all RSS feeds, deduplicate, analyze.
 */
async function poll(): Promise<void> {
  try {
    const allEvents: NewsEvent[] = [];

    // Fetch all feeds in parallel
    const results = await Promise.allSettled(
      RSS_FEEDS.map((feed) => fetchFeed(feed.url, feed.domain)),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        allEvents.push(...result.value);
      }
    }

    if (allEvents.length === 0) {
      console.log('[News] No new articles found');
      return;
    }

    // Sort by date descending
    allEvents.sort((a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
    );

    // Add to in-memory store
    recentNews.unshift(...allEvents);
    if (recentNews.length > MAX_NEWS_ITEMS) {
      recentNews.length = MAX_NEWS_ITEMS;
    }

    // Store in ClickHouse
    await insertNewsEvents(allEvents).catch((err) =>
      console.error('[News] ClickHouse insert error:', err),
    );

    // Push updates
    onUpdate('news_update', allEvents);

    const sentimentBreakdown = {
      positive: allEvents.filter((e) => e.sentiment === 'positive').length,
      negative: allEvents.filter((e) => e.sentiment === 'negative').length,
      neutral: allEvents.filter((e) => e.sentiment === 'neutral').length,
    };

    console.log(
      `[News] Fetched ${allEvents.length} new articles | Sentiment: +${sentimentBreakdown.positive} -${sentimentBreakdown.negative} ~${sentimentBreakdown.neutral}`,
    );
  } catch (err) {
    console.error('[News] Poll error:', err);
  }
}

/**
 * Start the news worker.
 */
export function startNewsWorker(): void {
  console.log('[News] Worker starting...');
  console.log(`[News] Monitoring ${RSS_FEEDS.length} RSS feeds`);

  // Initial poll
  poll();

  // Periodic polling
  setInterval(() => {
    poll();
  }, POLL_INTERVAL_MS);
}
