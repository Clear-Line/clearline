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
 *
 * Paginated reads to handle large tables within Vercel 60s timeout.
 */

import { supabaseAdmin } from '../supabase';

// ---- Config ----

const PAGE_SIZE = 1000;         // rows per paginated fetch
const WALLET_BATCH = 200;       // wallets to process per batch
const UPSERT_CHUNK = 100;       // rows per upsert call
const IN_BATCH = 200;           // max .in() filter size
const TRADE_LOOKBACK_DAYS = 14; // only analyze trades from last N days
const MAX_TRADES = 50_000;      // cap total trades fetched to stay within timeout

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
  if (!firstSeenPolymarket) return 0;

  const firstSeen = new Date(firstSeenPolymarket).getTime();
  const firstTrade = new Date(firstTradeInMarket).getTime();
  const deltaHours = (firstTrade - firstSeen) / (1000 * 60 * 60);

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

  const walletVolume = walletTradesInMarket.reduce((sum, t) => sum + (Number(t.size_usdc) || 0), 0);
  const relativeSize = walletVolume / avgDailyVolume;

  return Math.min(relativeSize / 0.25, 1.0);
}

// ---- Signal 4: Conviction Behavior ----

function scoreConviction(walletTradesInMarket: TradeRow[]): number {
  const buys = walletTradesInMarket
    .filter((t) => t.side === 'BUY')
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  if (buys.length < 2) return 0;

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

  let scalingIn = false;
  if (buys.length >= 3) {
    const timestamps = buys.map((t) => new Date(t.timestamp).getTime() / 1000);
    const gaps: number[] = [];
    for (let i = 0; i < timestamps.length - 1; i++) {
      gaps.push(timestamps[i + 1] - timestamps[i]);
    }
    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (avgGap > 3600 && avgGap < 604800) {
      scalingIn = true;
    }
  }

  const sells = walletTradesInMarket.filter((t) => t.side === 'SELL');
  const firstBuyPrice = Number(buys[0].price);
  const dipThreshold = firstBuyPrice * 0.9;

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

  const hourlyVolume = new Array(24).fill(0);
  for (const t of allMarketTrades) {
    const hour = new Date(t.timestamp).getUTCHours();
    hourlyVolume[hour] += Number(t.size_usdc) || 0;
  }

  const maxHourlyVol = Math.max(...hourlyVolume);
  if (maxHourlyVol === 0) return 0;

  let maxTimingScore = 0;
  for (const t of walletTradesInMarket) {
    const hour = new Date(t.timestamp).getUTCHours();
    const expectedVol = hourlyVolume[hour];
    const timingAnomaly = 1.0 - expectedVol / maxHourlyVol;
    maxTimingScore = Math.max(maxTimingScore, timingAnomaly * 0.4);
  }

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
  telemetry: {
    markets_count: number;
    trades_fetched: number;
    wallets_fetched: number;
    wallets_processed: number;
    pairs_computed: number;
    rows_upserted: number;
    duration_ms: number;
  };
}> {
  const startTime = Date.now();
  const errors: string[] = [];
  let computed = 0;
  let flagged = 0;
  let rowsUpserted = 0;

  // Step 1: Fetch recent trades (paginated), then filter to politics/economics markets.
  // Only look back TRADE_LOOKBACK_DAYS and cap at MAX_TRADES to stay within Vercel timeout.
  const lookbackISO = new Date(Date.now() - TRADE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const allTradesRaw: TradeRow[] = [];
  {
    let offset = 0;
    while (allTradesRaw.length < MAX_TRADES) {
      const { data, error } = await supabaseAdmin
        .from('trades')
        .select('market_id, wallet_address, side, size_usdc, price, timestamp')
        .gte('timestamp', lookbackISO)
        .order('timestamp', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        errors.push(`Trade fetch error at offset ${offset}: ${error.message}`);
        break;
      }
      if (!data || data.length === 0) break;
      allTradesRaw.push(...(data as TradeRow[]));
      if (data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  }

  if (allTradesRaw.length === 0) {
    return {
      computed: 0, errors: ['No trades found', ...errors], flagged: 0,
      telemetry: { markets_count: 0, trades_fetched: 0, wallets_fetched: 0, wallets_processed: 0, pairs_computed: 0, rows_upserted: 0, duration_ms: Date.now() - startTime },
    };
  }

  // Step 2: Get the distinct market IDs from trades, then check which are politics/economics
  const tradeMarketIds = [...new Set(allTradesRaw.map(t => t.market_id))];
  const focusMarketIdSet = new Set<string>();

  for (let b = 0; b < tradeMarketIds.length; b += IN_BATCH) {
    const idBatch = tradeMarketIds.slice(b, b + IN_BATCH);
    const { data } = await supabaseAdmin
      .from('markets')
      .select('condition_id')
      .in('condition_id', idBatch)
      .eq('is_active', true)
      .in('category', ['politics', 'economics', 'geopolitics', 'other']);
    if (data) for (const m of data) focusMarketIdSet.add(m.condition_id);
  }

  const focusMarketIds = [...focusMarketIdSet];

  if (focusMarketIds.length === 0) {
    return {
      computed: 0, errors: ['No trades match tracked markets'], flagged: 0,
      telemetry: { markets_count: 0, trades_fetched: allTradesRaw.length, wallets_fetched: 0, wallets_processed: 0, pairs_computed: 0, rows_upserted: 0, duration_ms: Date.now() - startTime },
    };
  }

  // Filter trades to only politics/economics markets
  const allTrades = allTradesRaw.filter(t => focusMarketIdSet.has(t.market_id));

  // Fetch volume data from latest snapshots
  const volumeSnaps: { market_id: string; volume_24h: number }[] = [];
  for (let b = 0; b < focusMarketIds.length; b += IN_BATCH) {
    const idBatch = focusMarketIds.slice(b, b + IN_BATCH);
    const { data } = await supabaseAdmin
      .from('market_snapshots')
      .select('market_id, volume_24h')
      .in('market_id', idBatch)
      .order('timestamp', { ascending: false })
      .limit(idBatch.length);
    if (data) volumeSnaps.push(...data);
  }

  // Step 3: Fetch wallets in batches (Supabase .in() has limits)
  const activeWalletAddresses = [...new Set(allTrades.map((t) => t.wallet_address))];
  const allWallets: { address: string; first_seen_polymarket: string | null }[] = [];

  for (let i = 0; i < activeWalletAddresses.length; i += IN_BATCH) {
    const batch = activeWalletAddresses.slice(i, i + IN_BATCH);
    const { data: walletBatch, error: wErr } = await supabaseAdmin
      .from('wallets')
      .select('address, first_seen_polymarket')
      .in('address', batch);

    if (wErr) {
      errors.push(`Wallet fetch batch ${i}: ${wErr.message}`);
    } else if (walletBatch) {
      allWallets.push(...walletBatch);
    }
  }

  if (allWallets.length === 0) {
    return {
      computed: 0, errors: ['No wallets found', ...errors], flagged: 0,
      telemetry: { markets_count: focusMarketIds.length, trades_fetched: allTrades.length, wallets_fetched: 0, wallets_processed: 0, pairs_computed: 0, rows_upserted: 0, duration_ms: Date.now() - startTime },
    };
  }

  // Step 4: Pre-compute lookup structures
  const tradesByWallet = new Map<string, TradeRow[]>();
  const tradesByMarket = new Map<string, TradeRow[]>();

  for (const t of allTrades) {
    if (!tradesByWallet.has(t.wallet_address)) tradesByWallet.set(t.wallet_address, []);
    if (!tradesByMarket.has(t.market_id)) tradesByMarket.set(t.market_id, []);
    tradesByWallet.get(t.wallet_address)!.push(t);
    tradesByMarket.get(t.market_id)!.push(t);
  }

  const marketVolumeMap = new Map<string, number>();
  for (const snap of volumeSnaps || []) {
    if (!marketVolumeMap.has(snap.market_id)) {
      marketVolumeMap.set(snap.market_id, Number(snap.volume_24h) || 0);
    }
  }

  // Step 5: Resume cursor — skip wallets already computed this cycle
  // Sort wallets deterministically so resume position is stable across runs
  allWallets.sort((a, b) => a.address.localeCompare(b.address));

  // Find the last wallet we computed in the current 6h cycle
  const cycleStart = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { data: lastComputed } = await supabaseAdmin
    .from('wallet_signals')
    .select('wallet_address')
    .gte('computed_at', cycleStart)
    .order('wallet_address', { ascending: false })
    .limit(1);

  let resumeIndex = 0;
  if (lastComputed && lastComputed.length > 0) {
    const lastAddr = lastComputed[0].wallet_address;
    const idx = allWallets.findIndex((w) => w.address > lastAddr);
    if (idx > 0) {
      resumeIndex = idx;
      errors.push(`Resuming from wallet index ${resumeIndex}/${allWallets.length} (after ${lastAddr.slice(0, 10)}...)`);
    } else if (idx === -1) {
      // All wallets already processed this cycle
      return {
        computed: 0, errors: ['All wallets already computed this cycle'], flagged: 0,
        telemetry: { markets_count: focusMarketIds.length, trades_fetched: allTrades.length, wallets_fetched: allWallets.length, wallets_processed: 0, pairs_computed: 0, rows_upserted: 0, duration_ms: Date.now() - startTime },
      };
    }
  }

  // Step 6: Process wallets in batches, upsert after each batch
  let walletsProcessed = 0;

  for (let wi = resumeIndex; wi < allWallets.length; wi += WALLET_BATCH) {
    const walletBatch = allWallets.slice(wi, wi + WALLET_BATCH);
    const batchResults: Tier1Scores[] = [];

    // Check if we're running low on time (leave 10s buffer)
    if (Date.now() - startTime > 48_000) {
      errors.push(`Timeout approaching at wallet ${wi}/${allWallets.length}, saving progress`);
      break;
    }

    for (const wallet of walletBatch) {
      const walletTrades = tradesByWallet.get(wallet.address);
      if (!walletTrades || walletTrades.length === 0) continue;

      const walletMarkets = [...new Set(walletTrades.map((t) => t.market_id))];

      for (const marketId of walletMarkets) {
        try {
          const tradesInMarket = walletTrades.filter((t) => t.market_id === marketId);
          const allMarketTrades = tradesByMarket.get(marketId) || [];
          const firstTradeTime = tradesInMarket[0].timestamp;

          const marketTradeTimestamps = allMarketTrades.map((t) => new Date(t.timestamp).getTime());
          const timeSpanDays = marketTradeTimestamps.length > 1
            ? (Math.max(...marketTradeTimestamps) - Math.min(...marketTradeTimestamps)) / (1000 * 60 * 60 * 24)
            : 1;
          const totalMarketVol = allMarketTrades.reduce((s, t) => s + (Number(t.size_usdc) || 0), 0);
          const avgDailyVol = marketVolumeMap.get(marketId) || (totalMarketVol / Math.max(timeSpanDays, 1));

          const scores = {
            wallet_age_delta: scoreWalletAgeDelta(wallet.first_seen_polymarket, firstTradeTime),
            trade_concentration: scoreTradeConcentration(walletTrades, marketId),
            position_size_relative: scorePositionSizeRelative(tradesInMarket, avgDailyVol),
            conviction: scoreConviction(tradesInMarket),
            entry_timing: scoreEntryTiming(tradesInMarket, allMarketTrades),
          };

          const composite = computeComposite(scores);

          batchResults.push({
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

      walletsProcessed++;
    }

    // Upsert this batch's results immediately
    if (batchResults.length > 0) {
      for (let i = 0; i < batchResults.length; i += UPSERT_CHUNK) {
        const chunk = batchResults.slice(i, i + UPSERT_CHUNK);
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
          errors.push(`Upsert batch: ${insertErr.message}`);
        } else {
          rowsUpserted += chunk.length;
        }
      }
    }
  }

  return {
    computed,
    errors: errors.slice(0, 20),
    flagged,
    telemetry: {
      markets_count: focusMarketIds.length,
      trades_fetched: allTrades.length,
      wallets_fetched: allWallets.length,
      wallets_processed: walletsProcessed,
      pairs_computed: computed,
      rows_upserted: rowsUpserted,
      duration_ms: Date.now() - startTime,
    },
  };
}
