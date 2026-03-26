/**
 * Candidate Ranker — synthesizes edge scores, analytics metrics, and market data
 * into a single ranked list of trading opportunities.
 *
 * Score: candidate_score = mispricing_score * tradability_score
 *
 * Reads from:
 *   - BigQuery: market_edge, market_analytics, market_snapshots
 *   - Supabase: markets (spread, end_date)
 *
 * Writes to:
 *   - BigQuery: candidate_scores (one row per market, upserted)
 */

import { bq } from '../core/bigquery.js';
import { supabaseAdmin } from '../core/supabase.js';

// ─── Types ───

interface EdgeRow {
  market_id: string;
  edge_score: number;
  edge_direction: string;
  smart_money_strength: number | null;
  whale_strength: number | null;
  volume_price_strength: number | null;
  ema_strength: number | null;
  edge_reasoning: string | null;
}

interface AnalyticsRow {
  market_id: string;
  momentum_24h: number | null;
  buy_sell_ratio: number | null;
  book_imbalance: number | null;
  liquidity_asymmetry: number | null;
  volatility_24h: number | null;
}

interface MarketRow {
  condition_id: string;
  end_date: string | null;
}

interface SnapshotRow {
  market_id: string;
  volume_24h: number;
  spread: number | null;
}

// ─── Helpers ───

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Bell curve centered at `peak` with width `width`. Returns 0-1. */
function bellCurve(value: number, peak: number, width: number): number {
  const x = (value - peak) / width;
  return Math.exp(-0.5 * x * x);
}

// ─── Mispricing Score (0-1) ───

function computeMispricingScore(edge: EdgeRow, analytics: AnalyticsRow | null): number {
  let score = 0;
  let totalWeight = 0;

  // 30% edge_score / 100
  const edgeNorm = clamp((edge.edge_score ?? 50) / 100, 0, 1);
  // Distance from neutral (0.5) — strong signals in either direction score high
  const edgeSignal = Math.abs(edgeNorm - 0.5) * 2;
  score += edgeSignal * 0.30;
  totalWeight += 0.30;

  // 20% |momentum_24h| normalized
  if (analytics?.momentum_24h != null) {
    const momSignal = clamp(Math.abs(analytics.momentum_24h) / 0.15, 0, 1);
    score += momSignal * 0.20;
    totalWeight += 0.20;
  }

  // 15% |buy_sell_ratio - 1| normalized
  if (analytics?.buy_sell_ratio != null) {
    const bsDeviation = clamp(Math.abs(analytics.buy_sell_ratio - 1) / 3, 0, 1);
    score += bsDeviation * 0.15;
    totalWeight += 0.15;
  }

  // 15% smart_money_strength
  if (edge.smart_money_strength != null) {
    score += clamp(edge.smart_money_strength, 0, 1) * 0.15;
    totalWeight += 0.15;
  }

  // 10% whale_strength
  if (edge.whale_strength != null) {
    score += clamp(edge.whale_strength, 0, 1) * 0.10;
    totalWeight += 0.10;
  }

  // 10% volume_price_strength
  if (edge.volume_price_strength != null) {
    score += clamp(edge.volume_price_strength, 0, 1) * 0.10;
    totalWeight += 0.10;
  }

  // Normalize by actual weight used (handles missing data gracefully)
  return totalWeight > 0 ? score / totalWeight : 0;
}

// ─── Tradability Score (0-1) ───

function computeTradabilityScore(
  snapshot: SnapshotRow | null,
  analytics: AnalyticsRow | null,
  market: MarketRow | null,
): number {
  let score = 0;
  let totalWeight = 0;

  // 25% spread (tighter = better)
  if (snapshot?.spread != null && snapshot.spread > 0) {
    const spreadScore = clamp(1 - (snapshot.spread / 0.10), 0, 1);
    score += spreadScore * 0.25;
    totalWeight += 0.25;
  }

  // 20% book_imbalance strength as depth proxy
  // Imbalance close to 0.5 = balanced book = good depth
  if (analytics?.book_imbalance != null) {
    const balanceScore = 1 - Math.abs(analytics.book_imbalance - 0.5) * 2;
    score += clamp(balanceScore, 0, 1) * 0.20;
    totalWeight += 0.20;
  }

  // 20% liquidity_asymmetry (symmetric = tradable)
  if (analytics?.liquidity_asymmetry != null) {
    // Lower asymmetry is better (0 = perfectly symmetric)
    const symScore = clamp(1 - Math.abs(analytics.liquidity_asymmetry), 0, 1);
    score += symScore * 0.20;
    totalWeight += 0.20;
  }

  // 20% time-to-resolution (bell curve, peak 14 days, width 20 days)
  if (market?.end_date) {
    const daysToResolution = (new Date(market.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    if (daysToResolution > 0) {
      score += bellCurve(daysToResolution, 14, 20) * 0.20;
      totalWeight += 0.20;
    }
  }

  // 15% 24h volume
  if (snapshot?.volume_24h != null) {
    const volScore = clamp(snapshot.volume_24h / 100000, 0, 1);
    score += volScore * 0.15;
    totalWeight += 0.15;
  }

  return totalWeight > 0 ? score / totalWeight : 0;
}

// ─── Main Engine ───

export async function computeCandidateScores(): Promise<{
  computed: number;
  errors: string[];
  telemetry: {
    marketsProcessed: number;
    avgCandidateScore: number;
    topScore: number;
    filteredOut: number;
    duration_ms: number;
  };
}> {
  const startTime = Date.now();
  const errors: string[] = [];
  let filteredOut = 0;

  // Step 1: Fetch all edge scores
  const { data: edgeRows, error: edgeErr } = await bq
    .from('market_edge')
    .select('market_id, edge_score, edge_direction, smart_money_strength, whale_strength, volume_price_strength, ema_strength, edge_reasoning');

  if (edgeErr || !edgeRows || edgeRows.length === 0) {
    return {
      computed: 0,
      errors: [edgeErr?.message || 'No edge data found'],
      telemetry: { marketsProcessed: 0, avgCandidateScore: 0, topScore: 0, filteredOut: 0, duration_ms: Date.now() - startTime },
    };
  }

  const edgeByMarket = new Map<string, EdgeRow>();
  for (const e of edgeRows) edgeByMarket.set(e.market_id, e);

  const marketIds = [...edgeByMarket.keys()];

  // Step 2: Fetch analytics (parallel with snapshots and markets)
  const ID_BATCH = 200;
  const [analyticsRows, snapshotRows, marketRows] = await Promise.all([
    fetchAllBatched<AnalyticsRow>('market_analytics', 'market_id, momentum_24h, buy_sell_ratio, book_imbalance, liquidity_asymmetry, volatility_24h', marketIds, ID_BATCH),
    fetchLatestSnapshots(marketIds, ID_BATCH),
    fetchMarketMeta(marketIds, ID_BATCH),
  ]);

  const analyticsByMarket = new Map<string, AnalyticsRow>();
  for (const a of analyticsRows) analyticsByMarket.set(a.market_id, a);

  const snapshotByMarket = new Map<string, SnapshotRow>();
  for (const s of snapshotRows) snapshotByMarket.set(s.market_id, s);

  const marketByCondition = new Map<string, MarketRow>();
  for (const m of marketRows) marketByCondition.set(m.condition_id, m);

  // Step 3: Score every market
  const candidateRows: Record<string, unknown>[] = [];
  let totalScore = 0;
  let topScore = 0;

  for (const marketId of marketIds) {
    const edge = edgeByMarket.get(marketId)!;
    const analytics = analyticsByMarket.get(marketId) ?? null;
    const snapshot = snapshotByMarket.get(marketId) ?? null;
    const market = marketByCondition.get(marketId) ?? null;

    const mispricingScore = computeMispricingScore(edge, analytics);
    const tradabilityScore = computeTradabilityScore(snapshot, analytics, market);

    // Filter: tradability too low = not actionable
    if (tradabilityScore < 0.2) {
      filteredOut++;
      continue;
    }

    const candidateScore = mispricingScore * tradabilityScore;
    totalScore += candidateScore;
    if (candidateScore > topScore) topScore = candidateScore;

    // Parse edge reasoning
    let topSignals: string[] = [];
    try {
      if (edge.edge_reasoning) topSignals = JSON.parse(edge.edge_reasoning);
    } catch { /* ignore parse errors */ }

    candidateRows.push({
      market_id: marketId,
      candidate_score: Math.round(candidateScore * 10000) / 10000,
      mispricing_score: Math.round(mispricingScore * 10000) / 10000,
      tradability_score: Math.round(tradabilityScore * 10000) / 10000,
      edge_component: Math.round((Math.abs((edge.edge_score ?? 50) / 100 - 0.5) * 2) * 10000) / 10000,
      momentum_component: analytics?.momentum_24h != null ? Math.round(clamp(Math.abs(analytics.momentum_24h) / 0.15, 0, 1) * 10000) / 10000 : null,
      flow_component: analytics?.buy_sell_ratio != null ? Math.round(clamp(Math.abs(analytics.buy_sell_ratio - 1) / 3, 0, 1) * 10000) / 10000 : null,
      smart_money_component: edge.smart_money_strength != null ? Math.round(clamp(edge.smart_money_strength, 0, 1) * 10000) / 10000 : null,
      whale_component: edge.whale_strength != null ? Math.round(clamp(edge.whale_strength, 0, 1) * 10000) / 10000 : null,
      divergence_component: edge.volume_price_strength != null ? Math.round(clamp(edge.volume_price_strength, 0, 1) * 10000) / 10000 : null,
      spread_component: snapshot?.spread != null ? Math.round(clamp(1 - (snapshot.spread / 0.10), 0, 1) * 10000) / 10000 : null,
      volume_component: snapshot?.volume_24h != null ? Math.round(clamp(snapshot.volume_24h / 100000, 0, 1) * 10000) / 10000 : null,
      edge_direction: edge.edge_direction,
      top_signals: JSON.stringify(topSignals.slice(0, 5)),
      computed_at: new Date().toISOString(),
    });
  }

  // Step 4: Upsert to BigQuery
  let computed = 0;
  const UPSERT_BATCH = 500;
  for (let i = 0; i < candidateRows.length; i += UPSERT_BATCH) {
    const chunk = candidateRows.slice(i, i + UPSERT_BATCH);
    const { error } = await bq
      .from('candidate_scores')
      .upsert(chunk, { onConflict: 'market_id' });

    if (error) {
      errors.push(`Candidate upsert batch ${i}: ${error.message}`);
    } else {
      computed += chunk.length;
    }
  }

  return {
    computed,
    errors: errors.slice(0, 20),
    telemetry: {
      marketsProcessed: candidateRows.length,
      avgCandidateScore: candidateRows.length > 0 ? Math.round((totalScore / candidateRows.length) * 10000) / 10000 : 0,
      topScore: Math.round(topScore * 10000) / 10000,
      filteredOut,
      duration_ms: Date.now() - startTime,
    },
  };
}

// ─── Helpers ───

async function fetchAllBatched<T>(table: string, select: string, ids: string[], batchSize: number): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const { data } = await bq.from(table).select(select).in('market_id', batch);
    if (data) results.push(...data);
  }
  return results;
}

async function fetchLatestSnapshots(ids: string[], batchSize: number): Promise<SnapshotRow[]> {
  const results: SnapshotRow[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const { data } = await bq
      .from('market_snapshots')
      .select('market_id, volume_24h, spread')
      .in('market_id', batch)
      .order('timestamp', { ascending: false });
    if (data) {
      for (const s of data) {
        if (!seen.has(s.market_id)) {
          seen.add(s.market_id);
          results.push(s);
        }
      }
    }
  }
  return results;
}

async function fetchMarketMeta(ids: string[], batchSize: number): Promise<MarketRow[]> {
  const results: MarketRow[] = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const { data } = await supabaseAdmin
      .from('markets')
      .select('condition_id, end_date')
      .in('condition_id', batch);
    if (data) results.push(...data);
  }
  return results;
}
