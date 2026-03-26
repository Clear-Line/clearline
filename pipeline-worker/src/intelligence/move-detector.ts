/**
 * Wallet Cluster Detection Engine
 *
 * Detects suspicious wallet clusters in political/economic prediction markets:
 *   1. Fetches flagged wallets (high composite_score from Tier 1 analysis)
 *   2. Finds markets where multiple flagged wallets trade the same direction
 *   3. Computes cluster score, concentration, informed activity index
 *   4. Stores results in flagged_moves table
 */

import { bq } from '../core/bigquery.js';

// ---- Config ----

const CLUSTER_COMPOSITE_THRESHOLD = 0.4; // min composite_score to be "flagged"
const MIN_CLUSTER_SIZE = 2;              // need at least 2 flagged wallets
const MIN_DIRECTIONAL_RATIO = 0.6;       // at least 60% agreement on side
const LOOKBACK_HOURS = 24;               // scan last 24h of trades
const DEDUP_COOLDOWN_HOURS = 12;         // allow re-flagging same market after 12h
const PAGE_SIZE = 1000;                  // rows per paginated fetch

// ---- Types ----

interface TradeRow {
  wallet_address: string;
  market_id: string;
  side: string;
  size_usdc: number;
  timestamp: string;
}

interface SignalRow {
  wallet_address: string;
  market_id: string;
  composite_score: number;
}

interface SnapshotRow {
  market_id: string;
  timestamp: string;
  yes_price: number;
  book_depth_bid_5c: number | null;
}

// ---- Paginated fetch helpers ----

async function fetchSignalsPaginated(): Promise<{ data: SignalRow[]; error: string | null }> {
  const all: SignalRow[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await bq
      .from('wallet_signals')
      .select('wallet_address, market_id, composite_score')
      .gt('composite_score', CLUSTER_COMPOSITE_THRESHOLD)
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) return { data: all, error: error.message };
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return { data: all, error: null };
}

async function fetchRecentTradesPaginated(sinceISO: string): Promise<{ data: TradeRow[]; error: string | null }> {
  const all: TradeRow[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await bq
      .from('trades')
      .select('wallet_address, market_id, side, size_usdc, timestamp')
      .gte('timestamp', sinceISO)
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) return { data: all, error: error.message };
    if (!data || data.length === 0) break;
    all.push(...(data as TradeRow[]));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return { data: all, error: null };
}

async function fetchSnapshotsPaginated(marketIds: string[], sinceISO: string): Promise<{ data: SnapshotRow[]; error: string | null }> {
  const all: SnapshotRow[] = [];
  // Fetch only snapshots for relevant markets within the lookback window
  const BATCH = 200;
  for (let i = 0; i < marketIds.length; i += BATCH) {
    const idBatch = marketIds.slice(i, i + BATCH);
    let offset = 0;
    while (true) {
      const { data, error } = await bq
        .from('market_snapshots')
        .select('market_id, timestamp, yes_price, book_depth_bid_5c')
        .in('market_id', idBatch)
        .gte('timestamp', sinceISO)
        .order('timestamp', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) return { data: all, error: error.message };
      if (!data || data.length === 0) break;
      all.push(...(data as SnapshotRow[]));
      if (data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  }
  return { data: all, error: null };
}

// ---- Wallet Concentration ----

function computeWalletConcentration(trades: TradeRow[]): {
  top1: number;
  top3: number;
  top5: number;
} {
  const volumeByWallet = new Map<string, number>();
  let totalVolume = 0;

  for (const t of trades) {
    const vol = Number(t.size_usdc) || 0;
    volumeByWallet.set(t.wallet_address, (volumeByWallet.get(t.wallet_address) || 0) + vol);
    totalVolume += vol;
  }

  if (totalVolume === 0) return { top1: 0, top3: 0, top5: 0 };

  const sorted = [...volumeByWallet.values()].sort((a, b) => b - a);

  const top1 = sorted[0] / totalVolume;
  const top3 = sorted.slice(0, 3).reduce((s, v) => s + v, 0) / totalVolume;
  const top5 = sorted.slice(0, 5).reduce((s, v) => s + v, 0) / totalVolume;

  return { top1, top3, top5 };
}

// ---- Informed Activity Index (0-100) ----

function computeInformedActivityIndex(
  trades: TradeRow[],
  signalsByWallet: Map<string, number>,
): number {
  let totalVolume = 0;
  let weightedFlaggedVolume = 0;

  for (const t of trades) {
    const vol = Number(t.size_usdc) || 0;
    totalVolume += vol;

    const score = signalsByWallet.get(t.wallet_address) || 0;
    weightedFlaggedVolume += vol * score;
  }

  if (totalVolume === 0) return 0;

  const weightedRatio = weightedFlaggedVolume / totalVolume;
  return Math.min(Math.round(weightedRatio * 200), 100);
}

// ---- Main Analysis Runner ----

export async function detectAndFlagMoves(): Promise<{
  detected: number;
  flagged: number;
  errors: string[];
  telemetry: {
    signals_fetched: number;
    trades_fetched: number;
    snapshots_fetched: number;
    markets_scanned: number;
    clusters_found: number;
    rows_inserted: number;
    already_flagged: number;
    duration_ms: number;
  };
}> {
  const startTime = Date.now();
  const errors: string[] = [];
  const now = new Date();
  const lookbackISO = new Date(now.getTime() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

  // ---- Phase 1: Fetch signals and trades first, then snapshots only for relevant markets ----
  const [signalsResult, tradesResult] = await Promise.all([
    fetchSignalsPaginated(),
    fetchRecentTradesPaginated(lookbackISO),
  ]);

  // Collect unique market IDs from signals and trades to scope snapshot fetch
  const relevantMarketIds = [...new Set([
    ...signalsResult.data.map((s) => s.market_id),
    ...tradesResult.data.map((t) => t.market_id),
  ])];

  const snapshotsResult = relevantMarketIds.length > 0
    ? await fetchSnapshotsPaginated(relevantMarketIds, lookbackISO)
    : { data: [] as SnapshotRow[], error: null };

  if (signalsResult.error || tradesResult.error) {
    return {
      detected: 0,
      flagged: 0,
      errors: [`Failed to fetch data: signals=${signalsResult.error}, trades=${tradesResult.error}`],
      telemetry: { signals_fetched: 0, trades_fetched: 0, snapshots_fetched: 0, markets_scanned: 0, clusters_found: 0, rows_inserted: 0, already_flagged: 0, duration_ms: Date.now() - startTime },
    };
  }

  const signals = signalsResult.data;
  const trades = tradesResult.data;
  const snapshots = snapshotsResult.data;

  // ---- Phase 2: Group by market ----

  // Build flagged wallet set per market: market -> (wallet -> composite_score)
  const flaggedByMarket = new Map<string, Map<string, number>>();
  for (const s of signals) {
    if (!flaggedByMarket.has(s.market_id)) flaggedByMarket.set(s.market_id, new Map());
    flaggedByMarket.get(s.market_id)!.set(s.wallet_address, Number(s.composite_score));
  }

  // Group trades by market
  const tradesByMarket = new Map<string, TradeRow[]>();
  for (const t of trades) {
    if (!tradesByMarket.has(t.market_id)) tradesByMarket.set(t.market_id, []);
    tradesByMarket.get(t.market_id)!.push(t);
  }

  // Build snapshot lookup: latest 2 per market (for price context)
  const snapshotsByMarket = new Map<string, SnapshotRow[]>();
  for (const snap of snapshots) {
    if (!snapshotsByMarket.has(snap.market_id)) snapshotsByMarket.set(snap.market_id, []);
    const arr = snapshotsByMarket.get(snap.market_id)!;
    if (arr.length < 2) arr.push(snap);
  }

  // ---- Phase 3: Deduplication — check existing flags within cooldown window ----
  const dedupeStart = new Date(now.getTime() - DEDUP_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();
  const { data: existingFlags } = await bq
    .from('flagged_moves')
    .select('market_id')
    .eq('catalyst_type', 'wallet_cluster')
    .gte('detection_timestamp', dedupeStart);

  const alreadyFlagged = new Set((existingFlags || []).map((f) => f.market_id));

  // ---- Phase 4: Detect clusters ----
  const flagRows: Record<string, unknown>[] = [];
  const marketsScanned = flaggedByMarket.size;

  for (const [marketId, walletScores] of flaggedByMarket) {
    // Skip if already flagged in this cycle
    if (alreadyFlagged.has(marketId)) continue;

    const marketTrades = tradesByMarket.get(marketId) || [];
    if (marketTrades.length === 0) continue;

    // Filter trades to only flagged wallets
    const clusterTrades = marketTrades.filter((t) => walletScores.has(t.wallet_address));
    const clusterWallets = new Set(clusterTrades.map((t) => t.wallet_address));

    if (clusterWallets.size < MIN_CLUSTER_SIZE) continue;

    // Directional agreement
    let buyVol = 0;
    let sellVol = 0;
    for (const t of clusterTrades) {
      const vol = Number(t.size_usdc) || 0;
      if (t.side === 'BUY') buyVol += vol;
      else sellVol += vol;
    }
    const totalClusterVol = buyVol + sellVol;
    if (totalClusterVol === 0) continue;

    const directionalRatio = Math.max(buyVol, sellVol) / totalClusterVol;
    if (directionalRatio < MIN_DIRECTIONAL_RATIO) continue;

    // Volume share among all market trades
    const allMarketVol = marketTrades.reduce((s, t) => s + (Number(t.size_usdc) || 0), 0);
    const volumeShare = allMarketVol > 0 ? totalClusterVol / allMarketVol : 0;

    // Average composite score of cluster wallets
    const avgComposite =
      [...clusterWallets].reduce((s, w) => s + (walletScores.get(w) || 0), 0) / clusterWallets.size;

    // Cluster score (0-100)
    const clusterScore = Math.round(
      100 *
        (0.3 * directionalRatio +
          0.25 * Math.min(clusterWallets.size / 5, 1) +
          0.25 * volumeShare +
          0.2 * avgComposite),
    );

    // Supporting metrics (reuse existing helpers)
    const concentration = computeWalletConcentration(clusterTrades);

    const signalMap = new Map<string, number>();
    for (const [w, sc] of walletScores) signalMap.set(w, sc);
    const informedIndex = computeInformedActivityIndex(marketTrades, signalMap);

    // Price context from snapshots
    const mktSnaps = snapshotsByMarket.get(marketId) || [];
    const latestSnap = mktSnaps[0] || null;
    const prevSnap = mktSnaps[1] || null;
    const priceEnd = latestSnap ? Number(latestSnap.yes_price) : 0;
    const priceStart = prevSnap ? Number(prevSnap.yes_price) : priceEnd;

    // Time window from cluster trades
    const timestamps = clusterTrades.map((t) => new Date(t.timestamp).getTime());
    const moveStart = new Date(Math.min(...timestamps)).toISOString();
    const moveEnd = new Date(Math.max(...timestamps)).toISOString();

    // Signal direction
    const signalDirection = buyVol > sellVol ? 'YES' : 'NO';

    // Top 5 flagged wallets by composite score
    const topWallets = [...clusterWallets]
      .sort((a, b) => (walletScores.get(b) || 0) - (walletScores.get(a) || 0))
      .slice(0, 5);

    // Confidence score (0-100)
    const confidence = Math.round(
      100 *
        (0.35 * directionalRatio +
          0.3 * Math.min(clusterWallets.size / 5, 1) +
          0.2 * volumeShare +
          0.15 * avgComposite),
    );

    // Summary
    const summary =
      `Cluster of ${clusterWallets.size} flagged wallets detected, ` +
      `trading ${signalDirection} with ${(directionalRatio * 100).toFixed(0)}% directional agreement. ` +
      `Cluster controls ${(volumeShare * 100).toFixed(1)}% of recent volume ($${totalClusterVol.toFixed(0)} USDC). ` +
      `Avg wallet suspicion score: ${avgComposite.toFixed(2)}. Cluster score: ${clusterScore}/100.`;

    flagRows.push({
      market_id: marketId,
      detection_timestamp: now.toISOString(),
      move_start_time: moveStart,
      move_end_time: moveEnd,
      price_start: priceStart,
      price_end: priceEnd,
      price_delta: priceEnd - priceStart,
      total_volume_usdc: totalClusterVol,
      unique_wallets: clusterWallets.size,
      wallet_concentration_top1: concentration.top1,
      wallet_concentration_top3: concentration.top3,
      wallet_concentration_top5: concentration.top5,
      flagged_wallet_count: clusterWallets.size,
      cluster_score: clusterScore,
      book_depth_at_start: latestSnap?.book_depth_bid_5c || null,
      confidence_score: confidence,
      informed_activity_index: informedIndex,
      catalyst_type: 'wallet_cluster',
      catalyst_description: JSON.stringify(topWallets),
      signal_direction: signalDirection,
      summary_text: summary,
    });
  }

  // ---- Phase 5: Batch insert ----
  let flagged = 0;
  if (flagRows.length > 0) {
    const CHUNK = 50;
    for (let i = 0; i < flagRows.length; i += CHUNK) {
      const chunk = flagRows.slice(i, i + CHUNK);
      const { error: insertErr } = await bq.from('flagged_moves').insert(chunk);

      if (insertErr) {
        errors.push(`Batch insert offset=${i}: ${insertErr.message}`);
      } else {
        flagged += chunk.length;
      }
    }
  }

  return {
    detected: marketsScanned,
    flagged,
    errors:
      errors.length === 0 && flagRows.length === 0
        ? ['No clusters detected (normal if no suspicious coordination found)']
        : errors.slice(0, 20),
    telemetry: {
      signals_fetched: signals.length,
      trades_fetched: trades.length,
      snapshots_fetched: snapshots.length,
      markets_scanned: marketsScanned,
      clusters_found: flagRows.length,
      rows_inserted: flagged,
      already_flagged: alreadyFlagged.size,
      duration_ms: Date.now() - startTime,
    },
  };
}
