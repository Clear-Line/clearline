/**
 * Tier 1 Signals — Wallet-Level Behavior Scoring
 *
 * Computes 5 signals per wallet-market pair:
 *   1. Wallet Age Delta (requires first_seen_polymarket)
 *   2. Trade Concentration (% of volume in one market)
 *   3. Position Size Relative to Market (trade size vs daily volume)
 *   4. Conviction Behavior (accumulation, scaling in, hold through dip)
 *   5. Entry Timing (low-volume hours, pre-catalyst)
 *
 * Composite score = weighted average of all signals.
 */

import { supabaseAdmin } from '../supabase';

// ---- Types ----

export interface Tier1Scores {
  wallet_address: string;
  market_id: string;
  wallet_age_delta: number;
  trade_concentration: number;
  position_size_relative: number;
  conviction: number;
  entry_timing: number;
  composite: number;
}

interface TradeRow {
  market_id: string;
  wallet_address: string;
  side: string;
  size_usdc: number;
  price: number;
  timestamp: string;
}

// ---- Signal 1: Wallet Age Delta ----

function scoreWalletAgeDelta(firstSeenPolymarket: string | null, firstTradeInMarket: string): number {
  if (!firstSeenPolymarket) return 0; // can't compute without data

  const firstSeen = new Date(firstSeenPolymarket).getTime();
  const firstTrade = new Date(firstTradeInMarket).getTime();
  const deltaHours = (firstTrade - firstSeen) / (1000 * 60 * 60);

  // If first Polymarket activity IS this trade, use time between first_seen and this market entry
  if (deltaHours < 1) return 1.0;
  if (deltaHours < 24) return 0.85;
  if (deltaHours < 24 * 7) return 0.6;
  if (deltaHours < 24 * 28) return 0.3;
  if (deltaHours < 24 * 180) return 0.1;
  return 0.0;
}

// ---- Signal 2: Trade Concentration ----

function scoreTradeConcentration(
  walletTrades: TradeRow[],
  targetMarketId: string,
): number {
  if (walletTrades.length === 0) return 0;

  const volumeByMarket = new Map<string, number>();
  let totalVolume = 0;

  for (const t of walletTrades) {
    const vol = Number(t.size_usdc) || 0;
    volumeByMarket.set(t.market_id, (volumeByMarket.get(t.market_id) || 0) + vol);
    totalVolume += vol;
  }

  if (totalVolume === 0) return 0;

  const marketVolume = volumeByMarket.get(targetMarketId) || 0;
  const concentration = marketVolume / totalVolume;

  if (concentration > 0.95) return 1.0;
  if (concentration > 0.80) return 0.8;
  if (concentration > 0.70) return 0.6;
  if (concentration > 0.50) return 0.3;
  return 0.0;
}

// ---- Signal 3: Position Size Relative to Market ----

function scorePositionSizeRelative(
  walletTradesInMarket: TradeRow[],
  avgDailyVolume: number,
): number {
  if (avgDailyVolume <= 0 || walletTradesInMarket.length === 0) return 0;

  // Sum wallet's total volume in this market
  const walletVolume = walletTradesInMarket.reduce((sum, t) => sum + (Number(t.size_usdc) || 0), 0);
  const relativeSize = walletVolume / avgDailyVolume;

  // Score hits 1.0 at 25% of daily volume
  return Math.min(relativeSize / 0.25, 1.0);
}

// ---- Signal 4: Conviction Behavior ----

function scoreConviction(walletTradesInMarket: TradeRow[]): number {
  const buys = walletTradesInMarket
    .filter((t) => t.side === 'BUY')
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  if (buys.length < 2) return 0;

  // Pattern A: Accumulation (buying the dip)
  let accumCount = 0;
  let runningTotal = 0;
  let runningQty = 0;

  for (let i = 0; i < buys.length; i++) {
    const price = Number(buys[i].price);
    const size = Number(buys[i].size_usdc);

    if (i > 0) {
      const avgEntry = runningTotal / runningQty;
      if (price < avgEntry) {
        accumCount++;
      }
    }

    runningTotal += price * size;
    runningQty += size;
  }

  const accumulationRatio = accumCount / (buys.length - 1);

  // Pattern B: Scaling In (multiple buys spread over time)
  let scalingIn = false;
  if (buys.length >= 3) {
    const timestamps = buys.map((t) => new Date(t.timestamp).getTime() / 1000);
    const gaps: number[] = [];
    for (let i = 0; i < timestamps.length - 1; i++) {
      gaps.push(timestamps[i + 1] - timestamps[i]);
    }
    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    // Between 1 hour and 7 days
    if (avgGap > 3600 && avgGap < 604800) {
      scalingIn = true;
    }
  }

  // Pattern C: Hold Through Dip (no selling during drawdowns)
  const sells = walletTradesInMarket.filter((t) => t.side === 'SELL');
  const firstBuyPrice = Number(buys[0].price);
  const dipThreshold = firstBuyPrice * 0.9; // 10% drawdown

  // Check if any prices went below threshold and wallet didn't sell
  const pricesAfterEntry = walletTradesInMarket
    .filter((t) => new Date(t.timestamp) > new Date(buys[0].timestamp))
    .map((t) => Number(t.price));

  const hadDip = pricesAfterEntry.some((p) => p < dipThreshold);
  const soldDuringDip = hadDip && sells.some((s) => Number(s.price) < dipThreshold);
  const holdThroughDip = hadDip && !soldDuringDip;

  return (
    accumulationRatio * 0.4 +
    (scalingIn ? 1.0 : 0.0) * 0.3 +
    (holdThroughDip ? 1.0 : 0.0) * 0.3
  );
}

// ---- Signal 5: Entry Timing ----

function scoreEntryTiming(walletTradesInMarket: TradeRow[], allMarketTrades: TradeRow[]): number {
  if (walletTradesInMarket.length === 0 || allMarketTrades.length === 0) return 0;

  // Build hourly volume distribution from all trades in this market
  const hourlyVolume = new Array(24).fill(0);
  for (const t of allMarketTrades) {
    const hour = new Date(t.timestamp).getUTCHours();
    hourlyVolume[hour] += Number(t.size_usdc) || 0;
  }

  const maxHourlyVol = Math.max(...hourlyVolume);
  if (maxHourlyVol === 0) return 0;

  // Score each of the wallet's trades and take the max
  let maxTimingScore = 0;
  for (const t of walletTradesInMarket) {
    const hour = new Date(t.timestamp).getUTCHours();
    const expectedVol = hourlyVolume[hour];
    // Score is high when trading during low-volume periods
    const timingAnomaly = 1.0 - expectedVol / maxHourlyVol;
    maxTimingScore = Math.max(maxTimingScore, timingAnomaly * 0.4);
  }

  // Note: pre-catalyst scoring requires the catalysts table (not yet populated)
  // When catalysts are available, this can be enhanced

  return maxTimingScore;
}

// ---- Composite Score ----

function computeComposite(scores: Omit<Tier1Scores, 'composite' | 'wallet_address' | 'market_id'>): number {
  return (
    scores.wallet_age_delta * 0.25 +
    scores.trade_concentration * 0.20 +
    scores.position_size_relative * 0.20 +
    scores.conviction * 0.15 +
    scores.entry_timing * 0.20
  );
}

// ---- Main Analysis Runner ----

export async function computeTier1Signals(): Promise<{
  computed: number;
  errors: string[];
  flagged: number;
}> {
  const errors: string[] = [];
  let computed = 0;
  let flagged = 0;

  // Get all wallets with their first_seen data
  const { data: wallets, error: wErr } = await supabaseAdmin
    .from('wallets')
    .select('address, first_seen_polymarket')
    .gt('total_trades', 0);

  if (wErr || !wallets) {
    return { computed: 0, errors: [`Failed to fetch wallets: ${wErr?.message}`], flagged: 0 };
  }

  // Get all trades
  const { data: allTrades, error: tErr } = await supabaseAdmin
    .from('trades')
    .select('market_id, wallet_address, side, size_usdc, price, timestamp')
    .order('timestamp', { ascending: true });

  if (tErr || !allTrades) {
    return { computed: 0, errors: [`Failed to fetch trades: ${tErr?.message}`], flagged: 0 };
  }

  // Group trades by wallet and by market
  const tradesByWallet = new Map<string, TradeRow[]>();
  const tradesByMarket = new Map<string, TradeRow[]>();

  for (const t of allTrades) {
    const wKey = t.wallet_address;
    const mKey = t.market_id;
    if (!tradesByWallet.has(wKey)) tradesByWallet.set(wKey, []);
    if (!tradesByMarket.has(mKey)) tradesByMarket.set(mKey, []);
    tradesByWallet.get(wKey)!.push(t);
    tradesByMarket.get(mKey)!.push(t);
  }

  // Get market volume data for position size scoring
  const { data: markets } = await supabaseAdmin
    .from('markets')
    .select('condition_id, volume_24hr');

  const marketVolume = new Map<string, number>();
  if (markets) {
    for (const m of markets) {
      marketVolume.set(m.condition_id, Number(m.volume_24hr) || 0);
    }
  }

  // Process each wallet
  const results: Tier1Scores[] = [];

  for (const wallet of wallets) {
    const walletTrades = tradesByWallet.get(wallet.address);
    if (!walletTrades || walletTrades.length === 0) continue;

    // Get unique markets this wallet traded in
    const walletMarkets = [...new Set(walletTrades.map((t) => t.market_id))];

    for (const marketId of walletMarkets) {
      try {
        const tradesInMarket = walletTrades.filter((t) => t.market_id === marketId);
        const allMarketTrades = tradesByMarket.get(marketId) || [];
        const firstTradeTime = tradesInMarket[0].timestamp;

        // Compute daily volume estimate (total volume / days of data)
        const marketTradeTimestamps = allMarketTrades.map((t) => new Date(t.timestamp).getTime());
        const timeSpanDays = marketTradeTimestamps.length > 1
          ? (Math.max(...marketTradeTimestamps) - Math.min(...marketTradeTimestamps)) / (1000 * 60 * 60 * 24)
          : 1;
        const totalMarketVol = allMarketTrades.reduce((s, t) => s + (Number(t.size_usdc) || 0), 0);
        const avgDailyVol = marketVolume.get(marketId) || (totalMarketVol / Math.max(timeSpanDays, 1));

        const scores = {
          wallet_age_delta: scoreWalletAgeDelta(wallet.first_seen_polymarket, firstTradeTime),
          trade_concentration: scoreTradeConcentration(walletTrades, marketId),
          position_size_relative: scorePositionSizeRelative(tradesInMarket, avgDailyVol),
          conviction: scoreConviction(tradesInMarket),
          entry_timing: scoreEntryTiming(tradesInMarket, allMarketTrades),
        };

        const composite = computeComposite(scores);

        results.push({
          wallet_address: wallet.address,
          market_id: marketId,
          ...scores,
          composite,
        });

        computed++;
        if (composite > 0.5) flagged++;
      } catch (err) {
        errors.push(`${wallet.address}/${marketId}: ${err}`);
      }
    }
  }

  // Store results — upsert into a wallet_signals table
  if (results.length > 0) {
    // Batch insert in chunks of 100
    const CHUNK = 100;
    for (let i = 0; i < results.length; i += CHUNK) {
      const chunk = results.slice(i, i + CHUNK);
      const { error: insertErr } = await supabaseAdmin
        .from('wallet_signals')
        .upsert(
          chunk.map((r) => ({
            wallet_address: r.wallet_address,
            market_id: r.market_id,
            wallet_age_delta_score: r.wallet_age_delta,
            trade_concentration_score: r.trade_concentration,
            position_size_score: r.position_size_relative,
            conviction_score: r.conviction,
            entry_timing_score: r.entry_timing,
            composite_score: r.composite,
            computed_at: new Date().toISOString(),
          })),
          { onConflict: 'wallet_address,market_id' },
        );

      if (insertErr) {
        errors.push(`Batch insert: ${insertErr.message}`);
      }
    }
  }

  return { computed, errors: errors.slice(0, 20), flagged };
}
