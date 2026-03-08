/**
 * Analytics Engine — computes quantitative metrics for each active market.
 *
 * Metrics computed:
 *   Price Behavior:  momentum (1h/6h/24h), volatility (VIX), convergence speed, price reversion rate
 *   Volume/Flow:     VWAP, buy/sell ratio, smart money flow
 *   Order Book:      book imbalance, liquidity asymmetry
 *
 * Writes to market_analytics table (one row per market, upserted).
 * Run every 15 minutes.
 */

import { supabaseAdmin } from '../supabase';

// ─── Helpers ───

/** Standard deviation of an array of numbers. */
function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sqDiffs = values.map((v) => (v - mean) ** 2);
  return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / (values.length - 1));
}

// ─── Metric Computations ───

interface Snapshot {
  yes_price: number;
  timestamp: string;
  book_depth_bid_5c: number | null;
  book_depth_ask_5c: number | null;
  cost_move_up_5pct: number | null;
  cost_move_down_5pct: number | null;
}

interface Trade {
  price: number;
  size_tokens: number;
  size_usdc: number;
  side: string;
  wallet_address: string;
  timestamp: string;
}

/**
 * Compute momentum: (price_now - price_Xh_ago) / price_Xh_ago
 */
function computeMomentum(
  snapshots: Snapshot[],
  hoursAgo: number,
): number | null {
  if (snapshots.length < 2) return null;

  const now = new Date(snapshots[0].timestamp).getTime();
  const target = now - hoursAgo * 60 * 60 * 1000;
  const currentPrice = snapshots[0].yes_price;

  // Find snapshot closest to target time
  let best: Snapshot | null = null;
  let bestDiff = Infinity;
  for (const s of snapshots) {
    const t = new Date(s.timestamp).getTime();
    const diff = Math.abs(t - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = s;
    }
  }

  if (!best || best.yes_price === 0) return null;
  return (currentPrice - best.yes_price) / best.yes_price;
}

/**
 * Compute realized volatility (prediction market VIX).
 * Standard deviation of log returns, annualized.
 */
function computeVolatility(snapshots: Snapshot[]): number | null {
  if (snapshots.length < 3) return null;

  // Sort ascending by time for sequential returns
  const sorted = [...snapshots].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const logReturns: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].yes_price;
    const curr = sorted[i].yes_price;
    if (prev > 0 && curr > 0) {
      logReturns.push(Math.log(curr / prev));
    }
  }

  if (logReturns.length < 2) return null;

  const sd = stddev(logReturns);
  // Annualize: ~12 snapshots per hour * 24h * 365d
  const annualized = sd * Math.sqrt(365 * 24 * 12);
  return annualized;
}

/**
 * Convergence speed: how fast the market is moving toward certainty (0 or 1)
 * relative to time remaining. Higher = faster convergence.
 */
function computeConvergenceSpeed(
  currentPrice: number,
  endDate: string | null,
  startDate: string | null,
): number | null {
  if (!endDate) return null;

  const now = Date.now();
  const end = new Date(endDate).getTime();
  const start = startDate ? new Date(startDate).getTime() : end - 90 * 24 * 60 * 60 * 1000; // default 90d

  const totalDuration = end - start;
  const elapsed = now - start;
  if (totalDuration <= 0 || elapsed <= 0) return null;

  const timeProgress = Math.min(elapsed / totalDuration, 1); // 0-1, how far through the market's life
  const certainty = Math.abs(currentPrice - 0.5) * 2; // 0-1, how far from 50/50

  // If the market is ahead of schedule in converging, speed > 1
  if (timeProgress === 0) return null;
  return certainty / timeProgress;
}

/**
 * Price reversion rate: what % of sharp moves (>5% in 1h) retrace within 48h.
 * Requires enough historical data.
 */
function computePriceReversionRate(snapshots: Snapshot[]): number | null {
  if (snapshots.length < 20) return null; // need some data but not 100+

  const sorted = [...snapshots].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000;
  const MOVE_THRESHOLD = 0.02; // 2% price move (prediction markets move in small increments)

  let sharpMoves = 0;
  let reversions = 0;

  // Use 6-snapshot lookback (~30min) instead of 12 (~1h) — captures faster moves
  const LOOKBACK = 6;
  for (let i = LOOKBACK; i < sorted.length; i++) {
    const past = sorted[i - LOOKBACK];
    const current = sorted[i];
    const move = current.yes_price - past.yes_price;

    if (Math.abs(move) < MOVE_THRESHOLD) continue;
    sharpMoves++;

    // Look forward up to 48h for reversion
    const moveTime = new Date(current.timestamp).getTime();
    let maxReversion = 0;

    for (let j = i + 1; j < sorted.length; j++) {
      const futureTime = new Date(sorted[j].timestamp).getTime();
      if (futureTime - moveTime > FORTY_EIGHT_HOURS) break;

      const reversion = sorted[j].yes_price - current.yes_price;
      // Reversion is opposite direction to the move
      if (Math.sign(reversion) !== Math.sign(move)) {
        maxReversion = Math.max(maxReversion, Math.abs(reversion) / Math.abs(move));
      }
    }

    if (maxReversion >= 0.3) reversions++; // at least 30% retracement
  }

  if (sharpMoves === 0) return null;
  return reversions / sharpMoves;
}

/**
 * VWAP: volume-weighted average price from trades.
 */
function computeVWAP(trades: Trade[]): number | null {
  if (trades.length === 0) return null;

  let sumPriceVolume = 0;
  let sumVolume = 0;

  for (const t of trades) {
    const tokens = Number(t.size_tokens) || 0;
    const price = Number(t.price) || 0;
    if (tokens > 0 && price > 0) {
      sumPriceVolume += price * tokens;
      sumVolume += tokens;
    }
  }

  if (sumVolume === 0) return null;
  return sumPriceVolume / sumVolume;
}

/**
 * Buy/sell ratio: total buy volume / total sell volume.
 * > 1 means more buying pressure.
 */
function computeBuySellRatio(trades: Trade[]): number | null {
  let buyVol = 0;
  let sellVol = 0;

  for (const t of trades) {
    const usdc = Number(t.size_usdc) || 0;
    if (t.side === 'BUY') buyVol += usdc;
    else if (t.side === 'SELL') sellVol += usdc;
  }

  if (sellVol === 0) return buyVol > 0 ? 10 : null; // cap at 10 if no sells
  return buyVol / sellVol;
}

/**
 * Smart money flow: net USD flow from wallets with accuracy > 70%.
 * Positive = net buying by smart money.
 */
function computeSmartMoneyFlow(
  trades: Trade[],
  smartWallets: Set<string>,
): number | null {
  if (smartWallets.size === 0) return null;

  let netFlow = 0;
  let hasSmartTrades = false;

  for (const t of trades) {
    if (!smartWallets.has(t.wallet_address)) continue;
    hasSmartTrades = true;
    const usdc = Number(t.size_usdc) || 0;
    if (t.side === 'BUY') netFlow += usdc;
    else if (t.side === 'SELL') netFlow -= usdc;
  }

  return hasSmartTrades ? netFlow : null;
}

/**
 * Book imbalance: bid_depth / (bid_depth + ask_depth).
 * > 0.5 means more bid support (buying pressure).
 */
function computeBookImbalance(snapshot: Snapshot | null): number | null {
  if (!snapshot) return null;
  const bid = Number(snapshot.book_depth_bid_5c) || 0;
  const ask = Number(snapshot.book_depth_ask_5c) || 0;
  if (bid + ask === 0) return null;
  return bid / (bid + ask);
}

/**
 * Liquidity asymmetry: cost to move up / cost to move down.
 * > 1 means it's more expensive to push price up (stronger asks).
 */
function computeLiquidityAsymmetry(snapshot: Snapshot | null): number | null {
  if (!snapshot) return null;
  const up = Number(snapshot.cost_move_up_5pct) || 0;
  const down = Number(snapshot.cost_move_down_5pct) || 0;
  if (down === 0) return up > 0 ? 10 : null;
  return up / down;
}

// ─── Main Engine ───

export async function computeAnalytics(): Promise<{
  computed: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let computed = 0;

  // Get markets that actually have recent snapshots (not all 37K+ active markets)
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data: recentSnaps } = await supabaseAdmin
    .from('market_snapshots')
    .select('market_id')
    .gte('timestamp', twoDaysAgo)
    .limit(5000);

  const activeMarketIds = [...new Set((recentSnaps ?? []).map((s) => s.market_id))];

  if (activeMarketIds.length === 0) {
    return { computed: 0, errors: ['No markets with recent snapshots found'] };
  }

  // Fetch metadata only for markets with data
  const markets: { condition_id: string; start_date: string | null; end_date: string | null }[] = [];
  const META_BATCH = 200;
  for (let i = 0; i < activeMarketIds.length; i += META_BATCH) {
    const batch = activeMarketIds.slice(i, i + META_BATCH);
    const { data, error: mErr } = await supabaseAdmin
      .from('markets')
      .select('condition_id, start_date, end_date')
      .in('condition_id', batch)
      .eq('is_active', true);
    if (mErr) {
      errors.push(`Market metadata batch ${i}: ${mErr.message}`);
      continue;
    }
    if (data) markets.push(...data);
  }

  if (markets.length === 0) {
    return { computed: 0, errors: ['No active markets with recent snapshots'] };
  }

  // Get smart wallets (accuracy > 0.60 with meaningful sample)
  const { data: smartWalletRows } = await supabaseAdmin
    .from('wallets')
    .select('address')
    .gt('accuracy_score', 0.60)
    .gt('accuracy_sample_size', 3);

  const smartWallets = new Set(
    (smartWalletRows ?? []).map((w: { address: string }) => w.address),
  );

  // Process markets in batches
  const ID_BATCH = 50;
  const analyticsRows: Record<string, unknown>[] = [];

  for (let i = 0; i < markets.length; i += ID_BATCH) {
    const batch = markets.slice(i, i + ID_BATCH);
    const batchIds = batch.map((m) => m.condition_id);

    // Fetch snapshots for this batch (last ~48h for reversion analysis)
    const { data: snapshots } = await supabaseAdmin
      .from('market_snapshots')
      .select('market_id, yes_price, timestamp, book_depth_bid_5c, book_depth_ask_5c, cost_move_up_5pct, cost_move_down_5pct')
      .in('market_id', batchIds)
      .gte('timestamp', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
      .order('timestamp', { ascending: false });

    // Fetch trades for this batch (last 7 days — wider window so more markets get VWAP/BSR)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: trades } = await supabaseAdmin
      .from('trades')
      .select('market_id, price, size_tokens, size_usdc, side, wallet_address, timestamp')
      .in('market_id', batchIds)
      .gte('timestamp', sevenDaysAgo);

    // Group data by market
    const snapsByMarket = new Map<string, Snapshot[]>();
    for (const s of snapshots ?? []) {
      if (!snapsByMarket.has(s.market_id)) snapsByMarket.set(s.market_id, []);
      snapsByMarket.get(s.market_id)!.push(s);
    }

    const tradesByMarket = new Map<string, Trade[]>();
    for (const t of trades ?? []) {
      if (!tradesByMarket.has(t.market_id)) tradesByMarket.set(t.market_id, []);
      tradesByMarket.get(t.market_id)!.push(t);
    }

    // Compute metrics for each market
    for (const market of batch) {
      try {
        const mSnaps = snapsByMarket.get(market.condition_id) ?? [];
        const mTrades = tradesByMarket.get(market.condition_id) ?? [];

        if (mSnaps.length === 0) continue;

        // Latest snapshot with book data
        const latestWithBook = mSnaps.find(
          (s) => s.book_depth_bid_5c != null || s.book_depth_ask_5c != null,
        ) ?? null;

        const currentPrice = mSnaps[0].yes_price;

        analyticsRows.push({
          market_id: market.condition_id,
          computed_at: new Date().toISOString(),
          momentum_1h: computeMomentum(mSnaps, 1),
          momentum_6h: computeMomentum(mSnaps, 6),
          momentum_24h: computeMomentum(mSnaps, 24),
          volatility_24h: computeVolatility(mSnaps),
          convergence_speed: computeConvergenceSpeed(currentPrice, market.end_date, market.start_date),
          price_reversion_rate: computePriceReversionRate(mSnaps),
          vwap_24h: computeVWAP(mTrades),
          buy_sell_ratio: computeBuySellRatio(mTrades),
          smart_money_flow: computeSmartMoneyFlow(mTrades, smartWallets),
          book_imbalance: computeBookImbalance(latestWithBook),
          liquidity_asymmetry: computeLiquidityAsymmetry(latestWithBook),
        });
      } catch (err) {
        errors.push(`Analytics ${market.condition_id}: ${err}`);
      }
    }
  }

  // Batch upsert analytics
  const UPSERT_BATCH = 500;
  for (let i = 0; i < analyticsRows.length; i += UPSERT_BATCH) {
    const chunk = analyticsRows.slice(i, i + UPSERT_BATCH);
    const { error } = await supabaseAdmin
      .from('market_analytics')
      .upsert(chunk, { onConflict: 'market_id' });

    if (error) {
      errors.push(`Analytics upsert batch ${i}: ${error.message}`);
    } else {
      computed += chunk.length;
    }
  }

  return { computed, errors };
}
