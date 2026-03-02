import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/src/lib/supabase';

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
  const DEFAULT_LIMIT = 100;
  const MAX_LIMIT = 200;

  // Fetch snapshots with real volume (> 0) sorted by volume to get the hottest markets
  const { data: volSnapshots, error: volErr } = await supabaseAdmin
    .from('market_snapshots')
    .select('market_id, yes_price, volume_24h, liquidity, timestamp')
    .gt('volume_24h', 0)
    .order('volume_24h', { ascending: false })
    .limit(10000);

  if (volErr) {
    return NextResponse.json({ error: `Snapshot query failed: ${volErr.message}` }, { status: 500 });
  }

  // Also fetch recent snapshots with volume = 0 but non-null (markets with price data but no volume)
  const { data: zeroVolSnapshots } = await supabaseAdmin
    .from('market_snapshots')
    .select('market_id, yes_price, volume_24h, liquidity, timestamp')
    .not('volume_24h', 'is', null)
    .eq('volume_24h', 0)
    .order('timestamp', { ascending: false })
    .limit(5000);

  const allSnapshots = [...(volSnapshots ?? []), ...(zeroVolSnapshots ?? [])];

  if (allSnapshots.length === 0) {
    return NextResponse.json({ markets: [], count: 0 });
  }

  // Group by market — for each market, pick the snapshot with the highest volume
  const latestByMarket = new Map<string, { yes_price: number; volume_24h: number; liquidity: number; timestamp: string }>();
  const prevByMarket = new Map<string, { yes_price: number }>();
  const snapsByMarket = new Map<string, typeof allSnapshots>();

  for (const snap of allSnapshots) {
    if (!snapsByMarket.has(snap.market_id)) snapsByMarket.set(snap.market_id, []);
    snapsByMarket.get(snap.market_id)!.push(snap);
  }

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
      timestamp: latest.timestamp,
    });
    if (marketSnaps.length > 1) prevByMarket.set(marketId, { yes_price: marketSnaps[1].yes_price });
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

  // Build market card DTOs — only politics, economics, geopolitics
  const FOCUS = new Set(['politics', 'economics', 'geopolitics']);
  const cards = [];

  for (const m of markets) {
    const category = recategorize(m.question, m.category);
    if (!FOCUS.has(category)) continue;

    const latest = latestByMarket.get(m.condition_id)!;
    const prev = prevByMarket.get(m.condition_id);

    const currentOdds = Number(latest.yes_price) || 0;
    const previousOdds = prev ? Number(prev.yes_price) : currentOdds;
    const change = currentOdds - previousOdds;
    const absDelta = Math.abs(change);
    const volume = Number(latest.volume_24h) || 0;
    const liquidity = Number(latest.liquidity) || 0;

    // Signal confidence based on price movement and volume
    let confidence: 'high' | 'medium' | 'low' = 'low';
    if (absDelta >= 0.03 && volume > 50_000) {
      confidence = 'high';
    } else if (absDelta >= 0.01 || volume > 100_000) {
      confidence = 'medium';
    } else if (volume > 50_000) {
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
