/**
 * Correlation Engine — computes cross-market analytics.
 *
 * 1. Market Correlation Matrix: Pearson correlation of price series for
 *    markets in the same event or category.
 * 2. Arbitrage Spread Detection: Flags events where constituent market
 *    probabilities don't sum to ~100%.
 *
 * Run weekly or on-demand.
 */

import { supabaseAdmin } from '../core/supabase.js';
import { bq } from '../core/bigquery.js';

// ─── Pearson Correlation ───

function pearsonCorrelation(x: number[], y: number[]): number | null {
  const n = Math.min(x.length, y.length);
  if (n < 5) return null; // need meaningful sample

  const meanX = x.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const meanY = y.slice(0, n).reduce((a, b) => a + b, 0) / n;

  let sumXY = 0;
  let sumX2 = 0;
  let sumY2 = 0;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    sumXY += dx * dy;
    sumX2 += dx * dx;
    sumY2 += dy * dy;
  }

  const denom = Math.sqrt(sumX2 * sumY2);
  if (denom === 0) return null;

  return sumXY / denom;
}

// ─── Correlation Matrix ───

export async function computeCorrelations(): Promise<{
  computed: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let computed = 0;

  // Get active markets grouped by event_id
  const { data: markets, error: mErr } = await supabaseAdmin
    .from('markets')
    .select('condition_id, event_id, category')
    .eq('is_active', true)
    .not('event_id', 'is', null);

  if (mErr || !markets) {
    return { computed: 0, errors: [`Market query: ${mErr?.message}`] };
  }

  // Group markets by event_id (only compute correlations within same event)
  const byEvent = new Map<string, string[]>();
  for (const m of markets) {
    if (!m.event_id) continue;
    if (!byEvent.has(m.event_id)) byEvent.set(m.event_id, []);
    byEvent.get(m.event_id)!.push(m.condition_id);
  }

  // Also group by category for cross-event correlations
  const byCategory = new Map<string, string[]>();
  for (const m of markets) {
    if (!m.category) continue;
    if (!byCategory.has(m.category)) byCategory.set(m.category, []);
    byCategory.get(m.category)!.push(m.condition_id);
  }

  // Fetch price time series for all markets (last 7 days)
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const allMarketIds = markets.map((m) => m.condition_id);

  const ID_BATCH = 200;
  const allSnapshots: { market_id: string; yes_price: number; timestamp: string }[] = [];

  for (let i = 0; i < allMarketIds.length; i += ID_BATCH) {
    const batch = allMarketIds.slice(i, i + ID_BATCH);
    const { data } = await bq
      .from('market_snapshots')
      .select('market_id, yes_price, timestamp')
      .in('market_id', batch)
      .gte('timestamp', oneWeekAgo)
      .order('timestamp', { ascending: true });

    if (data) allSnapshots.push(...data);
  }

  // Build time series per market (aligned to hourly buckets for comparison)
  const seriesByMarket = new Map<string, Map<number, number>>();

  for (const s of allSnapshots) {
    if (!seriesByMarket.has(s.market_id)) seriesByMarket.set(s.market_id, new Map());
    // Bucket to hour
    const hourBucket = Math.floor(new Date(s.timestamp).getTime() / (60 * 60 * 1000));
    seriesByMarket.get(s.market_id)!.set(hourBucket, s.yes_price);
  }

  // Compute pairwise correlations within each event
  const correlationRows: {
    market_id_a: string;
    market_id_b: string;
    correlation: number;
    window_hours: number;
    computed_at: string;
  }[] = [];

  const now = new Date().toISOString();

  function computePairCorrelations(marketIds: string[]) {
    if (marketIds.length < 2) return;
    // Limit to avoid O(n^2) explosion
    const subset = marketIds.slice(0, 20);

    for (let i = 0; i < subset.length; i++) {
      for (let j = i + 1; j < subset.length; j++) {
        const seriesA = seriesByMarket.get(subset[i]);
        const seriesB = seriesByMarket.get(subset[j]);
        if (!seriesA || !seriesB) continue;

        // Find common time buckets
        const commonBuckets = [...seriesA.keys()].filter((k) => seriesB.has(k));
        if (commonBuckets.length < 5) continue;

        commonBuckets.sort((a, b) => a - b);
        const xVals = commonBuckets.map((k) => seriesA.get(k)!);
        const yVals = commonBuckets.map((k) => seriesB.get(k)!);

        const corr = pearsonCorrelation(xVals, yVals);
        if (corr !== null) {
          correlationRows.push({
            market_id_a: subset[i],
            market_id_b: subset[j],
            correlation: Math.round(corr * 10000) / 10000,
            window_hours: 168,
            computed_at: now,
          });
        }
      }
    }
  }

  // Compute within events
  for (const [, marketIds] of byEvent) {
    computePairCorrelations(marketIds);
  }

  // Compute within categories (top markets only, limit pairs)
  for (const [, marketIds] of byCategory) {
    computePairCorrelations(marketIds.slice(0, 10));
  }

  // Upsert correlations
  const BATCH = 500;
  for (let i = 0; i < correlationRows.length; i += BATCH) {
    const chunk = correlationRows.slice(i, i + BATCH);
    const { error } = await bq
      .from('market_correlations')
      .upsert(chunk, { onConflict: 'market_id_a,market_id_b,window_hours' });

    if (error) {
      errors.push(`Correlation upsert batch ${i}: ${error.message}`);
    } else {
      computed += chunk.length;
    }
  }

  return { computed, errors };
}

// ─── Arbitrage Detection ───

export interface ArbitrageOpportunity {
  eventId: string;
  markets: { conditionId: string; question: string; yesPrice: number }[];
  probabilitySum: number;
  deviation: number; // how far from 1.0
}

export async function detectArbitrage(): Promise<{
  opportunities: ArbitrageOpportunity[];
  errors: string[];
}> {
  const errors: string[] = [];

  // Get active markets with event grouping
  const { data: markets, error: mErr } = await supabaseAdmin
    .from('markets')
    .select('condition_id, question, event_id')
    .eq('is_active', true)
    .not('event_id', 'is', null);

  if (mErr || !markets) {
    return { opportunities: [], errors: [`Market query: ${mErr?.message}`] };
  }

  // Group by event
  const byEvent = new Map<string, typeof markets>();
  for (const m of markets) {
    if (!m.event_id) continue;
    if (!byEvent.has(m.event_id)) byEvent.set(m.event_id, []);
    byEvent.get(m.event_id)!.push(m);
  }

  // Only check events with 2+ markets
  const multiMarketEvents = [...byEvent.entries()].filter(([, ms]) => ms.length >= 2);

  // Get latest prices for all markets in multi-market events
  const eventMarketIds = multiMarketEvents.flatMap(([, ms]) => ms.map((m) => m.condition_id));

  const ID_BATCH = 200;
  const latestPrices = new Map<string, number>();

  for (let i = 0; i < eventMarketIds.length; i += ID_BATCH) {
    const batch = eventMarketIds.slice(i, i + ID_BATCH);
    const { data: snaps } = await bq
      .from('market_snapshots')
      .select('market_id, yes_price, timestamp')
      .in('market_id', batch)
      .order('timestamp', { ascending: false })
      .limit(batch.length * 5);

    if (snaps) {
      for (const s of snaps) {
        if (!latestPrices.has(s.market_id)) {
          latestPrices.set(s.market_id, s.yes_price);
        }
      }
    }
  }

  // Check each event for arbitrage
  const opportunities: ArbitrageOpportunity[] = [];
  const DEVIATION_THRESHOLD = 0.05; // Flag if sum deviates >5% from 1.0

  for (const [eventId, eventMarkets] of multiMarketEvents) {
    const marketData = eventMarkets.map((m) => ({
      conditionId: m.condition_id,
      question: m.question,
      yesPrice: latestPrices.get(m.condition_id) ?? 0,
    }));

    const probSum = marketData.reduce((s, m) => s + m.yesPrice, 0);
    const deviation = Math.abs(probSum - 1.0);

    if (deviation > DEVIATION_THRESHOLD) {
      opportunities.push({
        eventId,
        markets: marketData,
        probabilitySum: Math.round(probSum * 10000) / 10000,
        deviation: Math.round(deviation * 10000) / 10000,
      });
    }
  }

  // Sort by deviation (biggest opportunities first)
  opportunities.sort((a, b) => b.deviation - a.deviation);

  return { opportunities, errors };
}
