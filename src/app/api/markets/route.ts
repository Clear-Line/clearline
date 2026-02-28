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

export async function GET(request: Request) {
  const DEFAULT_LIMIT = 20;
  const MAX_LIMIT = 200;

  // Fetch recent snapshots first — these are the markets our pipeline actually tracks
  const { data: snapshots, error: snapshotErr } = await supabaseAdmin
    .from('market_snapshots')
    .select('market_id, yes_price, volume_24h, liquidity, timestamp')
    .order('timestamp', { ascending: false })
    .limit(5000);

  if (snapshotErr) {
    return NextResponse.json({ error: `Snapshot query failed: ${snapshotErr.message}` }, { status: 500 });
  }

  if (!snapshots || snapshots.length === 0) {
    return NextResponse.json({ markets: [], count: 0 });
  }

  // Group snapshots and prefer Gamma-derived rows (volume_24h present) as the price source.
  const latestByMarket = new Map<string, { yes_price: number; volume_24h: number | null; liquidity: number | null; timestamp: string }>();
  const prevByMarket = new Map<string, { yes_price: number }>();
  const snapsByMarket = new Map<string, typeof snapshots>();

  for (const snap of snapshots) {
    if (!snapsByMarket.has(snap.market_id)) snapsByMarket.set(snap.market_id, []);
    snapsByMarket.get(snap.market_id)!.push(snap);
  }

  for (const [marketId, marketSnaps] of snapsByMarket.entries()) {
    const gammaPriceSnaps = marketSnaps.filter((s) => s.volume_24h !== null);
    const priceSnaps = gammaPriceSnaps.length > 0 ? gammaPriceSnaps : marketSnaps;
    if (priceSnaps.length > 0) latestByMarket.set(marketId, priceSnaps[0]);
    if (priceSnaps.length > 1) prevByMarket.set(marketId, priceSnaps[1]);
  }

  // Only fetch markets that have snapshots
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

  // Build market card DTOs
  const cards = markets.map((m) => {
    const latest = latestByMarket.get(m.condition_id)!;
    const prev = prevByMarket.get(m.condition_id);

    const currentOdds = Number(latest.yes_price) || 0;
    const previousOdds = prev ? Number(prev.yes_price) : currentOdds;
    const change = currentOdds - previousOdds;
    const absDelta = Math.abs(change);
    const volume = Number(latest.volume_24h) || 0;
    const liquidity = Number(latest.liquidity) || 0;

    // Temporary signal heuristic
    let confidence: 'high' | 'medium' | 'low' = 'low';
    if (absDelta >= 0.05 && volume > 500_000) {
      confidence = 'high';
    } else if (absDelta >= 0.02 || volume > 200_000) {
      confidence = 'medium';
    }

    const section = m.category === 'politics' ? 'political' : 'other';
    const uiCategory = m.category === 'politics'
      ? classifyPoliticalSubcategory(m.question)
      : 'economic';

    return {
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
    };
  });

  // Prefer markets with actual activity for UI testing/quality
  const nonZeroCards = cards.filter((c) => c.volume24h > 0 || c.liquidity > 0);
  const ranked = (nonZeroCards.length > 0 ? nonZeroCards : cards)
    .sort((a, b) => {
      const changeDiff = Math.abs(b.change) - Math.abs(a.change);
      if (changeDiff !== 0) return changeDiff;
      return b.volume24h - a.volume24h;
    });

  const { searchParams } = new URL(request.url);
  const rawLimit = Number(searchParams.get('limit') ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(rawLimit)))
    : DEFAULT_LIMIT;

  const selected = ranked.slice(0, limit);

  return NextResponse.json({ markets: selected, count: selected.length, total_available: ranked.length });
}
