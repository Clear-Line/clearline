/**
 * Analytics Engine — computes quantitative metrics for each active market.
 *
 * Metrics computed:
 *   Price Behavior:  momentum (1h/6h/24h), volatility (VIX), convergence speed, price reversion rate
 *   Volume/Flow:     VWAP, buy/sell ratio, smart money flow
 *   Order Book:      book imbalance, liquidity asymmetry
 *
 * Each metric has a coverage contract (minimum data requirements).
 * Each row gets: coverage_by_metric, coverage_score, missing_dependencies, is_publishable.
 * Markets that fail publishability checks are still stored but gated from serving.
 *
 * Writes to market_analytics table (one row per market, upserted).
 * Run every 15 minutes.
 */

import { supabaseAdmin } from '../supabase';

// ─── Types ───

export type MetricStatus = 'computed' | 'insufficient_data' | 'stale_data' | 'no_data';

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

interface MetricResult {
  value: number | null;
  status: MetricStatus;
}

// ─── Helpers ───

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sqDiffs = values.map((v) => (v - mean) ** 2);
  return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / (values.length - 1));
}

function timeSpanMinutes(snapshots: Snapshot[]): number {
  if (snapshots.length < 2) return 0;
  const times = snapshots.map((s) => new Date(s.timestamp).getTime());
  return (Math.max(...times) - Math.min(...times)) / 60000;
}

// ─── Metric Computations with Coverage Contracts ───

function computeMomentumC(
  snapshots: Snapshot[],
  hoursAgo: number,
  minSnaps: number,
  minSpanMin: number,
): MetricResult {
  if (snapshots.length === 0) return { value: null, status: 'no_data' };
  if (snapshots.length < minSnaps || timeSpanMinutes(snapshots) < minSpanMin) {
    return { value: null, status: 'insufficient_data' };
  }

  const now = new Date(snapshots[0].timestamp).getTime();
  const target = now - hoursAgo * 3600000;
  const currentPrice = snapshots[0].yes_price;

  let best: Snapshot | null = null;
  let bestDiff = Infinity;
  for (const s of snapshots) {
    const diff = Math.abs(new Date(s.timestamp).getTime() - target);
    if (diff < bestDiff) { bestDiff = diff; best = s; }
  }

  if (!best || best.yes_price === 0) return { value: null, status: 'insufficient_data' };
  return { value: (currentPrice - best.yes_price) / best.yes_price, status: 'computed' };
}

function computeVolatilityC(snapshots: Snapshot[]): MetricResult {
  if (snapshots.length === 0) return { value: null, status: 'no_data' };
  if (snapshots.length < 4) return { value: null, status: 'insufficient_data' };

  const sorted = [...snapshots]
    .filter((s) => s.yes_price > 0)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const logReturns: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    logReturns.push(Math.log(sorted[i].yes_price / sorted[i - 1].yes_price));
  }
  if (logReturns.length < 2) return { value: null, status: 'insufficient_data' };

  const sd = stddev(logReturns);
  return { value: sd * Math.sqrt(365 * 24 * 12), status: 'computed' };
}

function computeConvergenceC(
  currentPrice: number,
  endDate: string | null,
  startDate: string | null,
): MetricResult {
  if (!endDate) return { value: null, status: 'no_data' };

  const now = Date.now();
  const end = new Date(endDate).getTime();
  const start = startDate ? new Date(startDate).getTime() : end - 90 * 86400000;

  const totalDuration = end - start;
  const elapsed = now - start;
  if (totalDuration <= 0 || elapsed <= 0) return { value: null, status: 'insufficient_data' };

  const timeProgress = Math.min(elapsed / totalDuration, 1);
  const certainty = Math.abs(currentPrice - 0.5) * 2;
  if (timeProgress === 0) return { value: null, status: 'insufficient_data' };

  return { value: certainty / timeProgress, status: 'computed' };
}

function computeReversionC(snapshots: Snapshot[]): MetricResult {
  if (snapshots.length === 0) return { value: null, status: 'no_data' };
  if (snapshots.length < 8) return { value: null, status: 'insufficient_data' };
  if (timeSpanMinutes(snapshots) < 120) return { value: null, status: 'insufficient_data' };

  const sorted = [...snapshots].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const FORTY_EIGHT_H = 48 * 3600000;
  const THRESHOLD = 0.02;
  let sharpMoves = 0;
  let reversions = 0;
  const LOOKBACK = 6;

  for (let i = LOOKBACK; i < sorted.length; i++) {
    const move = sorted[i].yes_price - sorted[i - LOOKBACK].yes_price;
    if (Math.abs(move) < THRESHOLD) continue;
    sharpMoves++;

    const moveTime = new Date(sorted[i].timestamp).getTime();
    let maxRev = 0;
    for (let j = i + 1; j < sorted.length; j++) {
      if (new Date(sorted[j].timestamp).getTime() - moveTime > FORTY_EIGHT_H) break;
      const rev = sorted[j].yes_price - sorted[i].yes_price;
      if (Math.sign(rev) !== Math.sign(move)) {
        maxRev = Math.max(maxRev, Math.abs(rev) / Math.abs(move));
      }
    }
    if (maxRev >= 0.3) reversions++;
  }

  if (sharpMoves === 0) return { value: null, status: 'insufficient_data' };
  return { value: reversions / sharpMoves, status: 'computed' };
}

function computeVWAPC(trades: Trade[]): MetricResult {
  if (trades.length === 0) return { value: null, status: 'no_data' };
  if (trades.length < 2) return { value: null, status: 'insufficient_data' };

  let sumPV = 0, sumV = 0, totalUsdc = 0;
  for (const t of trades) {
    const tokens = Number(t.size_tokens) || 0;
    const price = Number(t.price) || 0;
    if (tokens > 0 && price > 0) {
      sumPV += price * tokens;
      sumV += tokens;
      totalUsdc += Number(t.size_usdc) || 0;
    }
  }
  if (sumV === 0 || totalUsdc < 50) return { value: null, status: 'insufficient_data' };
  return { value: sumPV / sumV, status: 'computed' };
}

function computeBuySellC(trades: Trade[]): MetricResult {
  if (trades.length === 0) return { value: null, status: 'no_data' };
  if (trades.length < 2) return { value: null, status: 'insufficient_data' };

  let buyVol = 0, sellVol = 0;
  for (const t of trades) {
    const usdc = Number(t.size_usdc) || 0;
    if (t.side === 'BUY') buyVol += usdc;
    else if (t.side === 'SELL') sellVol += usdc;
  }
  if (buyVol + sellVol === 0) return { value: null, status: 'insufficient_data' };
  if (sellVol === 0) return { value: 10, status: 'computed' };
  return { value: buyVol / sellVol, status: 'computed' };
}

function computeSmartMoneyC(trades: Trade[], smartWallets: Set<string>): MetricResult {
  if (smartWallets.size === 0) return { value: null, status: 'no_data' };

  let netFlow = 0, smartCount = 0, smartVol = 0;
  for (const t of trades) {
    if (!smartWallets.has(t.wallet_address)) continue;
    smartCount++;
    const usdc = Number(t.size_usdc) || 0;
    smartVol += usdc;
    if (t.side === 'BUY') netFlow += usdc;
    else if (t.side === 'SELL') netFlow -= usdc;
  }
  if (smartCount === 0) return { value: null, status: 'no_data' };
  if (smartCount < 1 || smartVol < 50) return { value: null, status: 'insufficient_data' };
  return { value: netFlow, status: 'computed' };
}

function computeBookImbalanceC(snapshot: Snapshot | null): MetricResult {
  if (!snapshot) return { value: null, status: 'no_data' };
  const bid = Number(snapshot.book_depth_bid_5c) || 0;
  const ask = Number(snapshot.book_depth_ask_5c) || 0;
  if (bid + ask === 0) return { value: null, status: 'insufficient_data' };
  return { value: bid / (bid + ask), status: 'computed' };
}

function computeLiqAsymmetryC(snapshot: Snapshot | null): MetricResult {
  if (!snapshot) return { value: null, status: 'no_data' };
  const up = Number(snapshot.cost_move_up_5pct) || 0;
  const down = Number(snapshot.cost_move_down_5pct) || 0;
  if (up === 0 && down === 0) return { value: null, status: 'insufficient_data' };
  if (down === 0) return { value: 10, status: 'computed' };
  return { value: up / down, status: 'computed' };
}

// ─── Coverage Evaluator ───

const METRIC_GROUPS = {
  price: ['momentum_1h', 'momentum_6h', 'momentum_24h', 'volatility_24h', 'convergence_speed', 'price_reversion_rate'],
  flow: ['vwap_24h', 'buy_sell_ratio', 'smart_money_flow'],
  book: ['book_imbalance', 'liquidity_asymmetry'],
};

const ALL_METRICS = [...METRIC_GROUPS.price, ...METRIC_GROUPS.flow, ...METRIC_GROUPS.book];

function evaluateCoverage(
  statuses: Record<string, MetricStatus>,
  snapCount: number,
  tradeCount: number,
  hasBook: boolean,
  snapAgeMin: number,
  tradeAgeMin: number,
): {
  coverageByMetric: Record<string, MetricStatus>;
  coverageScore: number;
  missingDependencies: string[];
  isPublishable: boolean;
} {
  const coverageByMetric = { ...statuses };
  const missing: string[] = [];

  // Freshness gates (relaxed for 2h cron intervals)
  const snapFresh = snapAgeMin <= 180;
  const tradeFresh = tradeCount === 0 || tradeAgeMin <= 720;

  if (!snapFresh) {
    missing.push('stale_snapshots');
    for (const m of METRIC_GROUPS.price) {
      if (coverageByMetric[m] === 'computed') coverageByMetric[m] = 'stale_data';
    }
  }
  if (!tradeFresh && tradeCount > 0) {
    missing.push('stale_trades');
    for (const m of METRIC_GROUPS.flow) {
      if (coverageByMetric[m] === 'computed') coverageByMetric[m] = 'stale_data';
    }
  }

  if (snapCount < 2) missing.push('not_enough_snapshots');
  if (tradeCount === 0) missing.push('no_trades');
  else if (tradeCount < 5) missing.push('not_enough_trades');
  if (!hasBook) missing.push('book_depth_missing');

  const computedCount = ALL_METRICS.filter((m) => coverageByMetric[m] === 'computed').length;
  const priceOk = METRIC_GROUPS.price.some((m) => coverageByMetric[m] === 'computed');

  // Score: 60pts metric completeness + 20pts freshness + 20pts dependency density
  const completeness = computedCount / ALL_METRICS.length;
  const freshScore = (snapFresh ? 0.5 : 0) + (tradeFresh ? 0.5 : 0);
  const depScore = Math.min(snapCount / 20, 1) * 0.4 +
    Math.min(tradeCount / 20, 1) * 0.4 +
    (hasBook ? 0.2 : 0);

  const coverageScore = Math.round(completeness * 60 + freshScore * 20 + depScore * 20);

  // Publishable: >=2 computed metrics, price group has 1+, fresh snapshots
  const isPublishable = computedCount >= 2 && priceOk && snapFresh;

  return { coverageByMetric, coverageScore, missingDependencies: missing, isPublishable };
}

// ─── Main Engine ───

export async function computeAnalytics(): Promise<{
  computed: number;
  publishable: number;
  errors: string[];
  telemetry: {
    marketsProcessed: number;
    marketsSkipped: number;
    smartWalletCount: number;
    avgCoverageScore: number;
  };
}> {
  const errors: string[] = [];
  let computed = 0;
  let publishable = 0;
  let totalCoverage = 0;
  let skipped = 0;

  const twoDaysAgo = new Date(Date.now() - 48 * 3600000).toISOString();
  const { data: recentSnaps } = await supabaseAdmin
    .from('market_snapshots')
    .select('market_id')
    .gte('timestamp', twoDaysAgo)
    .limit(5000);

  const activeMarketIds = [...new Set((recentSnaps ?? []).map((s) => s.market_id))];
  if (activeMarketIds.length === 0) {
    return { computed: 0, publishable: 0, errors: ['No markets with recent snapshots found'],
      telemetry: { marketsProcessed: 0, marketsSkipped: 0, smartWalletCount: 0, avgCoverageScore: 0 } };
  }

  const markets: { condition_id: string; start_date: string | null; end_date: string | null }[] = [];
  const META_BATCH = 200;
  for (let i = 0; i < activeMarketIds.length; i += META_BATCH) {
    const batch = activeMarketIds.slice(i, i + META_BATCH);
    const { data, error: mErr } = await supabaseAdmin
      .from('markets')
      .select('condition_id, start_date, end_date')
      .in('condition_id', batch)
      .eq('is_active', true);
    if (mErr) { errors.push(`Market metadata batch ${i}: ${mErr.message}`); continue; }
    if (data) markets.push(...data);
  }

  if (markets.length === 0) {
    return { computed: 0, publishable: 0, errors: ['No active markets with recent snapshots'],
      telemetry: { marketsProcessed: 0, marketsSkipped: 0, smartWalletCount: 0, avgCoverageScore: 0 } };
  }

  const { data: smartWalletRows } = await supabaseAdmin
    .from('wallets')
    .select('address')
    .gt('accuracy_score', 0.60)
    .gt('accuracy_sample_size', 3);

  const smartWallets = new Set(
    (smartWalletRows ?? []).map((w: { address: string }) => w.address),
  );

  const ID_BATCH = 50;
  const analyticsRows: Record<string, unknown>[] = [];

  for (let i = 0; i < markets.length; i += ID_BATCH) {
    const batch = markets.slice(i, i + ID_BATCH);
    const batchIds = batch.map((m) => m.condition_id);

    const { data: snapshots } = await supabaseAdmin
      .from('market_snapshots')
      .select('market_id, yes_price, timestamp, book_depth_bid_5c, book_depth_ask_5c, cost_move_up_5pct, cost_move_down_5pct')
      .in('market_id', batchIds)
      .gte('timestamp', twoDaysAgo)
      .order('timestamp', { ascending: false });

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: trades } = await supabaseAdmin
      .from('trades')
      .select('market_id, price, size_tokens, size_usdc, side, wallet_address, timestamp')
      .in('market_id', batchIds)
      .gte('timestamp', sevenDaysAgo);

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

    for (const market of batch) {
      try {
        const mSnaps = snapsByMarket.get(market.condition_id) ?? [];
        const mTrades = tradesByMarket.get(market.condition_id) ?? [];

        if (mSnaps.length === 0) { skipped++; continue; }

        const latestWithBook = mSnaps.find(
          (s) => s.book_depth_bid_5c != null || s.book_depth_ask_5c != null,
        ) ?? null;

        const currentPrice = mSnaps[0].yes_price;

        // Freshness
        const snapAgeMin = (Date.now() - new Date(mSnaps[0].timestamp).getTime()) / 60000;
        const tradeAgeMin = mTrades.length > 0
          ? (Date.now() - Math.max(...mTrades.map((t) => new Date(t.timestamp).getTime()))) / 60000
          : Infinity;

        // Compute metrics with contracts
        const m1h = computeMomentumC(mSnaps, 1, 2, 15);
        const m6h = computeMomentumC(mSnaps, 6, 2, 60);
        const m24h = computeMomentumC(mSnaps, 24, 3, 180);
        const vol = computeVolatilityC(mSnaps);
        const conv = computeConvergenceC(currentPrice, market.end_date, market.start_date);
        const rev = computeReversionC(mSnaps);
        const vwap = computeVWAPC(mTrades);
        const bsr = computeBuySellC(mTrades);
        const smf = computeSmartMoneyC(mTrades, smartWallets);
        const bi = computeBookImbalanceC(latestWithBook);
        const la = computeLiqAsymmetryC(latestWithBook);

        const statuses: Record<string, MetricStatus> = {
          momentum_1h: m1h.status, momentum_6h: m6h.status, momentum_24h: m24h.status,
          volatility_24h: vol.status, convergence_speed: conv.status, price_reversion_rate: rev.status,
          vwap_24h: vwap.status, buy_sell_ratio: bsr.status, smart_money_flow: smf.status,
          book_imbalance: bi.status, liquidity_asymmetry: la.status,
        };

        const coverage = evaluateCoverage(
          statuses, mSnaps.length, mTrades.length, latestWithBook !== null, snapAgeMin, tradeAgeMin,
        );

        totalCoverage += coverage.coverageScore;
        if (coverage.isPublishable) publishable++;

        analyticsRows.push({
          market_id: market.condition_id,
          computed_at: new Date().toISOString(),
          momentum_1h: m1h.value,
          momentum_6h: m6h.value,
          momentum_24h: m24h.value,
          volatility_24h: vol.value,
          convergence_speed: conv.value,
          price_reversion_rate: rev.value,
          vwap_24h: vwap.value,
          buy_sell_ratio: bsr.value,
          smart_money_flow: smf.value,
          book_imbalance: bi.value,
          liquidity_asymmetry: la.value,
          is_publishable: coverage.isPublishable,
          coverage_score: coverage.coverageScore,
          missing_dependencies: coverage.missingDependencies,
          coverage_by_metric: coverage.coverageByMetric,
        });
      } catch (err) {
        errors.push(`Analytics ${market.condition_id}: ${err}`);
      }
    }
  }

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

  return {
    computed,
    publishable,
    errors,
    telemetry: {
      marketsProcessed: analyticsRows.length,
      marketsSkipped: skipped,
      smartWalletCount: smartWallets.size,
      avgCoverageScore: analyticsRows.length > 0 ? Math.round(totalCoverage / analyticsRows.length) : 0,
    },
  };
}
