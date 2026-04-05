import { NextResponse } from 'next/server';
import { bq } from '@/lib/bigquery';
import { requireSubscription } from '@/lib/api-auth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const authError = await requireSubscription();
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search')?.toLowerCase() || '';
  const sortBy = searchParams.get('sort') || 'pnl';
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);

  // Push sort to SQL so we fetch the RIGHT top 200, not just top accuracy
  let orderColumn = 'total_pnl_usdc';
  switch (sortBy) {
    case 'winRate': orderColumn = 'accuracy_score'; break;
    case 'volume': orderColumn = 'total_volume_usdc'; break;
    case 'trades': orderColumn = 'total_trades'; break;
    case 'pnl': default: orderColumn = 'total_pnl_usdc'; break;
  }

  // Minimum 3 resolved outcomes to appear on leaderboard
  const { data: wallets, error: wErr } = await bq
    .from('wallets')
    .select('address, username, pseudonym, accuracy_score, accuracy_sample_size, total_trades, total_volume_usdc, total_markets_traded, total_pnl_usdc, credibility_score, wins, losses')
    .gte('accuracy_sample_size', 3)
    .order(orderColumn, { ascending: false })
    .limit(200);

  if (wErr) {
    return NextResponse.json({ error: wErr.message }, { status: 500 });
  }

  if (!wallets || wallets.length === 0) {
    return NextResponse.json({ wallets: [], total: 0, page, limit });
  }

  // Build response — wins/losses come directly from wallet row (no trade queries needed)
  let walletCards = wallets.map((w: any, idx: number) => {
    const wins = w.wins ?? 0;
    const losses = w.losses ?? 0;
    const winRate = w.accuracy_score ? Math.round(w.accuracy_score * 100) : 0;
    const pnl = w.total_pnl_usdc ?? 0;

    return {
      rank: idx + 1,
      address: w.address,
      displayName: w.username || w.pseudonym || `${w.address.slice(0, 6)}...${w.address.slice(-4)}`,
      username: w.username || null,
      totalPositions: w.total_markets_traded ?? 0,
      activePositions: 0, // Not computed here — too expensive per request
      wins,
      losses,
      winRate,
      totalVolume: Math.round(w.total_volume_usdc ?? 0),
      pnl: Math.round(pnl * 100) / 100,
      credibilityScore: w.credibility_score ?? null,
      totalTrades: w.total_trades ?? 0,
    };
  });

  // Filter by search (client-side on the 200 rows)
  if (search) {
    walletCards = walletCards.filter((w: any) =>
      w.address.toLowerCase().includes(search) ||
      w.displayName.toLowerCase().includes(search) ||
      (w.username && w.username.toLowerCase().includes(search))
    );
  }

  // Re-rank after filter
  walletCards.forEach((w: any, i: number) => { w.rank = i + 1; });

  // Paginate
  const total = walletCards.length;
  const start = (page - 1) * limit;
  const paged = walletCards.slice(start, start + limit);

  return NextResponse.json({ wallets: paged, total, page, limit });
}
