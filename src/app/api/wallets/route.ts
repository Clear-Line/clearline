import { NextResponse } from 'next/server';
import { bq } from '@/lib/bigquery';

export const runtime = 'nodejs';

export async function GET() {
  // Fetch top wallets by accuracy (with minimum sample size)
  const { data: wallets, error: wErr } = await bq
    .from('wallets')
    .select('address, username, pseudonym, accuracy_score, accuracy_sample_size')
    .gte('accuracy_sample_size', 2)
    .gt('accuracy_score', 0)
    .order('accuracy_score', { ascending: false })
    .limit(100);

  if (wErr) {
    return NextResponse.json({ error: wErr.message }, { status: 500 });
  }

  if (!wallets || wallets.length === 0) {
    return NextResponse.json({ wallets: [], count: 0 });
  }

  // Get trade counts and recent trades for these wallets
  const addresses = wallets.map((w) => w.address);
  const ID_BATCH = 50;
  const tradeCountByWallet = new Map<string, number>();
  const recentTradesByWallet = new Map<string, Array<{ market_id: string; side: string; size_usdc: number; timestamp: string }>>();

  for (let i = 0; i < addresses.length; i += ID_BATCH) {
    const batch = addresses.slice(i, i + ID_BATCH);
    const { data: trades } = await bq
      .from('trades')
      .select('wallet_address, market_id, side, size_usdc, timestamp')
      .in('wallet_address', batch)
      .order('timestamp', { ascending: false })
      .limit(1000);

    if (trades) {
      for (const t of trades) {
        tradeCountByWallet.set(t.wallet_address, (tradeCountByWallet.get(t.wallet_address) || 0) + 1);
        const existing = recentTradesByWallet.get(t.wallet_address) || [];
        if (existing.length < 5) {
          existing.push({ market_id: t.market_id, side: t.side, size_usdc: t.size_usdc, timestamp: t.timestamp });
          recentTradesByWallet.set(t.wallet_address, existing);
        }
      }
    }
  }

  // Fetch market titles for recent trades
  const allMarketIds = new Set<string>();
  for (const trades of recentTradesByWallet.values()) {
    for (const t of trades) allMarketIds.add(t.market_id);
  }
  const marketTitles = new Map<string, string>();
  const marketIds = [...allMarketIds];
  for (let i = 0; i < marketIds.length; i += ID_BATCH) {
    const batch = marketIds.slice(i, i + ID_BATCH);
    const { data } = await bq
      .from('markets')
      .select('condition_id, question')
      .in('condition_id', batch);
    if (data) {
      for (const m of data) marketTitles.set(m.condition_id, m.question);
    }
  }

  // Also pull tier1 composite scores if available
  const { data: signals } = await bq
    .from('wallet_signals')
    .select('wallet_address, composite_score')
    .in('wallet_address', addresses)
    .order('composite_score', { ascending: false });

  const compositeByWallet = new Map<string, number>();
  if (signals) {
    for (const s of signals) {
      if (!compositeByWallet.has(s.wallet_address)) {
        compositeByWallet.set(s.wallet_address, s.composite_score);
      }
    }
  }

  // Build response
  const walletCards = wallets.map((w) => {
    const trades = recentTradesByWallet.get(w.address) || [];
    const shortAddr = `${w.address.slice(0, 6)}...${w.address.slice(-4)}`;
    return {
      id: shortAddr,
      fullAddress: w.address,
      username: w.username || w.pseudonym || null,
      accuracy: Math.round((w.accuracy_score ?? 0) * 100),
      sampleSize: w.accuracy_sample_size ?? 0,
      totalTrades: tradeCountByWallet.get(w.address) || 0,
      compositeScore: compositeByWallet.get(w.address) ?? null,
      recentActivity: trades.map((t) => ({
        marketTitle: marketTitles.get(t.market_id) || t.market_id.slice(0, 12) + '...',
        position: `${t.side} $${Number(t.size_usdc).toFixed(0)}`,
        timestamp: t.timestamp,
      })),
    };
  });

  // Sort by a combined score: accuracy weight + trade activity
  walletCards.sort((a, b) => {
    const scoreA = a.accuracy * 0.7 + Math.min(a.totalTrades, 100) * 0.3;
    const scoreB = b.accuracy * 0.7 + Math.min(b.totalTrades, 100) * 0.3;
    return scoreB - scoreA;
  });

  return NextResponse.json({ wallets: walletCards, count: walletCards.length });
}
