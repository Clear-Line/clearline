/**
 * Alert Scanner — reads existing BigQuery/Supabase tables and evaluates
 * 4 alert trigger conditions to surface actionable market opportunities.
 *
 * Pure read-only: no writes to any database.
 * Returns ranked alerts (max 8) with template-based summaries.
 */

import { bq } from '../core/bigquery.js';
import { supabaseAdmin } from '../core/supabase.js';

// ---- Types ----

export type AlertType =
  | 'VOLUME_EXPLOSION'
  | 'SMART_MONEY_ENTRY'
  | 'RANGE_BREAKOUT'
  | 'MANIPULATION_WARNING';

export interface AlertMetrics {
  price_current: number;
  price_previous: number;
  price_delta: number;
  volume_24h: number;
  volume_multiple?: number;
  wallet_count?: number;
  combined_volume_usdc?: number;
  avg_accuracy?: number;
  range_days?: number;
  breakout_magnitude?: number;
  concentration_top1?: number;
  cluster_score?: number;
  direction?: string;
}

export interface Alert {
  id: string;
  type: AlertType;
  market_id: string;
  market_question: string;
  category: string;
  detected_at: string;
  signal_strength: number;
  summary: string;
  metrics: AlertMetrics;
}

interface MarketMeta {
  condition_id: string;
  question: string;
  category: string;
}

// ---- Config ----

const MAX_ALERTS = 8;

// ---- Helpers ----

function alertId(marketId: string, type: AlertType): string {
  return `${type}:${marketId}`;
}

function cents(price: number): string {
  return `${(price * 100).toFixed(0)}c`;
}

function usd(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`;
  return `$${amount.toFixed(0)}`;
}

function pts(delta: number): string {
  const p = Math.round(delta * 100);
  return p >= 0 ? `+${p}` : `${p}`;
}

async function fetchMarketMeta(marketIds: string[]): Promise<Map<string, MarketMeta>> {
  const map = new Map<string, MarketMeta>();
  const BATCH = 200;
  for (let i = 0; i < marketIds.length; i += BATCH) {
    const batch = marketIds.slice(i, i + BATCH);
    const { data } = await supabaseAdmin
      .from('markets')
      .select('condition_id, question, category')
      .in('condition_id', batch)
      .neq('category', 'sports');
    if (data) {
      for (const m of data) map.set(m.condition_id, m);
    }
  }
  return map;
}

// ---- Mock summary generation (swap point for future AI) ----

function generateMockSummary(type: AlertType, m: AlertMetrics, question: string): string {
  switch (type) {
    case 'VOLUME_EXPLOSION':
      return (
        `Volume surged ${(m.volume_multiple ?? 0).toFixed(1)}x the 7-day average. ` +
        `Price moved from ${cents(m.price_previous)} to ${cents(m.price_current)} (${pts(m.price_delta)} points). ` +
        `${usd(m.volume_24h)} traded in the last 24 hours.`
      );
    case 'SMART_MONEY_ENTRY':
      return (
        `${m.wallet_count} wallets with >${((m.avg_accuracy ?? 0) * 100).toFixed(0)}% historical accuracy entered ${m.direction ?? 'BUY'} ` +
        `within the last 12 hours. Combined position: ${usd(m.combined_volume_usdc ?? 0)}. ` +
        `Current price: ${cents(m.price_current)}.`
      );
    case 'RANGE_BREAKOUT':
      return (
        `Price broke out of a ${m.range_days ?? 5}-day trading range. ` +
        `Current price: ${cents(m.price_current)} on ${(m.volume_multiple ?? 0).toFixed(1)}x normal volume. ` +
        `Watch for continuation or false breakout.`
      );
    case 'MANIPULATION_WARNING':
      return (
        `Unusual activity detected. Price moved ${pts(m.price_delta)} points ` +
        `with ${((m.concentration_top1 ?? 0) * 100).toFixed(0)}% of volume from a single wallet. ` +
        `${m.wallet_count} flagged wallets identified. Cluster score: ${m.cluster_score ?? 0}/100.`
      );
  }
}

// ---- Scanner 1: Volume Explosions ----

async function scanVolumeExplosions(): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Get latest snapshot per market (top 500 by volume)
  const { data: recent } = await bq
    .from('market_snapshots')
    .select('market_id, yes_price, volume_24h, timestamp')
    .gt('volume_24h', 0)
    .gte('timestamp', new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString())
    .order('volume_24h', { ascending: false })
    .limit(500);

  if (!recent || recent.length === 0) return [];

  // Deduplicate to latest per market
  const latestByMarket = new Map<string, { yes_price: number; volume_24h: number; timestamp: string }>();
  for (const s of recent) {
    if (!latestByMarket.has(s.market_id)) {
      latestByMarket.set(s.market_id, s);
    }
  }

  const marketIds = [...latestByMarket.keys()];

  // Get 7-day historical snapshots for avg volume
  const { data: historical } = await bq
    .from('market_snapshots')
    .select('market_id, volume_24h, yes_price, timestamp')
    .in('market_id', marketIds.slice(0, 200))
    .gte('timestamp', sevenDaysAgo)
    .order('timestamp', { ascending: true })
    .limit(5000);

  if (!historical || historical.length === 0) return [];

  // Compute 7-day avg volume and earliest price per market
  const avgVolByMarket = new Map<string, number>();
  const oldestPriceByMarket = new Map<string, number>();
  const volCounts = new Map<string, number>();

  for (const s of historical) {
    avgVolByMarket.set(s.market_id, (avgVolByMarket.get(s.market_id) ?? 0) + (Number(s.volume_24h) || 0));
    volCounts.set(s.market_id, (volCounts.get(s.market_id) ?? 0) + 1);
    if (!oldestPriceByMarket.has(s.market_id)) {
      oldestPriceByMarket.set(s.market_id, Number(s.yes_price) || 0);
    }
  }

  for (const [id, total] of avgVolByMarket) {
    const count = volCounts.get(id) ?? 1;
    avgVolByMarket.set(id, total / count);
  }

  // Detect explosions
  const candidateIds: string[] = [];
  const candidateMetrics = new Map<string, AlertMetrics>();

  for (const [marketId, snap] of latestByMarket) {
    const avgVol = avgVolByMarket.get(marketId);
    if (!avgVol || avgVol <= 0) continue;

    const vol24h = Number(snap.volume_24h) || 0;
    const multiple = vol24h / avgVol;
    const currentPrice = Number(snap.yes_price) || 0;
    const previousPrice = oldestPriceByMarket.get(marketId) ?? currentPrice;
    const delta = currentPrice - previousPrice;

    if (multiple >= 3 && Math.abs(delta) >= 0.08) {
      candidateIds.push(marketId);
      candidateMetrics.set(marketId, {
        price_current: currentPrice,
        price_previous: previousPrice,
        price_delta: delta,
        volume_24h: vol24h,
        volume_multiple: multiple,
      });
    }
  }

  if (candidateIds.length === 0) return [];

  const meta = await fetchMarketMeta(candidateIds);

  for (const id of candidateIds) {
    const m = candidateMetrics.get(id)!;
    const market = meta.get(id);
    if (!market) continue;

    const strength = Math.min(100, Math.round(
      ((m.volume_multiple ?? 0) / 10) * 50 + (Math.abs(m.price_delta) / 0.20) * 50
    ));

    alerts.push({
      id: alertId(id, 'VOLUME_EXPLOSION'),
      type: 'VOLUME_EXPLOSION',
      market_id: id,
      market_question: market.question,
      category: market.category,
      detected_at: new Date().toISOString(),
      signal_strength: strength,
      summary: generateMockSummary('VOLUME_EXPLOSION', m, market.question),
      metrics: m,
    });
  }

  return alerts;
}

// ---- Scanner 2: Smart Money Entries ----

async function scanSmartMoneyEntries(): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();

  // Get smart wallets (accuracy > 0.60, sample >= 2)
  const { data: smartWallets } = await bq
    .from('wallets')
    .select('address, accuracy_score, accuracy_sample_size')
    .gt('accuracy_score', 0.60)
    .gte('accuracy_sample_size', 2)
    .limit(500);

  if (!smartWallets || smartWallets.length === 0) return [];

  const smartAddresses = smartWallets.map((w: { address: string }) => w.address);
  const accuracyMap = new Map<string, number>();
  for (const w of smartWallets) {
    accuracyMap.set(w.address, Number(w.accuracy_score) || 0);
  }

  // Get recent trades from smart wallets
  const { data: trades } = await bq
    .from('trades')
    .select('wallet_address, market_id, side, size_usdc, timestamp')
    .in('wallet_address', smartAddresses.slice(0, 200))
    .gte('timestamp', twelveHoursAgo)
    .limit(5000);

  if (!trades || trades.length === 0) return [];

  // Group by market + side
  const marketSideMap = new Map<string, { wallets: Set<string>; totalUsdc: number; side: string }>();

  for (const t of trades) {
    if (!accuracyMap.has(t.wallet_address)) continue;
    const key = `${t.market_id}:${t.side}`;
    if (!marketSideMap.has(key)) {
      marketSideMap.set(key, { wallets: new Set(), totalUsdc: 0, side: t.side });
    }
    const entry = marketSideMap.get(key)!;
    entry.wallets.add(t.wallet_address);
    entry.totalUsdc += Number(t.size_usdc) || 0;
  }

  // Find entries with 2+ wallets and $5K+ combined
  const candidateIds: string[] = [];
  const candidateData = new Map<string, { wallets: Set<string>; totalUsdc: number; side: string; marketId: string }>();

  for (const [key, entry] of marketSideMap) {
    if (entry.wallets.size >= 2 && entry.totalUsdc >= 5000) {
      const marketId = key.split(':')[0];
      candidateIds.push(marketId);
      candidateData.set(marketId, { ...entry, marketId });
    }
  }

  if (candidateIds.length === 0) return [];

  // Get current prices
  const { data: prices } = await bq
    .from('market_snapshots')
    .select('market_id, yes_price')
    .in('market_id', candidateIds.slice(0, 200))
    .order('timestamp', { ascending: false })
    .limit(200);

  const priceMap = new Map<string, number>();
  if (prices) {
    for (const p of prices) {
      if (!priceMap.has(p.market_id)) priceMap.set(p.market_id, Number(p.yes_price) || 0);
    }
  }

  const meta = await fetchMarketMeta(candidateIds);

  for (const [marketId, entry] of candidateData) {
    const market = meta.get(marketId);
    if (!market) continue;

    const walletAccuracies = [...entry.wallets].map(w => accuracyMap.get(w) ?? 0);
    const avgAcc = walletAccuracies.reduce((a, b) => a + b, 0) / walletAccuracies.length;
    const currentPrice = priceMap.get(marketId) ?? 0;

    const strength = Math.min(100, Math.round(
      (entry.wallets.size / 5) * 40 +
      ((avgAcc * 100 - 60) / 40) * 30 +
      Math.min(entry.totalUsdc / 20000, 1) * 30
    ));

    const metrics: AlertMetrics = {
      price_current: currentPrice,
      price_previous: currentPrice,
      price_delta: 0,
      volume_24h: 0,
      wallet_count: entry.wallets.size,
      combined_volume_usdc: entry.totalUsdc,
      avg_accuracy: avgAcc,
      direction: entry.side,
    };

    alerts.push({
      id: alertId(marketId, 'SMART_MONEY_ENTRY'),
      type: 'SMART_MONEY_ENTRY',
      market_id: marketId,
      market_question: market.question,
      category: market.category,
      detected_at: new Date().toISOString(),
      signal_strength: strength,
      summary: generateMockSummary('SMART_MONEY_ENTRY', metrics, market.question),
      metrics,
    });
  }

  return alerts;
}

// ---- Scanner 3: Range Breakouts ----

async function scanRangeBreakouts(): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const now = new Date();
  const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();
  const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString();

  // Get markets with recent activity
  const { data: recentSnaps } = await bq
    .from('market_snapshots')
    .select('market_id, yes_price, volume_24h, timestamp')
    .gte('timestamp', fourHoursAgo)
    .gt('volume_24h', 0)
    .order('volume_24h', { ascending: false })
    .limit(300);

  if (!recentSnaps || recentSnaps.length === 0) return [];

  // Dedupe to latest per market
  const latestByMarket = new Map<string, { yes_price: number; volume_24h: number }>();
  for (const s of recentSnaps) {
    if (!latestByMarket.has(s.market_id)) {
      latestByMarket.set(s.market_id, { yes_price: Number(s.yes_price), volume_24h: Number(s.volume_24h) });
    }
  }

  const marketIds = [...latestByMarket.keys()].slice(0, 200);

  // Get 5-day historical data for range computation
  const { data: historical } = await bq
    .from('market_snapshots')
    .select('market_id, yes_price, volume_24h, timestamp')
    .in('market_id', marketIds)
    .gte('timestamp', fiveDaysAgo)
    .order('timestamp', { ascending: true })
    .limit(10000);

  if (!historical || historical.length === 0) return [];

  // Group by market, compute range (excluding last 4 hours)
  const histByMarket = new Map<string, { prices: number[]; volumes: number[] }>();
  for (const s of historical) {
    const ts = new Date(s.timestamp).getTime();
    if (ts >= now.getTime() - 4 * 60 * 60 * 1000) continue; // exclude recent
    if (!histByMarket.has(s.market_id)) histByMarket.set(s.market_id, { prices: [], volumes: [] });
    const entry = histByMarket.get(s.market_id)!;
    entry.prices.push(Number(s.yes_price) || 0);
    entry.volumes.push(Number(s.volume_24h) || 0);
  }

  const candidateIds: string[] = [];
  const candidateMetrics = new Map<string, AlertMetrics>();

  for (const [marketId, hist] of histByMarket) {
    if (hist.prices.length < 10) continue; // need meaningful history

    const minPrice = Math.min(...hist.prices);
    const maxPrice = Math.max(...hist.prices);
    const range = maxPrice - minPrice;

    if (range >= 0.04) continue; // not a tight range

    const latest = latestByMarket.get(marketId);
    if (!latest) continue;

    const currentPrice = latest.yes_price;
    const brokeAbove = currentPrice > maxPrice + 0.005;
    const brokeBelow = currentPrice < minPrice - 0.005;

    if (!brokeAbove && !brokeBelow) continue;

    // Check volume multiple
    const avgHistVol = hist.volumes.reduce((a, b) => a + b, 0) / hist.volumes.length;
    if (avgHistVol <= 0) continue;
    const volMultiple = latest.volume_24h / avgHistVol;

    if (volMultiple < 1.5) continue;

    const breakoutMag = brokeAbove ? currentPrice - maxPrice : minPrice - currentPrice;

    candidateIds.push(marketId);
    candidateMetrics.set(marketId, {
      price_current: currentPrice,
      price_previous: brokeAbove ? maxPrice : minPrice,
      price_delta: brokeAbove ? breakoutMag : -breakoutMag,
      volume_24h: latest.volume_24h,
      volume_multiple: volMultiple,
      range_days: 5,
      breakout_magnitude: Math.abs(breakoutMag),
    });
  }

  if (candidateIds.length === 0) return [];

  const meta = await fetchMarketMeta(candidateIds);

  for (const id of candidateIds) {
    const m = candidateMetrics.get(id)!;
    const market = meta.get(id);
    if (!market) continue;

    const strength = Math.min(100, Math.round(
      ((m.breakout_magnitude ?? 0) / 0.10) * 50 + ((m.volume_multiple ?? 0) / 4) * 50
    ));

    alerts.push({
      id: alertId(id, 'RANGE_BREAKOUT'),
      type: 'RANGE_BREAKOUT',
      market_id: id,
      market_question: market.question,
      category: market.category,
      detected_at: new Date().toISOString(),
      signal_strength: strength,
      summary: generateMockSummary('RANGE_BREAKOUT', m, market.question),
      metrics: m,
    });
  }

  return alerts;
}

// ---- Scanner 4: Manipulation Warnings ----

async function scanManipulationWarnings(): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Read existing flagged_moves from the last 24 hours
  const { data: flags } = await bq
    .from('flagged_moves')
    .select('market_id, confidence_score, cluster_score, wallet_concentration_top1, price_start, price_end, price_delta, unique_wallets, total_volume_usdc, signal_direction, summary_text, detection_timestamp')
    .gte('detection_timestamp', twentyFourHoursAgo)
    .gt('confidence_score', 40)
    .order('confidence_score', { ascending: false })
    .limit(50);

  if (!flags || flags.length === 0) return [];

  // Filter to manipulation-like patterns: high concentration + significant price move
  const candidates = flags.filter((f: Record<string, unknown>) => {
    const concentration = Number(f.wallet_concentration_top1) || 0;
    const priceDelta = Math.abs(Number(f.price_delta) || 0);
    return concentration > 0.60 && priceDelta >= 0.05;
  });

  if (candidates.length === 0) return [];

  const marketIds = candidates.map((c: Record<string, unknown>) => c.market_id as string);
  const meta = await fetchMarketMeta(marketIds);

  for (const flag of candidates) {
    const marketId = flag.market_id as string;
    const market = meta.get(marketId);
    if (!market) continue;

    const metrics: AlertMetrics = {
      price_current: Number(flag.price_end) || 0,
      price_previous: Number(flag.price_start) || 0,
      price_delta: Number(flag.price_delta) || 0,
      volume_24h: Number(flag.total_volume_usdc) || 0,
      wallet_count: Number(flag.unique_wallets) || 0,
      concentration_top1: Number(flag.wallet_concentration_top1) || 0,
      cluster_score: Number(flag.cluster_score) || 0,
    };

    alerts.push({
      id: alertId(marketId, 'MANIPULATION_WARNING'),
      type: 'MANIPULATION_WARNING',
      market_id: marketId,
      market_question: market.question,
      category: market.category,
      detected_at: (flag.detection_timestamp as string) || new Date().toISOString(),
      signal_strength: Number(flag.confidence_score) || 0,
      summary: generateMockSummary('MANIPULATION_WARNING', metrics, market.question),
      metrics,
    });
  }

  return alerts;
}

// ---- Main Scanner ----

export async function scanForAlerts(): Promise<{
  alerts: Alert[];
  scan_time: string;
  telemetry: {
    volume_explosions: number;
    smart_money_entries: number;
    range_breakouts: number;
    manipulation_warnings: number;
    total_scanned: number;
    duration_ms: number;
  };
}> {
  const startTime = Date.now();

  // Run all 4 scanners in parallel
  const [volumeAlerts, smartMoneyAlerts, breakoutAlerts, manipAlerts] = await Promise.all([
    scanVolumeExplosions().catch(() => [] as Alert[]),
    scanSmartMoneyEntries().catch(() => [] as Alert[]),
    scanRangeBreakouts().catch(() => [] as Alert[]),
    scanManipulationWarnings().catch(() => [] as Alert[]),
  ]);

  // Merge, dedupe by market_id (keep highest strength per market), rank
  const allAlerts = [...volumeAlerts, ...smartMoneyAlerts, ...breakoutAlerts, ...manipAlerts];

  // Deduplicate: if multiple alert types for same market, keep highest strength
  const bestByMarket = new Map<string, Alert>();
  for (const alert of allAlerts) {
    const existing = bestByMarket.get(alert.market_id);
    if (!existing || alert.signal_strength > existing.signal_strength) {
      bestByMarket.set(alert.market_id, alert);
    }
  }

  // Sort by strength desc, cap at MAX_ALERTS
  const ranked = [...bestByMarket.values()]
    .sort((a, b) => b.signal_strength - a.signal_strength)
    .slice(0, MAX_ALERTS);

  return {
    alerts: ranked,
    scan_time: new Date().toISOString(),
    telemetry: {
      volume_explosions: volumeAlerts.length,
      smart_money_entries: smartMoneyAlerts.length,
      range_breakouts: breakoutAlerts.length,
      manipulation_warnings: manipAlerts.length,
      total_scanned: allAlerts.length,
      duration_ms: Date.now() - startTime,
    },
  };
}
