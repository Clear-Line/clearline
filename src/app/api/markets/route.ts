import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { bq } from '@/lib/bigquery';

export const runtime = 'nodejs';
const ID_BATCH = 200;

// ── In-memory cache (refreshes every 2 minutes) ──
let cachedResponse: { data: unknown; timestamp: number } | null = null;
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

function classifyPoliticalSubcategory(question: string): 'presidential' | 'senate' | 'gubernatorial' | 'policy' {
  const q = question.toLowerCase();
  if (/president|presidential|white house|oval office/.test(q)) return 'presidential';
  if (/senate|senator/.test(q)) return 'senate';
  if (/governor|gubernatorial/.test(q)) return 'gubernatorial';
  return 'policy';
}

function recategorize(question: string, dbCategory: string | null): string {
  if (dbCategory === 'politics' || dbCategory === 'economics' || dbCategory === 'geopolitics') {
    return dbCategory;
  }
  const q = question.toLowerCase();
  if (/iran|israel|gaza|ukraine|russia|china|taiwan|war |conflict|sanctions|military|nato|ceasefire|invasion|missile|nuclear|north korea|houthi|hezbollah|syria|yemen|coup|terror|strike/.test(q)) return 'geopolitics';
  if (/president|gop|democrat|republican|election|senate|governor|congress|vote|primary|caucus|ballot|trump|biden/.test(q)) return 'politics';
  if (/fed |interest rate|inflation|gdp|s&p|nasdaq|recession|unemployment|tariff|trade war|oil price|treasury|debt ceiling|stock market|dow jones/.test(q)) return 'economics';
  return dbCategory || 'other';
}

export async function GET(request: Request) {
  const DEFAULT_LIMIT = 50;
  const MAX_LIMIT = 200;

  const { searchParams } = new URL(request.url);
  const rawLimit = Number(searchParams.get('limit') ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(rawLimit)))
    : DEFAULT_LIMIT;

  // Return cached response if fresh
  if (cachedResponse && (Date.now() - cachedResponse.timestamp) < CACHE_TTL_MS) {
    const cached = cachedResponse.data as { markets: unknown[]; total_available: number };
    const selected = cached.markets.slice(0, limit);
    return NextResponse.json({ markets: selected, count: selected.length, total_available: cached.total_available });
  }

  const FOCUS = new Set(['politics', 'economics', 'geopolitics', 'crypto']);
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  // ── Step 1: Get top volume market IDs from BigQuery (single fast query) ──
  const { data: topSnaps } = await bq
    .from('market_snapshots')
    .select('market_id, volume_24h')
    .gt('volume_24h', 0)
    .gte('timestamp', fortyEightHoursAgo)
    .order('volume_24h', { ascending: false })
    .limit(10000);

  const seenIds = new Set<string>();
  const candidateIds: string[] = [];
  for (const row of topSnaps ?? []) {
    if (!seenIds.has(row.market_id)) {
      seenIds.add(row.market_id);
      candidateIds.push(row.market_id);
    }
  }

  if (candidateIds.length === 0) {
    return NextResponse.json({ markets: [], count: 0 });
  }

  // ── Step 2: Get metadata + filter to focus categories (Supabase, parallel batches) ──
  type MarketMeta = { condition_id: string; question: string; category: string | null; updated_at: string | null };
  const metaPromises: Promise<MarketMeta[]>[] = [];

  for (let i = 0; i < candidateIds.length; i += ID_BATCH) {
    const batch = candidateIds.slice(i, i + ID_BATCH);
    metaPromises.push(
      Promise.resolve(
        supabaseAdmin
          .from('markets')
          .select('condition_id, question, category, updated_at')
          .in('condition_id', batch)
          .eq('is_active', true)
      ).then((res) => (res.data ?? []) as MarketMeta[])
    );
  }

  const metaBatches = await Promise.all(metaPromises);
  const metaByMarket = new Map<string, MarketMeta>();

  for (const batch of metaBatches) {
    for (const m of batch) {
      const cat = recategorize(m.question, m.category);
      if (FOCUS.has(cat)) {
        metaByMarket.set(m.condition_id, { ...m, category: cat });
      }
    }
  }

  // Take top N by volume order (candidateIds preserves volume ordering)
  const focusIds = candidateIds.filter(id => metaByMarket.has(id)).slice(0, Math.min(limit * 3, MAX_LIMIT));

  if (focusIds.length === 0) {
    return NextResponse.json({ markets: [], count: 0 });
  }

  // ── Step 3: Fetch snapshots + analytics + edge ALL IN PARALLEL ──
  const dayAgoCutoff = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
  const dayAgoEarliest = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  // Build all queries upfront, run them all at once
  type SnapRow = { market_id: string; yes_price: number; volume_24h: number; liquidity: number; unique_traders_24h: number | null; timestamp: string };

  const allPromises: Promise<unknown>[] = [];
  const recentSnapResults: SnapRow[][] = [];
  const olderSnapResults: SnapRow[][] = [];
  const analyticsResults: { market_id: string; is_publishable: boolean; coverage_score: number }[][] = [];
  const edgeResults: { market_id: string; edge_score: number; edge_direction: string; market_regime: string }[][] = [];

  for (let i = 0; i < focusIds.length; i += ID_BATCH) {
    const batch = focusIds.slice(i, i + ID_BATCH);
    const batchIdx = Math.floor(i / ID_BATCH);

    // Recent snapshots
    allPromises.push(
      bq.from('market_snapshots')
        .select('market_id, yes_price, volume_24h, liquidity, unique_traders_24h, timestamp')
        .in('market_id', batch)
        .gte('timestamp', fortyEightHoursAgo)
        .order('timestamp', { ascending: false })
        .then((r: { data: SnapRow[] | null }) => { recentSnapResults[batchIdx] = r.data ?? []; })
    );

    // 24h-ago snapshots
    allPromises.push(
      bq.from('market_snapshots')
        .select('market_id, yes_price, volume_24h, liquidity, unique_traders_24h, timestamp')
        .in('market_id', batch)
        .lte('timestamp', dayAgoCutoff)
        .gte('timestamp', dayAgoEarliest)
        .order('timestamp', { ascending: false })
        .limit(batch.length)
        .then((r: { data: SnapRow[] | null }) => { olderSnapResults[batchIdx] = r.data ?? []; })
    );

    // Analytics
    allPromises.push(
      bq.from('market_analytics')
        .select('market_id, is_publishable, coverage_score')
        .in('market_id', batch)
        .then((r: { data: any[] | null }) => { analyticsResults[batchIdx] = r.data ?? []; })
    );

    // Edge scores
    allPromises.push(
      bq.from('market_edge')
        .select('market_id, edge_score, edge_direction, market_regime')
        .in('market_id', batch)
        .then((r: { data: any[] | null }) => { edgeResults[batchIdx] = r.data ?? []; })
    );
  }

  await Promise.all(allPromises);

  // ── Step 4: Process snapshots ──
  const allSnapshots: SnapRow[] = [];
  for (const batch of recentSnapResults) if (batch) allSnapshots.push(...batch);
  for (const batch of olderSnapResults) if (batch) allSnapshots.push(...batch);

  if (allSnapshots.length === 0) {
    return NextResponse.json({ markets: [], count: 0 });
  }

  const latestByMarket = new Map<string, { yes_price: number; volume_24h: number; liquidity: number; unique_traders_24h: number | null; timestamp: string }>();
  const price24hAgoByMarket = new Map<string, { yes_price: number }>();
  const snapsByMarket = new Map<string, SnapRow[]>();

  for (const snap of allSnapshots) {
    if (!snapsByMarket.has(snap.market_id)) snapsByMarket.set(snap.market_id, []);
    snapsByMarket.get(snap.market_id)!.push(snap);
  }

  const now = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  for (const [marketId, marketSnaps] of snapsByMarket.entries()) {
    marketSnaps.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const latest = marketSnaps[0];
    const bestVolSnap = marketSnaps.reduce((best, s) =>
      (s.volume_24h ?? 0) > (best.volume_24h ?? 0) ? s : best, marketSnaps[0]);

    latestByMarket.set(marketId, {
      yes_price: latest.yes_price,
      volume_24h: bestVolSnap.volume_24h ?? 0,
      liquidity: bestVolSnap.liquidity ?? 0,
      unique_traders_24h: bestVolSnap.unique_traders_24h ?? null,
      timestamp: latest.timestamp,
    });

    let best24hSnap: SnapRow | null = null;
    let bestTimeDiff = Infinity;
    for (const s of marketSnaps) {
      const age = now - new Date(s.timestamp).getTime();
      const diff = Math.abs(age - ONE_DAY_MS);
      if (age >= ONE_DAY_MS * 0.5 && age <= ONE_DAY_MS * 1.5 && diff < bestTimeDiff) {
        bestTimeDiff = diff;
        best24hSnap = s;
      }
    }
    if (!best24hSnap && marketSnaps.length > 1) {
      best24hSnap = marketSnaps[marketSnaps.length - 1];
    }
    if (best24hSnap) {
      price24hAgoByMarket.set(marketId, { yes_price: best24hSnap.yes_price });
    }
  }

  // Index analytics + edge
  const analyticsPublishable = new Map<string, { is_publishable: boolean; coverage_score: number }>();
  const edgeByMarket = new Map<string, { edge_score: number; edge_direction: string; market_regime: string }>();

  for (const batch of analyticsResults) {
    if (!batch) continue;
    for (const a of batch) {
      analyticsPublishable.set(a.market_id, { is_publishable: a.is_publishable ?? false, coverage_score: a.coverage_score ?? 0 });
    }
  }
  for (const batch of edgeResults) {
    if (!batch) continue;
    for (const e of batch) {
      edgeByMarket.set(e.market_id, { edge_score: e.edge_score ?? 0, edge_direction: e.edge_direction ?? 'neutral', market_regime: e.market_regime ?? 'unknown' });
    }
  }

  // ── Step 5: Build market cards ──
  const cards = [];

  for (const id of focusIds) {
    const m = metaByMarket.get(id);
    const latest = latestByMarket.get(id);
    if (!m || !latest) continue;

    const category = m.category || 'other';
    const currentOdds = Number(latest.yes_price) || 0;
    if (currentOdds <= 0.01 || currentOdds >= 0.99) continue;

    const prev24h = price24hAgoByMarket.get(id);
    const previousOdds = prev24h ? Number(prev24h.yes_price) : currentOdds;
    const change = currentOdds - previousOdds;
    const absDelta = Math.abs(change);
    const volume = Number(latest.volume_24h) || 0;
    const liquidity = Number(latest.liquidity) || 0;
    const traders = latest.unique_traders_24h ?? null;

    const volScore = Math.min(volume / 500_000, 1) * 35;
    const moveScore = Math.min(absDelta / 0.10, 1) * 30;
    const liqScore = Math.min(liquidity / 1_000_000, 1) * 20;
    const traderScore = traders ? Math.min(traders / 500, 1) * 15 : 5;
    const confidenceScore = Math.round(volScore + moveScore + liqScore + traderScore);

    let confidence: 'high' | 'medium' | 'low' = 'low';
    if (confidenceScore >= 60) confidence = 'high';
    else if (confidenceScore >= 30) confidence = 'medium';

    const section = category === 'politics' ? 'political'
      : category === 'geopolitics' ? 'geopolitics'
      : category === 'crypto' ? 'crypto'
      : 'economics';
    const uiCategory = category === 'politics'
      ? classifyPoliticalSubcategory(m.question)
      : category === 'geopolitics' ? 'geopolitics'
      : category === 'crypto' ? 'crypto'
      : 'economic';

    const ap = analyticsPublishable.get(id);
    const ed = edgeByMarket.get(id);

    cards.push({
      id,
      title: m.question,
      category: uiCategory,
      section,
      currentOdds,
      previousOdds,
      change,
      volume24h: volume,
      confidence,
      confidenceScore,
      traders: traders ?? null,
      lastUpdated: latest.timestamp ?? m.updated_at,
      liquidity,
      dataQuality: {
        isPublishable: ap?.is_publishable ?? false,
        coverageScore: ap?.coverage_score ?? 0,
      },
      edge: ed ? {
        score: ed.edge_score,
        direction: ed.edge_direction,
        regime: ed.market_regime,
      } : null,
    });
  }

  // Cache the full result set (sliced per-request by limit)
  cachedResponse = { data: { markets: cards, total_available: cards.length }, timestamp: Date.now() };

  const selected = cards.slice(0, limit);

  return NextResponse.json({ markets: selected, count: selected.length, total_available: cards.length });
}
