import { NextResponse } from 'next/server';
import { bq } from '@/lib/bigquery';
import { requireSubscription } from '@/lib/api-auth';
import { fetchWalletActivity, PolymarketTrade } from '@/lib/polymarket';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ address: string }> }
) {
  const authError = await requireSubscription();
  if (authError) return authError;

  const { address } = await params;

  // ─── Wallet profile from BQ (accumulated stats) ───
  const { data: walletRow, error: wErr } = await bq
    .from('wallets')
    .select('address, username, pseudonym, accuracy_score, accuracy_sample_size, total_trades, total_volume_usdc, total_markets_traded, total_pnl_usdc, credibility_score, first_seen_polymarket, wins, losses')
    .eq('address', address)
    .single();

  if (wErr || !walletRow) {
    return NextResponse.json({ error: 'Wallet not found' }, { status: 404 });
  }

  // ─── Fetch live trade history from Polymarket API ───
  // This gives real-time data, not limited by our 3-day BQ retention
  let trades: PolymarketTrade[] = [];
  try {
    trades = await fetchWalletActivity(address);
  } catch (err) {
    console.warn(`[WalletDetail] Failed to fetch activity for ${address}: ${err}`);
    // Fall back gracefully — we still have aggregate stats from BQ
  }

  // ─── Build positions from trade history ───
  const positionsByMarket = new Map<string, {
    title: string;
    category: string;
    buyVolume: number;
    sellVolume: number;
    avgBuyPrice: number;
    buyCount: number;
    sellCount: number;
    lastTrade: number;
    outcome: string;
    conditionId: string;
  }>();

  for (const t of trades) {
    const key = t.conditionId;
    const existing = positionsByMarket.get(key) ?? {
      title: t.title || key.slice(0, 16) + '...',
      category: 'other',
      buyVolume: 0,
      sellVolume: 0,
      avgBuyPrice: 0,
      buyCount: 0,
      sellCount: 0,
      lastTrade: t.timestamp,
      outcome: t.outcome,
      conditionId: key,
    };

    if (t.side === 'BUY') {
      existing.avgBuyPrice = ((existing.avgBuyPrice * existing.buyCount) + (t.price || 0)) / (existing.buyCount + 1);
      existing.buyVolume += t.usdcSize || 0;
      existing.buyCount++;
    } else {
      existing.sellVolume += t.usdcSize || 0;
      existing.sellCount++;
    }

    if (t.timestamp > existing.lastTrade) existing.lastTrade = t.timestamp;

    positionsByMarket.set(key, existing);
  }

  // ─── Check which markets are resolved ───
  const marketIds = [...positionsByMarket.keys()];
  const resolvedMap = new Map<string, { resolution_outcome: string; category: string | null }>();
  const activeMarketIds = new Set<string>();

  if (marketIds.length > 0) {
    const BATCH = 200;
    for (let i = 0; i < marketIds.length; i += BATCH) {
      const batch = marketIds.slice(i, i + BATCH);
      const { data: markets } = await bq
        .from('markets')
        .select('condition_id, category, is_resolved, resolution_outcome')
        .in('condition_id', batch);

      if (markets) {
        for (const m of markets) {
          if (m.is_resolved && m.resolution_outcome) {
            resolvedMap.set(m.condition_id, {
              resolution_outcome: m.resolution_outcome,
              category: m.category,
            });
          } else {
            activeMarketIds.add(m.condition_id);
          }
          // Update category on position
          const pos = positionsByMarket.get(m.condition_id);
          if (pos && m.category) pos.category = m.category;
        }
      }
    }
  }

  // ─── Fetch current prices for active positions ───
  const priceMap = new Map<string, number>();
  if (activeMarketIds.size > 0) {
    const activeIds = [...activeMarketIds];
    const { data: cards } = await bq
      .from('market_cards')
      .select('market_id, current_price')
      .in('market_id', activeIds);

    if (cards) {
      for (const c of cards) {
        priceMap.set(c.market_id, c.current_price);
      }
    }
  }

  // ─── Build active positions ───
  const activePositions = [];
  for (const [marketId, pos] of positionsByMarket) {
    if (resolvedMap.has(marketId)) continue; // Skip resolved

    const currentPrice = priceMap.get(marketId) ?? 0;
    const netInvested = pos.buyVolume - pos.sellVolume;
    const currentValue = pos.buyCount > 0 && pos.avgBuyPrice > 0
      ? (pos.buyVolume / pos.avgBuyPrice) * currentPrice
      : 0;
    const unrealizedPnl = currentValue - netInvested;

    activePositions.push({
      marketId,
      title: pos.title,
      category: pos.category,
      side: pos.buyVolume > pos.sellVolume ? 'BUY' : 'SELL',
      invested: Math.round(netInvested * 100) / 100,
      currentPrice: Math.round(currentPrice * 100) / 100,
      avgPrice: Math.round(pos.avgBuyPrice * 100) / 100,
      currentValue: Math.round(currentValue * 100) / 100,
      unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
      trades: pos.buyCount + pos.sellCount,
    });
  }

  activePositions.sort((a, b) => Math.abs(b.invested) - Math.abs(a.invested));

  // ─── Build resolved positions ───
  const resolvedPositions = [];
  for (const [marketId, pos] of positionsByMarket) {
    const resolution = resolvedMap.get(marketId);
    if (!resolution) continue;

    const isNetBuyer = pos.buyVolume > pos.sellVolume;
    const bettedOnWinner = pos.outcome === resolution.resolution_outcome;
    const isWin = (isNetBuyer && bettedOnWinner) || (!isNetBuyer && !bettedOnWinner);

    let pnl = 0;
    if (isNetBuyer && pos.avgBuyPrice > 0) {
      const netInvested = pos.buyVolume - pos.sellVolume;
      pnl = bettedOnWinner ? netInvested * (1 / pos.avgBuyPrice - 1) : -netInvested;
    }

    resolvedPositions.push({
      marketId,
      title: pos.title,
      category: pos.category,
      side: isNetBuyer ? 'BUY' : 'SELL',
      invested: Math.round(pos.buyVolume * 100) / 100,
      pnl: Math.round(pnl * 100) / 100,
      result: isWin ? 'WIN' : 'LOSS',
      resolution: resolution.resolution_outcome,
    });
  }

  resolvedPositions.sort((a, b) => b.pnl - a.pnl);

  // ─── Category performance ───
  const categoryPnl = new Map<string, number>();
  for (const pos of resolvedPositions) {
    categoryPnl.set(pos.category, (categoryPnl.get(pos.category) ?? 0) + pos.pnl);
  }
  const categoryPerformance = [...categoryPnl.entries()]
    .map(([category, pnl]) => ({ category, pnl: Math.round(pnl * 100) / 100 }))
    .sort((a, b) => b.pnl - a.pnl);

  // ─── Trade history (from Polymarket API) ───
  const tradeHistory = trades.slice(0, 100).map((t) => ({
    marketId: t.conditionId,
    title: t.title || t.conditionId.slice(0, 16) + '...',
    category: positionsByMarket.get(t.conditionId)?.category || 'other',
    side: t.side,
    outcome: t.outcome,
    price: t.price || 0,
    sizeUsdc: Math.round((t.usdcSize || 0) * 100) / 100,
    timestamp: new Date(t.timestamp * 1000).toISOString(),
    txHash: t.transactionHash,
  }));

  return NextResponse.json({
    wallet: {
      address: walletRow.address,
      displayName: walletRow.username || walletRow.pseudonym || `${walletRow.address.slice(0, 6)}...${walletRow.address.slice(-4)}`,
      username: walletRow.username || null,
      winRate: Math.round((walletRow.accuracy_score ?? 0) * 100),
      totalTrades: walletRow.total_trades ?? 0,
      totalVolume: Math.round(walletRow.total_volume_usdc ?? 0),
      totalMarkets: walletRow.total_markets_traded ?? 0,
      pnl: Math.round((walletRow.total_pnl_usdc ?? 0) * 100) / 100,
      credibilityScore: walletRow.credibility_score ?? null,
      firstSeen: walletRow.first_seen_polymarket ?? null,
      sampleSize: walletRow.accuracy_sample_size ?? 0,
      wins: walletRow.wins ?? 0,
      losses: walletRow.losses ?? 0,
    },
    activePositions,
    resolvedPositions: resolvedPositions.slice(0, 50),
    categoryPerformance,
    tradeHistory,
  });
}
