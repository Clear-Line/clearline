import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
const ID_BATCH = 200;

function classifyPoliticalSubcategory(question: string): 'presidential' | 'senate' | 'gubernatorial' | 'policy' {
  const q = question.toLowerCase();
  if (/president|presidential|white house|oval office/.test(q)) return 'presidential';
  if (/senate|senator/.test(q)) return 'senate';
  if (/governor|gubernatorial/.test(q)) return 'gubernatorial';
  return 'policy';
}

/** Re-categorize at API level to catch markets the poller may have missed */
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
  const DEFAULT_LIMIT = 200;
  const MAX_LIMIT = 1000;

  // Step 1: Get distinct market IDs with volume (paginate to beat Supabase 1000-row default)
  // We query just market_id to minimize data, then fetch full snapshots per batch
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const allMarketIds = new Set<string>();
  let snapOffset = 0;
  const SNAP_PAGE = 1000;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data: page } = await supabaseAdmin
      .from('market_snapshots')
      .select('market_id')
      .gt('volume_24h', 0)
      .gte('timestamp', sixHoursAgo)
      .range(snapOffset, snapOffset + SNAP_PAGE - 1);

    if (!page || page.length === 0) break;
    for (const row of page) allMarketIds.add(row.market_id);
    if (page.length < SNAP_PAGE) break;
    snapOffset += SNAP_PAGE;
  }

  const uniqueMarketIds = [...allMarketIds];
  if (uniqueMarketIds.length === 0) {
    return NextResponse.json({ markets: [], count: 0 });
  }

  // Step 2: Fetch latest + 24h-ago snapshots in parallel batches
  type SnapRow = { market_id: string; yes_price: number; volume_24h: number; liquidity: number; unique_traders_24h: number | null; timestamp: string };
  const allSnapshots: SnapRow[] = [];
  const SNAP_BATCH = 150; // keep under 1000 rows per query (~5 snaps/market in 6h)
  const dayAgoCutoff = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
  const dayAgoEarliest = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  // Run all batches in parallel (each batch fires 2 queries concurrently)
  const batchPromises = [];
  for (let i = 0; i < uniqueMarketIds.length; i += SNAP_BATCH) {
    const batch = uniqueMarketIds.slice(i, i + SNAP_BATCH);
    batchPromises.push(
      Promise.all([
        supabaseAdmin
          .from('market_snapshots')
          .select('market_id, yes_price, volume_24h, liquidity, unique_traders_24h, timestamp')
          .in('market_id', batch)
          .not('volume_24h', 'is', null)
          .gte('timestamp', sixHoursAgo)
          .order('timestamp', { ascending: false }),
        supabaseAdmin
          .from('market_snapshots')
          .select('market_id, yes_price, volume_24h, liquidity, unique_traders_24h, timestamp')
          .in('market_id', batch)
          .not('volume_24h', 'is', null)
          .lte('timestamp', dayAgoCutoff)
          .gte('timestamp', dayAgoEarliest)
          .order('timestamp', { ascending: false })
          .limit(batch.length),
      ]),
    );
  }

  const batchResults = await Promise.all(batchPromises);
  for (const [recentRes, olderRes] of batchResults) {
    if (recentRes.data) allSnapshots.push(...recentRes.data);
    if (olderRes.data) allSnapshots.push(...olderRes.data);
  }

  if (allSnapshots.length === 0) {
    return NextResponse.json({ markets: [], count: 0 });
  }

  // Group by market — for each market, pick the snapshot with the highest volume
  const latestByMarket = new Map<string, { yes_price: number; volume_24h: number; liquidity: number; unique_traders_24h: number | null; timestamp: string }>();
  const price24hAgoByMarket = new Map<string, { yes_price: number }>();
  const snapsByMarket = new Map<string, typeof allSnapshots>();

  for (const snap of allSnapshots) {
    if (!snapsByMarket.has(snap.market_id)) snapsByMarket.set(snap.market_id, []);
    snapsByMarket.get(snap.market_id)!.push(snap);
  }

  const now = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  for (const [marketId, marketSnaps] of snapsByMarket.entries()) {
    // Sort by timestamp desc to get latest first
    marketSnaps.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Use the latest snapshot but pick volume from the snapshot with the highest volume
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

    // Find the snapshot closest to 24h ago for real 24h change
    let best24hSnap: (typeof marketSnaps)[0] | null = null;
    let bestTimeDiff = Infinity;
    for (const s of marketSnaps) {
      const age = now - new Date(s.timestamp).getTime();
      const diff = Math.abs(age - ONE_DAY_MS);
      // Accept snapshots between 12h and 36h ago, prefer closest to 24h
      if (age >= ONE_DAY_MS * 0.5 && age <= ONE_DAY_MS * 1.5 && diff < bestTimeDiff) {
        bestTimeDiff = diff;
        best24hSnap = s;
      }
    }
    // Fallback: if no snapshot near 24h, use the oldest snapshot we have
    if (!best24hSnap && marketSnaps.length > 1) {
      best24hSnap = marketSnaps[marketSnaps.length - 1];
    }
    if (best24hSnap) {
      price24hAgoByMarket.set(marketId, { yes_price: best24hSnap.yes_price });
    }
  }

  // Fetch market metadata
  const trackedMarketIds = [...latestByMarket.keys()];
  const markets: Array<{ condition_id: string; question: string; category: string | null; updated_at: string | null }> = [];

  for (let i = 0; i < trackedMarketIds.length; i += ID_BATCH) {
    const batch = trackedMarketIds.slice(i, i + ID_BATCH);
    const { data, error: mErr } = await supabaseAdmin
      .from('markets')
      .select('condition_id, question, category, updated_at')
      .in('condition_id', batch)
      .eq('is_active', true);

    if (mErr) {
      return NextResponse.json(
        { error: `Markets query failed at batch ${i}: ${mErr.message}` },
        { status: 500 },
      );
    }

    if (data?.length) markets.push(...data);
  }

  // Count unique wallets per market — only for markets that have trades (top ~900)
  // Querying all 2K+ markets would be too slow
  const traderCountByMarket = new Map<string, number>();
  const marketIds = markets.map((m) => m.condition_id);
  const TOP_TRADE_MARKETS = 500; // only count traders for top markets by volume
  const topMarketIds = marketIds.slice(0, TOP_TRADE_MARKETS);
  for (let i = 0; i < topMarketIds.length; i += ID_BATCH) {
    const batch = topMarketIds.slice(i, i + ID_BATCH);
    const { data: tradeCounts } = await supabaseAdmin
      .from('trades')
      .select('market_id, wallet_address')
      .in('market_id', batch);

    if (tradeCounts) {
      const byMarket = new Map<string, Set<string>>();
      for (const t of tradeCounts) {
        if (!byMarket.has(t.market_id)) byMarket.set(t.market_id, new Set());
        byMarket.get(t.market_id)!.add(t.wallet_address);
      }
      for (const [mid, wallets] of byMarket) {
        traderCountByMarket.set(mid, wallets.size);
      }
    }
  }

  // Build market card DTOs — only politics, economics, geopolitics
  const FOCUS = new Set(['politics', 'economics', 'geopolitics']);
  const cards = [];

  for (const m of markets) {
    const category = recategorize(m.question, m.category);
    if (!FOCUS.has(category)) continue;

    const latest = latestByMarket.get(m.condition_id)!;
    const prev24h = price24hAgoByMarket.get(m.condition_id);

    const currentOdds = Number(latest.yes_price) || 0;

    // Skip resolved/settled markets (at 0% or 100%)
    if (currentOdds <= 0.01 || currentOdds >= 0.99) continue;

    const previousOdds = prev24h ? Number(prev24h.yes_price) : currentOdds;
    const change = currentOdds - previousOdds;
    const absDelta = Math.abs(change);
    const volume = Number(latest.volume_24h) || 0;
    const liquidity = Number(latest.liquidity) || 0;
    const traders = traderCountByMarket.get(m.condition_id) ?? null;

    // Compute numeric confidence score (0-100) based on real signals
    // Factors: volume strength, price movement, liquidity depth
    const volScore = Math.min(volume / 500_000, 1) * 35;       // up to 35 pts for volume
    const moveScore = Math.min(absDelta / 0.10, 1) * 30;       // up to 30 pts for price movement
    const liqScore = Math.min(liquidity / 1_000_000, 1) * 20;  // up to 20 pts for liquidity
    const traderScore = traders ? Math.min(traders / 500, 1) * 15 : 5; // up to 15 pts for unique traders
    const confidenceScore = Math.round(volScore + moveScore + liqScore + traderScore);

    let confidence: 'high' | 'medium' | 'low' = 'low';
    if (confidenceScore >= 60) {
      confidence = 'high';
    } else if (confidenceScore >= 30) {
      confidence = 'medium';
    }

    const section = category === 'politics' ? 'political'
      : category === 'geopolitics' ? 'geopolitics'
      : 'economics';
    const uiCategory = category === 'politics'
      ? classifyPoliticalSubcategory(m.question)
      : category === 'geopolitics' ? 'geopolitics'
      : 'economic';

    cards.push({
      id: m.condition_id,
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
    });
  }

  // Sort by volume (hottest markets first)
  cards.sort((a, b) => {
    if (b.volume24h !== a.volume24h) return b.volume24h - a.volume24h;
    return Math.abs(b.change) - Math.abs(a.change);
  });

  const { searchParams } = new URL(request.url);
  const rawLimit = Number(searchParams.get('limit') ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(rawLimit)))
    : DEFAULT_LIMIT;

  const selected = cards.slice(0, limit);

  return NextResponse.json({ markets: selected, count: selected.length, total_available: cards.length });
}
