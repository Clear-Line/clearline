/**
 * Polymarket API clients — all read endpoints, no auth needed.
 *
 * Three APIs:
 *   Gamma  — market discovery & metadata
 *   CLOB   — order book, pricing, historical prices
 *   Data   — wallet positions, trades, activity
 */

const GAMMA_API = 'https://gamma-api.polymarket.com';
const CLOB_API = 'https://clob.polymarket.com';
const DATA_API = 'https://data-api.polymarket.com';

// ---------- Gamma API (market metadata) ----------

export interface GammaMarket {
  id: string;
  question: string;
  slug: string;
  outcomes: string;          // JSON string: '["Yes","No"]'
  outcomePrices: string;     // JSON string: '["0.62","0.38"]'
  volume: string;
  volume24hr: string;
  liquidity: string;
  startDate: string;
  endDate: string;
  active: boolean;
  closed: boolean;
  clobTokenIds: string;      // JSON string: '["token_yes","token_no"]'
  conditionId: string;
  questionId: string;
  eventId?: string;
  tags?: string[];
}

export interface GammaEvent {
  id: string;
  title: string;
  slug: string;
  markets: GammaMarket[];
}

export async function fetchActiveMarkets(limit = 100, offset = 0): Promise<GammaMarket[]> {
  const params = new URLSearchParams({
    active: 'true',
    closed: 'false',
    limit: String(limit),
    offset: String(offset),
    order: 'volume24hr',
    ascending: 'false',
  });

  const res = await fetch(`${GAMMA_API}/markets?${params}`);
  if (!res.ok) throw new Error(`Gamma /markets failed: ${res.status}`);
  return res.json();
}

export async function fetchCryptoMarkets(limit = 200): Promise<GammaMarket[]> {
  const params = new URLSearchParams({
    active: 'true',
    closed: 'false',
    tag: 'crypto',
    limit: String(limit),
  });

  const res = await fetch(`${GAMMA_API}/markets?${params}`);
  if (!res.ok) throw new Error(`Gamma /markets (crypto) failed: ${res.status}`);
  return res.json();
}

/**
 * Fetch BTC Up or Down events using slug-based lookup.
 *
 * The Gamma events API tag filter is unreliable (returns unrelated events),
 * but slug-based lookup works perfectly. BTC up/down markets follow two
 * predictable slug patterns:
 *
 *   1H: "bitcoin-up-or-down-{month}-{day}-{year}-{hour}{am/pm}-et"
 *   4H: "btc-updown-4h-{unixTimestamp}"
 *
 * We generate candidate slugs for the current and upcoming windows,
 * then fetch each from the Gamma API.
 */
export async function fetchBtcUpDownEvents(_limit = 10): Promise<GammaMarket[]> {
  const now = new Date();
  const slugs = generateBtcUpDownSlugs(now);

  const markets: GammaMarket[] = [];
  const seen = new Set<string>();

  // Fetch events by slug in parallel (max ~8 slugs)
  const results = await Promise.allSettled(
    slugs.map(async (slug) => {
      const res = await fetch(`${GAMMA_API}/events?slug=${slug}`);
      if (!res.ok) return [];
      const events: GammaEvent[] = await res.json();
      return events;
    }),
  );

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const event of result.value) {
      for (const m of event.markets ?? []) {
        if (!seen.has(m.conditionId)) {
          seen.add(m.conditionId);
          markets.push(m);
        }
      }
    }
  }

  return markets;
}

const MONTH_NAMES = [
  '', 'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

function generateBtcUpDownSlugs(now: Date): string[] {
  const slugs: string[] = [];

  // ET is UTC-4 (EDT) or UTC-5 (EST). Use -4 for EDT (March-November).
  const etOffsetMs = -4 * 60 * 60 * 1000;
  const nowEt = new Date(now.getTime() + etOffsetMs);
  const month = MONTH_NAMES[nowEt.getMonth() + 1];
  const day = nowEt.getDate();
  const year = nowEt.getFullYear();

  // 1H windows: generate for current hour and next 2 hours (9am-8pm ET)
  const currentHourEt = nowEt.getHours();
  for (let h = Math.max(currentHourEt - 1, 9); h <= Math.min(currentHourEt + 2, 20); h++) {
    const ampm = h < 12 ? 'am' : 'pm';
    const displayH = h <= 12 ? h : h - 12;
    slugs.push(`bitcoin-up-or-down-${month}-${day}-${year}-${displayH}${ampm}-et`);
  }

  // 4H windows: 0:00, 4:00, 8:00, 12:00, 16:00, 20:00 UTC
  const todayUtcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (let h = 0; h < 24; h += 4) {
    const windowStart = new Date(todayUtcMidnight.getTime() + h * 3600_000);
    const windowEnd = new Date(windowStart.getTime() + 4 * 3600_000);
    // Include if window is active or starts within the next 4 hours
    if (windowEnd > now && windowStart.getTime() < now.getTime() + 4 * 3600_000) {
      const ts = Math.floor(windowStart.getTime() / 1000);
      slugs.push(`btc-updown-4h-${ts}`);
    }
  }

  return slugs;
}

export async function fetchMarketByConditionId(conditionId: string): Promise<GammaMarket | null> {
  const res = await fetch(`${GAMMA_API}/markets/${conditionId}`);
  if (!res.ok) return null;
  const data = await res.json();
  // API may return a single object or an array
  if (Array.isArray(data)) return data.length > 0 ? data[0] : null;
  return data;
}

export async function fetchPoliticalEvents(limit = 100): Promise<GammaEvent[]> {
  const params = new URLSearchParams({
    active: 'true',
    closed: 'false',
    tag: 'politics',
    limit: String(limit),
  });

  const res = await fetch(`${GAMMA_API}/events?${params}`);
  if (!res.ok) throw new Error(`Gamma /events failed: ${res.status}`);
  return res.json();
}

// ---------- CLOB API (order book, prices) ----------

export interface OrderBookLevel {
  price: string;
  size: string;
}

export interface OrderBook {
  market: string;
  asset_id: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  hash: string;
  timestamp: string;
}

export async function fetchOrderBook(tokenId: string): Promise<OrderBook> {
  const res = await fetch(`${CLOB_API}/book?token_id=${tokenId}`);
  if (!res.ok) throw new Error(`CLOB /book failed: ${res.status}`);
  return res.json();
}

export async function fetchSpread(tokenId: string): Promise<{ spread: string }> {
  const res = await fetch(`${CLOB_API}/spread?token_id=${tokenId}`);
  if (!res.ok) throw new Error(`CLOB /spread failed: ${res.status}`);
  return res.json();
}

export async function fetchMidpoint(tokenId: string): Promise<{ mid: string }> {
  const res = await fetch(`${CLOB_API}/midpoint?token_id=${tokenId}`);
  if (!res.ok) throw new Error(`CLOB /midpoint failed: ${res.status}`);
  return res.json();
}

export interface PricePoint {
  t: number;   // unix timestamp
  p: number;   // price
}

export async function fetchPriceHistory(
  conditionId: string,
  interval = 'max',
  fidelity = 60,
): Promise<PricePoint[]> {
  const params = new URLSearchParams({
    market: conditionId,
    interval,
    fidelity: String(fidelity),
  });
  const res = await fetch(`${CLOB_API}/prices-history?${params}`);
  if (!res.ok) throw new Error(`CLOB /prices-history failed: ${res.status}`);
  return res.json();
}

// ---------- Data API (wallets, trades, activity) ----------

export interface PolymarketTrade {
  proxyWallet: string;
  timestamp: number;          // unix seconds
  conditionId: string;
  type: string;
  size: number;
  usdcSize: number;
  transactionHash: string;
  price: number;
  asset: string;
  side: 'BUY' | 'SELL';
  outcomeIndex: number;
  title: string;
  slug: string;
  outcome: string;
  name?: string;
  pseudonym?: string;
}

export async function fetchMarketTrades(
  conditionId: string,
  limit = 100,
  offset = 0,
): Promise<PolymarketTrade[]> {
  const params = new URLSearchParams({
    market: conditionId,
    limit: String(limit),
    offset: String(offset),
  });
  const res = await fetch(`${DATA_API}/trades?${params}`);
  if (!res.ok) throw new Error(`Data /trades failed: ${res.status}`);
  const raw: any[] = await res.json();
  // API returns `size` (tokens) but not `usdcSize` — compute it
  return raw.map((t) => ({
    ...t,
    usdcSize: t.usdcSize ?? (t.size || 0) * (t.price || 0),
  }));
}

/**
 * Fetch trades with pagination — pages through until no more data or limits hit.
 * Includes per-request retry with exponential backoff for 429s.
 */
export async function fetchMarketTradesPaginated(
  conditionId: string,
  opts: { maxPages?: number; pageSize?: number; maxRetries?: number } = {},
): Promise<{ trades: PolymarketTrade[]; pages: number; retries: number }> {
  const { maxPages = 5, pageSize = 100, maxRetries = 3 } = opts;
  const allTrades: PolymarketTrade[] = [];
  let pages = 0;
  let totalRetries = 0;

  for (let page = 0; page < maxPages; page++) {
    const offset = page * pageSize;
    let lastErr: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const trades = await fetchMarketTrades(conditionId, pageSize, offset);
        allTrades.push(...trades);
        pages++;
        lastErr = null;

        // If fewer results than page size, no more pages
        if (trades.length < pageSize) return { trades: allTrades, pages, retries: totalRetries };
        break;
      } catch (err) {
        lastErr = err as Error;
        const errStr = String(err);
        if (errStr.includes('429') || errStr.includes('rate')) {
          totalRetries++;
          // Exponential backoff: 300ms, 900ms, 2700ms + jitter
          const delay = Math.pow(3, attempt) * 300 + Math.random() * 200;
          await new Promise((r) => setTimeout(r, delay));
        } else {
          throw err; // Non-retryable error
        }
      }
    }

    if (lastErr) throw lastErr; // All retries exhausted
  }

  return { trades: allTrades, pages, retries: totalRetries };
}

export async function fetchWalletActivity(
  walletAddress: string,
  conditionId?: string,
): Promise<PolymarketTrade[]> {
  const params = new URLSearchParams({
    user: walletAddress,
    type: 'TRADE',
    sortBy: 'TIMESTAMP',
    sortDirection: 'ASC',
  });
  if (conditionId) params.set('market', conditionId);

  const res = await fetch(`${DATA_API}/activity?${params}`);
  if (!res.ok) throw new Error(`Data /activity (wallet) failed: ${res.status}`);
  return res.json();
}

export interface MarketHolder {
  proxyWallet: string;
  size: number;
  outcome: string;
}

export async function fetchMarketHolders(conditionId: string): Promise<MarketHolder[]> {
  const res = await fetch(`${DATA_API}/holders?market=${conditionId}`);
  if (!res.ok) throw new Error(`Data /holders failed: ${res.status}`);
  return res.json();
}
