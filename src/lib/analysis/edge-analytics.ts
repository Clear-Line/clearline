/**
 * Edge Analytics Engine — predictive metrics that create actionable betting signals.
 *
 * Computes 6 advanced metrics per market:
 *   1. Smart Money Lead-Lag — do high-accuracy wallets move before price does?
 *   2. Volume-Price Divergence — volume spike without price move (or vice versa) = pending breakout
 *   3. Whale Accumulation — detect wallets slowly building large positions
 *   4. EMA Momentum — exponentially-weighted momentum (reacts faster than simple momentum)
 *   5. Market Regime — classify as trending / ranging / volatile
 *   6. Composite Edge Score — single 0-100 number combining all signals
 *
 * Each metric produces a directional signal: bullish (+), bearish (-), or neutral (0).
 * The edge score synthesizes everything into a single actionable number.
 *
 * Writes to `market_edge` table (one row per market, upserted).
 * Designed to run after the standard analytics pipeline.
 */

import { bq } from '../bigquery';

// ─── Types ───

interface Snapshot {
  market_id: string;
  yes_price: number;
  volume_24h: number;
  liquidity: number;
  timestamp: string;
}

interface Trade {
  market_id: string;
  wallet_address: string;
  side: string;
  size_usdc: number;
  price: number;
  timestamp: string;
}

interface WalletInfo {
  address: string;
  accuracy_score: number | null;
  accuracy_sample_size: number | null;
}

interface SignalResult {
  value: number | null;       // raw metric value
  direction: 'bullish' | 'bearish' | 'neutral';
  strength: number;           // 0-1 confidence in the signal
}

// ─── Metric 1: Smart Money Lead-Lag ───
// Checks if smart wallets bought/sold before a price move in the same direction.
// Positive = smart money is leading bullishly, Negative = leading bearishly.

function computeSmartMoneyLeadLag(
  trades: Trade[],
  snapshots: Snapshot[],
  smartWallets: Set<string>,
): SignalResult {
  if (trades.length === 0 || snapshots.length < 3 || smartWallets.size === 0) {
    return { value: null, direction: 'neutral', strength: 0 };
  }

  // Sort snapshots chronologically
  const sorted = [...snapshots].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  // Find significant price moves (>2% in any window)
  const THRESHOLD = 0.02;
  const LOOKBACK_MS = 6 * 3600000; // look for smart trades in the 6h before a move

  let leadCount = 0;
  let totalMoves = 0;
  let netDirection = 0;

  for (let i = 3; i < sorted.length; i++) {
    const priceDelta = sorted[i].yes_price - sorted[i - 3].yes_price;
    if (Math.abs(priceDelta) < THRESHOLD) continue;
    totalMoves++;

    const moveStart = new Date(sorted[i - 3].timestamp).getTime();
    const lookbackStart = moveStart - LOOKBACK_MS;

    // Find smart wallet trades in the lookback window
    const smartTrades = trades.filter((t) => {
      if (!smartWallets.has(t.wallet_address)) return false;
      const tt = new Date(t.timestamp).getTime();
      return tt >= lookbackStart && tt <= moveStart;
    });

    if (smartTrades.length === 0) continue;

    // Net smart money direction in that window
    let smartNetFlow = 0;
    for (const t of smartTrades) {
      const usdc = Number(t.size_usdc) || 0;
      smartNetFlow += t.side === 'BUY' ? usdc : -usdc;
    }

    // Did smart money move in the same direction as the subsequent price move?
    if ((smartNetFlow > 0 && priceDelta > 0) || (smartNetFlow < 0 && priceDelta < 0)) {
      leadCount++;
      netDirection += priceDelta > 0 ? 1 : -1;
    }
  }

  if (totalMoves === 0) return { value: null, direction: 'neutral', strength: 0 };

  const leadRatio = leadCount / totalMoves;
  const direction = netDirection > 0 ? 'bullish' : netDirection < 0 ? 'bearish' : 'neutral';

  return {
    value: Math.round(leadRatio * 100) / 100,
    direction,
    strength: Math.min(leadRatio, 1),
  };
}

// ─── Metric 2: Volume-Price Divergence ───
// When volume changes significantly but price doesn't (or vice versa), a breakout may be imminent.
// Positive = volume expanding (bullish pressure building), Negative = volume contracting.

function computeVolumePriceDivergence(snapshots: Snapshot[]): SignalResult {
  if (snapshots.length < 6) return { value: null, direction: 'neutral', strength: 0 };

  const sorted = [...snapshots].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  // Split into two halves: earlier vs recent
  const mid = Math.floor(sorted.length / 2);
  const earlier = sorted.slice(0, mid);
  const recent = sorted.slice(mid);

  const avgVolEarlier = earlier.reduce((s, r) => s + (Number(r.volume_24h) || 0), 0) / earlier.length;
  const avgVolRecent = recent.reduce((s, r) => s + (Number(r.volume_24h) || 0), 0) / recent.length;

  const priceEarlier = earlier[earlier.length - 1].yes_price;
  const priceRecent = recent[recent.length - 1].yes_price;

  if (avgVolEarlier === 0) return { value: null, direction: 'neutral', strength: 0 };

  const volumeChange = (avgVolRecent - avgVolEarlier) / avgVolEarlier;
  const priceChange = Math.abs(priceRecent - priceEarlier);

  // Divergence = volume moving but price flat (breakout pending)
  // Or price moving on declining volume (move may be weak/reversible)
  const divergence = volumeChange - priceChange * 10; // scale price to comparable range

  // Direction: if volume is expanding and price hasn't moved yet, it's bullish accumulation
  // (unless we can detect the direction of the volume)
  const direction = volumeChange > 0.2 && priceChange < 0.02
    ? 'bullish'  // volume building, price flat = pressure accumulating
    : volumeChange < -0.2 && priceChange > 0.03
    ? 'bearish'  // volume dying, but price still moving = exhaustion
    : 'neutral';

  const strength = Math.min(Math.abs(divergence) / 2, 1);

  return {
    value: Math.round(divergence * 100) / 100,
    direction,
    strength,
  };
}

// ─── Metric 3: Whale Accumulation Detection ───
// Look for wallets that are consistently buying in small batches over time (scaling in).

function computeWhaleAccumulation(trades: Trade[]): SignalResult {
  if (trades.length < 5) return { value: null, direction: 'neutral', strength: 0 };

  // Group by wallet
  const byWallet = new Map<string, Trade[]>();
  for (const t of trades) {
    if (!byWallet.has(t.wallet_address)) byWallet.set(t.wallet_address, []);
    byWallet.get(t.wallet_address)!.push(t);
  }

  let whaleSignalSum = 0;
  let whaleCount = 0;

  for (const [, walletTrades] of byWallet) {
    if (walletTrades.length < 3) continue;

    const sorted = [...walletTrades].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    // Check for accumulation pattern: multiple buys over time with increasing or steady size
    const buys = sorted.filter((t) => t.side === 'BUY');
    const sells = sorted.filter((t) => t.side === 'SELL');

    if (buys.length < 2) continue;

    const buyVolume = buys.reduce((s, t) => s + (Number(t.size_usdc) || 0), 0);
    const sellVolume = sells.reduce((s, t) => s + (Number(t.size_usdc) || 0), 0);

    // Net buyer with multiple entries = accumulation
    if (buyVolume <= sellVolume) continue;

    // Check time spread — buys should be spread over time, not all at once
    const buyTimes = buys.map((t) => new Date(t.timestamp).getTime());
    const timeSpanHours = (Math.max(...buyTimes) - Math.min(...buyTimes)) / 3600000;

    if (timeSpanHours < 1) continue; // All at once, not accumulation

    // Score: ratio of buy to sell * number of entries * time spread
    const netRatio = buyVolume / (buyVolume + sellVolume);
    const entryScore = Math.min(buys.length / 5, 1);
    const timeScore = Math.min(timeSpanHours / 24, 1);

    const accumulationScore = netRatio * entryScore * timeScore;

    if (accumulationScore > 0.3) {
      whaleSignalSum += accumulationScore;
      whaleCount++;
    }
  }

  if (whaleCount === 0) return { value: null, direction: 'neutral', strength: 0 };

  const avgScore = whaleSignalSum / whaleCount;
  return {
    value: Math.round(avgScore * 100) / 100,
    direction: 'bullish', // accumulation is inherently bullish
    strength: Math.min(avgScore * whaleCount / 3, 1), // more whales = stronger signal
  };
}

// ─── Metric 4: EMA Momentum ───
// Exponentially weighted price momentum — reacts faster than simple moving average.

function computeEMAMomentum(snapshots: Snapshot[]): SignalResult {
  if (snapshots.length < 4) return { value: null, direction: 'neutral', strength: 0 };

  const sorted = [...snapshots].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const prices = sorted.map((s) => s.yes_price);

  // Compute EMA with span=6 (fast) and span=12 (slow)
  const emaFast = computeEMA(prices, 6);
  const emaSlow = computeEMA(prices, 12);

  if (emaFast === null || emaSlow === null) return { value: null, direction: 'neutral', strength: 0 };

  // EMA crossover signal
  const crossover = emaFast - emaSlow;
  const currentPrice = prices[prices.length - 1];

  // Also check price relative to EMA (above = bullish, below = bearish)
  const priceVsEma = currentPrice - emaFast;

  const combined = crossover * 0.6 + priceVsEma * 0.4;

  const direction = combined > 0.005 ? 'bullish' : combined < -0.005 ? 'bearish' : 'neutral';
  const strength = Math.min(Math.abs(combined) / 0.05, 1);

  return {
    value: Math.round(combined * 10000) / 10000,
    direction,
    strength,
  };
}

function computeEMA(prices: number[], span: number): number | null {
  if (prices.length < span) return null;

  const multiplier = 2 / (span + 1);
  let ema = prices.slice(0, span).reduce((a, b) => a + b, 0) / span;

  for (let i = span; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }

  return ema;
}

// ─── Metric 5: Market Regime Detection ───
// Classify the market's current behavior pattern.

type MarketRegime = 'trending_up' | 'trending_down' | 'ranging' | 'volatile' | 'unknown';

function detectMarketRegime(snapshots: Snapshot[]): { regime: MarketRegime; confidence: number } {
  if (snapshots.length < 6) return { regime: 'unknown', confidence: 0 };

  const sorted = [...snapshots].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const prices = sorted.map((s) => s.yes_price);

  // 1. Trend detection via linear regression slope
  const n = prices.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += prices[i];
    sumXY += i * prices[i];
    sumX2 += i * i;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

  // 2. Volatility (standard deviation of returns)
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / returns.length;
  const volatility = Math.sqrt(variance);

  // 3. Mean reversion check — does price oscillate around the mean?
  const meanPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  let crossings = 0;
  for (let i = 1; i < prices.length; i++) {
    if ((prices[i] > meanPrice) !== (prices[i - 1] > meanPrice)) crossings++;
  }
  const crossingRate = crossings / (prices.length - 1);

  // Classification
  const absSlope = Math.abs(slope);
  let regime: MarketRegime;
  let confidence: number;

  if (volatility > 0.03 && crossingRate > 0.3) {
    regime = 'volatile';
    confidence = Math.min(volatility / 0.05, 1);
  } else if (absSlope > 0.002 && crossingRate < 0.35) {
    regime = slope > 0 ? 'trending_up' : 'trending_down';
    confidence = Math.min(absSlope / 0.01, 1);
  } else if (crossingRate > 0.3 && volatility < 0.02) {
    regime = 'ranging';
    confidence = Math.min(crossingRate / 0.5, 1);
  } else {
    regime = absSlope > 0.001 ? (slope > 0 ? 'trending_up' : 'trending_down') : 'ranging';
    confidence = 0.3;
  }

  return { regime, confidence };
}

// ─── Metric 6: Composite Edge Score ───
// Synthesizes all signals into a single 0-100 number.
// >70 = strong edge (high-confidence bet opportunity)
// 50-70 = moderate signal
// <50 = weak/no edge

function computeEdgeScore(
  leadLag: SignalResult,
  divergence: SignalResult,
  whaleAccum: SignalResult,
  emaMomentum: SignalResult,
  regime: { regime: MarketRegime; confidence: number },
): {
  score: number;
  direction: 'bullish' | 'bearish' | 'neutral';
  reasoning: string[];
} {
  const reasons: string[] = [];
  let bullishPoints = 0;
  let bearishPoints = 0;
  let totalWeight = 0;

  // Smart money lead-lag (weight: 30 — highest because it's the most predictive)
  if (leadLag.value !== null) {
    const weight = 30;
    totalWeight += weight;
    const points = leadLag.strength * weight;
    if (leadLag.direction === 'bullish') {
      bullishPoints += points;
      reasons.push(`Smart money leading bullish (${(leadLag.value * 100).toFixed(0)}% accuracy)`);
    } else if (leadLag.direction === 'bearish') {
      bearishPoints += points;
      reasons.push(`Smart money leading bearish (${(leadLag.value * 100).toFixed(0)}% accuracy)`);
    }
  }

  // Volume-price divergence (weight: 20)
  if (divergence.value !== null) {
    const weight = 20;
    totalWeight += weight;
    const points = divergence.strength * weight;
    if (divergence.direction === 'bullish') {
      bullishPoints += points;
      reasons.push('Volume expanding without price move — breakout pressure building');
    } else if (divergence.direction === 'bearish') {
      bearishPoints += points;
      reasons.push('Price moving on declining volume — exhaustion signal');
    }
  }

  // Whale accumulation (weight: 20)
  if (whaleAccum.value !== null) {
    const weight = 20;
    totalWeight += weight;
    const points = whaleAccum.strength * weight;
    if (whaleAccum.direction === 'bullish') {
      bullishPoints += points;
      reasons.push(`Whale accumulation detected (score: ${(whaleAccum.value * 100).toFixed(0)})`);
    } else if (whaleAccum.direction === 'bearish') {
      bearishPoints += points;
      reasons.push('Whale distribution detected');
    }
  }

  // EMA momentum (weight: 15)
  if (emaMomentum.value !== null) {
    const weight = 15;
    totalWeight += weight;
    const points = emaMomentum.strength * weight;
    if (emaMomentum.direction === 'bullish') {
      bullishPoints += points;
      reasons.push('EMA crossover bullish — short-term momentum rising');
    } else if (emaMomentum.direction === 'bearish') {
      bearishPoints += points;
      reasons.push('EMA crossover bearish — short-term momentum falling');
    }
  }

  // Market regime (weight: 15 — acts as a multiplier/filter)
  if (regime.regime !== 'unknown') {
    const weight = 15;
    totalWeight += weight;
    if (regime.regime === 'trending_up') {
      bullishPoints += regime.confidence * weight;
      reasons.push(`Market trending up (confidence: ${(regime.confidence * 100).toFixed(0)}%)`);
    } else if (regime.regime === 'trending_down') {
      bearishPoints += regime.confidence * weight;
      reasons.push(`Market trending down (confidence: ${(regime.confidence * 100).toFixed(0)}%)`);
    } else if (regime.regime === 'volatile') {
      // Volatile regime weakens all signals
      bullishPoints *= 0.7;
      bearishPoints *= 0.7;
      reasons.push('High volatility regime — signals less reliable');
    } else if (regime.regime === 'ranging') {
      reasons.push('Ranging market — watch for breakout');
    }
  }

  // Normalize to 0-100
  if (totalWeight === 0) {
    return { score: 0, direction: 'neutral', reasoning: ['Insufficient data for edge analysis'] };
  }

  const netBullish = bullishPoints - bearishPoints;
  const maxPossible = totalWeight;

  // Score: 50 = neutral, >50 = bullish edge, <50 = bearish edge
  // Map to 0-100 where 50 = no edge
  const rawScore = 50 + (netBullish / maxPossible) * 50;
  const score = Math.round(Math.max(0, Math.min(100, rawScore)));

  const direction = score > 55 ? 'bullish' : score < 45 ? 'bearish' : 'neutral';

  return { score, direction, reasoning: reasons };
}

// ─── Main Engine ───

export async function computeEdgeAnalytics(): Promise<{
  computed: number;
  errors: string[];
  telemetry: {
    marketsProcessed: number;
    smartWalletCount: number;
    avgEdgeScore: number;
    bullishMarkets: number;
    bearishMarkets: number;
    duration_ms: number;
  };
}> {
  const startTime = Date.now();
  const TIME_BUDGET_MS = 50_000;
  const errors: string[] = [];
  let computed = 0;
  let totalEdgeScore = 0;
  let bullishCount = 0;
  let bearishCount = 0;

  // Step 1: Get active markets ordered by volume (highest first, so dashboard markets get computed first)
  const twoDaysAgo = new Date(Date.now() - 48 * 3600000).toISOString();
  const allMarketIdSet = new Set<string>();
  const marketVolume = new Map<string, number>();
  let snapOffset = 0;
  const SNAP_PAGE = 5000;

  while (allMarketIdSet.size < 5000) { // cap at 5K — covers all meaningful markets
    const { data: page } = await bq
      .from('market_snapshots')
      .select('market_id, volume_24h')
      .gte('timestamp', twoDaysAgo)
      .gt('volume_24h', 0)
      .range(snapOffset, snapOffset + SNAP_PAGE - 1);

    if (!page || page.length === 0) break;
    for (const row of page) {
      allMarketIdSet.add(row.market_id);
      const vol = Number(row.volume_24h) || 0;
      if (vol > (marketVolume.get(row.market_id) ?? 0)) {
        marketVolume.set(row.market_id, vol);
      }
    }
    if (page.length < SNAP_PAGE) break;
    snapOffset += SNAP_PAGE;
  }

  // Sort by volume descending — highest volume markets get computed first
  const activeMarketIds = [...allMarketIdSet].sort(
    (a, b) => (marketVolume.get(b) ?? 0) - (marketVolume.get(a) ?? 0),
  );
  if (activeMarketIds.length === 0) {
    return {
      computed: 0,
      errors: ['No markets with recent snapshots'],
      telemetry: { marketsProcessed: 0, smartWalletCount: 0, avgEdgeScore: 0, bullishMarkets: 0, bearishMarkets: 0, duration_ms: Date.now() - startTime },
    };
  }

  // Step 2: Build smart wallet set (hybrid: accuracy + tier1 signals)
  const [accuracyRes, tier1Res] = await Promise.all([
    bq.from('wallets').select('address').gt('accuracy_score', 0.55).gte('accuracy_sample_size', 2),
    bq.from('wallet_signals').select('wallet_address').gt('composite_score', 0.4).order('composite_score', { ascending: false }).limit(500),
  ]);

  const smartWallets = new Set([
    ...(accuracyRes.data ?? []).map((w: WalletInfo) => w.address),
    ...(tier1Res.data ?? []).map((w: { wallet_address: string }) => w.wallet_address),
  ]);

  // Step 3: Process all active markets directly from BigQuery (no Supabase dependency)
  const ID_BATCH = 50;
  const edgeRows: Record<string, unknown>[] = [];

  for (let i = 0; i < activeMarketIds.length; i += ID_BATCH) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      errors.push(`Time budget reached at market ${i}/${activeMarketIds.length}`);
      break;
    }

    const batchIds = activeMarketIds.slice(i, i + ID_BATCH);

    // Fetch snapshots and trades in parallel
    const [snapRes, tradeRes] = await Promise.all([
      bq.from('market_snapshots')
        .select('market_id, yes_price, volume_24h, liquidity, timestamp')
        .in('market_id', batchIds)
        .gte('timestamp', twoDaysAgo)
        .order('timestamp', { ascending: false }),
      bq.from('trades')
        .select('market_id, wallet_address, side, size_usdc, price, timestamp')
        .in('market_id', batchIds)
        .gte('timestamp', new Date(Date.now() - 7 * 86400000).toISOString()),
    ]);

    // Group by market
    const snapsByMarket = new Map<string, Snapshot[]>();
    for (const s of snapRes.data ?? []) {
      if (!snapsByMarket.has(s.market_id)) snapsByMarket.set(s.market_id, []);
      snapsByMarket.get(s.market_id)!.push(s);
    }

    const tradesByMarket = new Map<string, Trade[]>();
    for (const t of tradeRes.data ?? []) {
      if (!tradesByMarket.has(t.market_id)) tradesByMarket.set(t.market_id, []);
      tradesByMarket.get(t.market_id)!.push(t);
    }

    for (const marketId of batchIds) {
      try {
        const mSnaps = snapsByMarket.get(marketId) ?? [];
        const mTrades = tradesByMarket.get(marketId) ?? [];

        if (mSnaps.length < 3) continue;

        // Compute all 6 metrics
        const leadLag = computeSmartMoneyLeadLag(mTrades, mSnaps, smartWallets);
        const divergence = computeVolumePriceDivergence(mSnaps);
        const whaleAccum = computeWhaleAccumulation(mTrades);
        const emaMomentum = computeEMAMomentum(mSnaps);
        const regime = detectMarketRegime(mSnaps);
        const edge = computeEdgeScore(leadLag, divergence, whaleAccum, emaMomentum, regime);

        totalEdgeScore += edge.score;
        if (edge.direction === 'bullish') bullishCount++;
        if (edge.direction === 'bearish') bearishCount++;

        edgeRows.push({
          market_id: marketId,
          computed_at: new Date().toISOString(),

          // Individual signals
          smart_money_lead_lag: leadLag.value,
          smart_money_direction: leadLag.direction,
          smart_money_strength: leadLag.strength,

          volume_price_divergence: divergence.value,
          volume_price_direction: divergence.direction,
          volume_price_strength: divergence.strength,

          whale_accumulation: whaleAccum.value,
          whale_direction: whaleAccum.direction,
          whale_strength: whaleAccum.strength,

          ema_momentum: emaMomentum.value,
          ema_direction: emaMomentum.direction,
          ema_strength: emaMomentum.strength,

          market_regime: regime.regime,
          regime_confidence: regime.confidence,

          // Composite
          edge_score: edge.score,
          edge_direction: edge.direction,
          edge_reasoning: JSON.stringify(edge.reasoning),

          // Context
          snapshot_count: mSnaps.length,
          trade_count: mTrades.length,
          smart_trade_count: mTrades.filter((t) => smartWallets.has(t.wallet_address)).length,
        });
      } catch (err) {
        errors.push(`Edge analytics ${marketId}: ${err}`);
      }
    }
  }

  // Step 5: Upsert to BigQuery
  const UPSERT_BATCH = 500;
  for (let i = 0; i < edgeRows.length; i += UPSERT_BATCH) {
    const chunk = edgeRows.slice(i, i + UPSERT_BATCH);
    const { error } = await bq
      .from('market_edge')
      .upsert(chunk, { onConflict: 'market_id' });

    if (error) {
      errors.push(`Edge upsert batch ${i}: ${error.message}`);
    } else {
      computed += chunk.length;
    }
  }

  return {
    computed,
    errors: errors.slice(0, 20),
    telemetry: {
      marketsProcessed: edgeRows.length,
      smartWalletCount: smartWallets.size,
      avgEdgeScore: edgeRows.length > 0 ? Math.round(totalEdgeScore / edgeRows.length) : 0,
      bullishMarkets: bullishCount,
      bearishMarkets: bearishCount,
      duration_ms: Date.now() - startTime,
    },
  };
}
