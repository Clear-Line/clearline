/**
 * Move Detection Engine — Tier 2/3 Analysis
 *
 * 1. Detects significant price moves from market_snapshots
 * 2. Gathers trades in the move window
 * 3. Looks up Tier 1 scores for participating wallets
 * 4. Computes credibility score, informed activity index
 * 5. Generates summary text
 * 6. Stores results in flagged_moves table
 */

import { supabaseAdmin } from '../supabase';

// ---- Config ----

const MOVE_THRESHOLD_30MIN = 0.03; // 3 percentage points in 30 min
const MOVE_THRESHOLD_2HR = 0.05;   // 5 percentage points in 2 hours
const LOOKBACK_HOURS = 6;          // how far back to look for trades before the move
const COMPOSITE_FLAG_THRESHOLD = 0.5;

// ---- Types ----

interface Snapshot {
  market_id: string;
  timestamp: string;
  yes_price: number;
  spread: number | null;
  book_depth_bid_5c: number | null;
  book_depth_ask_5c: number | null;
}

interface TradeRow {
  wallet_address: string;
  side: string;
  size_usdc: number;
  timestamp: string;
}

interface WalletSignal {
  wallet_address: string;
  composite_score: number;
}

interface DetectedMove {
  market_id: string;
  move_start_time: string;
  move_end_time: string;
  price_start: number;
  price_end: number;
  price_delta: number;
}

// ---- Move Detection ----

async function detectMoves(): Promise<DetectedMove[]> {
  const moves: DetectedMove[] = [];

  // Fetch recent snapshots for all active markets in one query
  // Order by market_id and timestamp to group by market
  const { data: allSnapshots } = await supabaseAdmin
    .from('market_snapshots')
    .select('market_id, timestamp, yes_price')
    .order('timestamp', { ascending: false });

  if (!allSnapshots || allSnapshots.length === 0) return moves;

  // Group snapshots by market, keeping only the 50 most recent per market
  const snapshotsByMarket = new Map<string, typeof allSnapshots>();
  for (const snap of allSnapshots) {
    if (!snapshotsByMarket.has(snap.market_id)) snapshotsByMarket.set(snap.market_id, []);
    const marketSnaps = snapshotsByMarket.get(snap.market_id)!;
    if (marketSnaps.length < 50) marketSnaps.push(snap);
  }

  // Compare consecutive snapshots for price moves
  for (const [, snapshots] of snapshotsByMarket) {
    if (snapshots.length < 2) continue;

    for (let i = 0; i < snapshots.length - 1; i++) {
      const newer = snapshots[i];
      const older = snapshots[i + 1];

      const delta = Math.abs(Number(newer.yes_price) - Number(older.yes_price));
      const timeDiffMin = (new Date(newer.timestamp).getTime() - new Date(older.timestamp).getTime()) / (1000 * 60);

      let threshold = MOVE_THRESHOLD_2HR;
      if (timeDiffMin <= 30) threshold = MOVE_THRESHOLD_30MIN;

      if (delta >= threshold) {
        moves.push({
          market_id: newer.market_id,
          move_start_time: older.timestamp,
          move_end_time: newer.timestamp,
          price_start: Number(older.yes_price),
          price_end: Number(newer.yes_price),
          price_delta: Number(newer.yes_price) - Number(older.yes_price),
        });
      }
    }
  }

  return moves;
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

// ---- Credibility Score (0-100) ----

function computeCredibilityScore(
  trades: TradeRow[],
  concentration: { top1: number; top3: number; top5: number },
  informedActivityIndex: number,
  snapshot: Snapshot | null,
): number {
  // Unique trader score (log scale: 10=30, 50=60, 200+=100)
  const uniqueWallets = new Set(trades.map((t) => t.wallet_address)).size;
  const uniqueTraderScore = Math.min(Math.log10(uniqueWallets + 1) / Math.log10(201), 1.0);

  // Wallet diversity (inverse of top 5 concentration)
  const walletDiversityScore = 1.0 - concentration.top5;

  // Order book depth score
  let bookDepthScore = 0.5; // default if no data
  if (snapshot && snapshot.book_depth_bid_5c) {
    const depth = Number(snapshot.book_depth_bid_5c) + Number(snapshot.book_depth_ask_5c || 0);
    bookDepthScore = Math.min(depth / 50000, 1.0); // normalize against $50k depth
  }

  // Spread score ($0.01 = 1.0, $0.10+ = 0.0)
  let spreadScore = 0.5;
  if (snapshot && snapshot.spread) {
    spreadScore = Math.max(1.0 - (Number(snapshot.spread) - 0.01) / 0.09, 0.0);
  }

  // Inverse informed activity
  const inverseInformed = 1.0 - informedActivityIndex / 100;

  // Volume consistency — simplified: use unique wallets as proxy
  const volumeConsistencyScore = Math.min(uniqueWallets / 20, 1.0);

  const credibility = (
    uniqueTraderScore * 0.20 +
    walletDiversityScore * 0.15 +
    bookDepthScore * 0.20 +
    spreadScore * 0.10 +
    volumeConsistencyScore * 0.15 +
    inverseInformed * 0.20
  );

  return Math.round(credibility * 100);
}

// ---- Summary Text Generator ----

function generateSummary(
  move: DetectedMove,
  trades: TradeRow[],
  concentration: { top1: number; top3: number; top5: number },
  flaggedCount: number,
  informedIndex: number,
  credibility: number,
): string {
  const direction = move.price_delta > 0 ? 'upward' : 'downward';
  const deltaPercent = Math.abs(move.price_delta * 100).toFixed(1);
  const uniqueWallets = new Set(trades.map((t) => t.wallet_address)).size;
  const totalVol = trades.reduce((s, t) => s + (Number(t.size_usdc) || 0), 0);

  let summary = `Detected ${deltaPercent}pp ${direction} price move. `;
  summary += `${uniqueWallets} unique wallets traded $${totalVol.toFixed(0)} in volume. `;

  if (concentration.top1 > 0.5) {
    summary += `Top wallet controlled ${(concentration.top1 * 100).toFixed(0)}% of volume. `;
  }

  if (flaggedCount > 0) {
    summary += `${flaggedCount} wallet(s) with elevated suspicious behavior scores. `;
  }

  if (informedIndex > 50) {
    summary += `High informed activity index (${informedIndex}/100) suggests insider-like trading. `;
  }

  if (credibility < 40) {
    summary += `Low market credibility score (${credibility}/100).`;
  } else if (credibility < 70) {
    summary += `Moderate market credibility (${credibility}/100).`;
  } else {
    summary += `Market credibility appears healthy (${credibility}/100).`;
  }

  return summary;
}

// ---- Main Analysis Runner ----

export async function detectAndFlagMoves(): Promise<{
  detected: number;
  flagged: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let detected = 0;
  let flagged = 0;

  // Step 1: Detect price moves
  const moves = await detectMoves();
  detected = moves.length;

  if (moves.length === 0) {
    return { detected: 0, flagged: 0, errors: ['No significant price moves detected'] };
  }

  // Step 2: Analyze each move
  for (const move of moves) {
    try {
      // Get trades in window before the move (lookback period)
      const lookbackStart = new Date(
        new Date(move.move_start_time).getTime() - LOOKBACK_HOURS * 60 * 60 * 1000,
      ).toISOString();

      const { data: trades } = await supabaseAdmin
        .from('trades')
        .select('wallet_address, side, size_usdc, timestamp')
        .eq('market_id', move.market_id)
        .gte('timestamp', lookbackStart)
        .lte('timestamp', move.move_end_time);

      if (!trades || trades.length === 0) continue;

      // Get Tier 1 scores for participating wallets
      const walletAddresses = [...new Set(trades.map((t) => t.wallet_address))];
      const { data: signals } = await supabaseAdmin
        .from('wallet_signals')
        .select('wallet_address, composite_score')
        .eq('market_id', move.market_id)
        .in('wallet_address', walletAddresses);

      const signalsByWallet = new Map<string, number>();
      let flaggedWalletCount = 0;
      if (signals) {
        for (const s of signals) {
          signalsByWallet.set(s.wallet_address, Number(s.composite_score));
          if (Number(s.composite_score) > COMPOSITE_FLAG_THRESHOLD) flaggedWalletCount++;
        }
      }

      // Compute metrics
      const concentration = computeWalletConcentration(trades);
      const informedIndex = computeInformedActivityIndex(trades, signalsByWallet);

      // Get latest snapshot for book depth/spread data
      const { data: snapshots } = await supabaseAdmin
        .from('market_snapshots')
        .select('market_id, timestamp, yes_price, spread, book_depth_bid_5c, book_depth_ask_5c')
        .eq('market_id', move.market_id)
        .order('timestamp', { ascending: false })
        .limit(1);

      const latestSnapshot = snapshots && snapshots.length > 0 ? snapshots[0] : null;

      const credibility = computeCredibilityScore(trades, concentration, informedIndex, latestSnapshot);
      const totalVolume = trades.reduce((s, t) => s + (Number(t.size_usdc) || 0), 0);
      const summary = generateSummary(move, trades, concentration, flaggedWalletCount, informedIndex, credibility);

      // Determine signal direction
      const buySideVol = trades
        .filter((t) => t.side === 'BUY')
        .reduce((s, t) => s + (Number(t.size_usdc) || 0), 0);
      const signalDirection = buySideVol > totalVolume / 2 ? 'YES' : 'NO';

      // Store in flagged_moves
      const { error: insertErr } = await supabaseAdmin
        .from('flagged_moves')
        .insert({
          market_id: move.market_id,
          move_start_time: move.move_start_time,
          move_end_time: move.move_end_time,
          price_start: move.price_start,
          price_end: move.price_end,
          price_delta: move.price_delta,
          total_volume_usdc: totalVolume,
          unique_wallets: new Set(trades.map((t) => t.wallet_address)).size,
          wallet_concentration_top1: concentration.top1,
          wallet_concentration_top3: concentration.top3,
          wallet_concentration_top5: concentration.top5,
          flagged_wallet_count: flaggedWalletCount,
          book_depth_at_start: latestSnapshot?.book_depth_bid_5c || null,
          confidence_score: credibility,
          informed_activity_index: informedIndex,
          signal_direction: signalDirection,
          summary_text: summary,
        });

      if (insertErr) {
        errors.push(`Flag ${move.market_id}: ${insertErr.message}`);
      } else {
        flagged++;
      }
    } catch (err) {
      errors.push(`Move ${move.market_id}: ${err}`);
    }
  }

  return { detected, flagged, errors: errors.slice(0, 20) };
}
