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
 * Fetch BTC Up or Down events directly from the Gamma events API.
 * These are nested under events (not standalone markets), tagged with
 * "up-or-down" + "bitcoin". Returns the inner market from each event.
 */
export async function fetchBtcUpDownEvents(limit = 10): Promise<GammaMarket[]> {
  const params = new URLSearchParams({
    active: 'true',
    closed: 'false',
    tag: 'up-or-down',
    limit: String(limit),
  });

  const res = await fetch(`${GAMMA_API}/events?${params}`);
  if (!res.ok) throw new Error(`Gamma /events (up-or-down) failed: ${res.status}`);
  const events: GammaEvent[] = await res.json();

  // Extract the inner market from each Bitcoin event
  const markets: GammaMarket[] = [];
  for (const event of events) {
    const isBtc = event.title.toLowerCase().includes('bitcoin')
      || event.title.toLowerCase().includes('btc');
    if (!isBtc) continue;
    for (const m of event.markets ?? []) {
      markets.push(m);
    }
  }
  return markets;
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
