import { NextResponse } from 'next/server';
import { bq } from '@/lib/bigquery';
import { requireSubscription } from '@/lib/api-auth';

export const runtime = 'nodejs';

/**
 * GET /api/markets/[id] — market detail.
 * Requires authentication + active subscription.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireSubscription();
  if (authError) return authError;

  const { id } = await params;

  const projectId = process.env.GCP_PROJECT_ID!;
  const ds = process.env.BQ_DATASET || 'polymarket';
  const fq = (table: string) => `\`${projectId}.${ds}.${table}\``;

  // Fetch market metadata + market card + snapshots + trades + connected markets in parallel
  const [marketRes, cardRes, snapshotsRes, tradesRes, edgesRes] = await Promise.all([
    bq
      .from('markets')
      .select('condition_id, question, category, outcomes, start_date, end_date, is_active, updated_at')
      .eq('condition_id', id)
      .single(),
    bq.from('market_cards')
      .select('*')
      .eq('market_id', id)
      .limit(1),
    bq.from('market_snapshots')
      .select('yes_price, no_price, volume_24h, total_volume, liquidity, timestamp')
      .eq('market_id', id)
      .not('volume_24h', 'is', null)
      .order('timestamp', { ascending: false })
      .limit(50),
    bq.from('trades')
      .select('wallet_address, size_usdc, side, timestamp')
      .eq('market_id', id)
      .order('timestamp', { ascending: false })
      .limit(500),
    bq.rawQuery<{
      connected_id: string;
      wallet_overlap: number;
      shared_wallets: number;
      price_corr: number | null;
      combined_weight: number;
    }>(`
      SELECT
        CASE WHEN market_a = @id THEN market_b ELSE market_a END AS connected_id,
        wallet_overlap,
        shared_wallets,
        price_corr,
        combined_weight
      FROM ${fq('market_edges')}
      WHERE (market_a = @id OR market_b = @id)
        AND combined_weight > 0.10
      ORDER BY combined_weight DESC
      LIMIT 10
    `, { id }),
  ]);

  const market = marketRes.data;
  if (marketRes.error || !market) {
    return NextResponse.json({ error: 'Market not found' }, { status: 404 });
  }

  const card = (cardRes.data ?? [])[0] ?? null;
  const snaps = snapshotsRes.data ?? [];
  const latest = snaps[0];
  const prev = snaps.length > 1 ? snaps[1] : null;

  const currentOdds = latest ? Number(latest.yes_price) || 0 : 0;
  const previousOdds = prev ? Number(prev.yes_price) : currentOdds;
  const change = currentOdds - previousOdds;
  const volume24h = latest ? Number(latest.volume_24h) || 0 : 0;
  const totalVolume = latest ? Number(latest.total_volume) || 0 : 0;
  const liquidity = latest ? Number(latest.liquidity) || 0 : 0;

  // Build chart data from snapshots (oldest first)
  const chartData = [...snaps].reverse().map((s) => ({
    time: new Date(s.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    odds: Math.round((Number(s.yes_price) || 0) * 100),
    volume: Number(s.volume_24h) || 0,
  }));

  // Aggregate wallet activity from trades
  const walletMap = new Map<string, { volume: number; count: number; sides: string[] }>();
  let totalTradeVolume = 0;
  const uniqueWallets = new Set<string>();

  for (const t of tradesRes.data ?? []) {
    uniqueWallets.add(t.wallet_address);
    const size = Number(t.size_usdc) || 0;
    totalTradeVolume += size;
    const existing = walletMap.get(t.wallet_address);
    if (existing) {
      existing.volume += size;
      existing.count++;
      existing.sides.push(t.side);
    } else {
      walletMap.set(t.wallet_address, { volume: size, count: 1, sides: [t.side] });
    }
  }

  // Top 5 wallets by volume — look up accuracy
  const sortedWallets = [...walletMap.entries()]
    .sort((a, b) => b[1].volume - a[1].volume)
    .slice(0, 5);

  const topAddresses = sortedWallets.map(([addr]) => addr);
  const { data: walletData } = topAddresses.length > 0
    ? await bq
        .from('wallets')
        .select('address, accuracy_score, accuracy_sample_size, total_markets_traded')
        .in('address', topAddresses)
    : { data: [] };

  const walletAccuracyMap = new Map(
    (walletData ?? []).map((w: Record<string, unknown>) => [w.address as string, w]),
  );

  const walletBreakdown = sortedWallets.map(([addr, data]) => {
    const walletInfo = walletAccuracyMap.get(addr) as Record<string, unknown> | undefined;
    const pct = totalTradeVolume > 0 ? Math.round((data.volume / totalTradeVolume) * 100) : 0;
    return {
      walletId: `${addr.slice(0, 6)}...${addr.slice(-4)}`,
      fullAddress: addr,
      percentage: pct,
      accuracy: walletInfo?.accuracy_score ? Math.round(Number(walletInfo.accuracy_score) * 100) : null,
      tradeCount: data.count,
      totalMarkets: (walletInfo?.total_markets_traded as number) ?? null,
    };
  });

  // Connected markets from market_edges
  const connectedEdges = edgesRes.data ?? [];
  const connectedIds = connectedEdges.map((e) => e.connected_id);
  let connectedTitleMap = new Map<string, { question: string; category: string }>();
  if (connectedIds.length > 0) {
    const { data: connectedMarkets } = await bq
      .from('markets')
      .select('condition_id, question, category')
      .in('condition_id', connectedIds);
    connectedTitleMap = new Map(
      (connectedMarkets ?? []).map((m: Record<string, unknown>) => [
        m.condition_id as string,
        { question: m.question as string, category: m.category as string },
      ]),
    );
  }

  // Smart money signal from pre-computed card
  let topSmartWallets: unknown[] = [];
  try {
    if (card?.top_smart_wallets) topSmartWallets = JSON.parse(card.top_smart_wallets);
  } catch { /* ignore */ }

  const section = market.category === 'politics' ? 'political'
    : market.category === 'geopolitics' ? 'geopolitics'
    : market.category === 'crypto' ? 'crypto'
    : 'economics';

  // Confidence
  const absDelta = Math.abs(change);
  let confidence: 'high' | 'medium' | 'low' = 'low';
  if (absDelta >= 0.03 && volume24h > 50_000) confidence = 'high';
  else if (absDelta >= 0.01 || volume24h > 20_000) confidence = 'medium';
  else if (volume24h > 0 || liquidity > 10_000) confidence = 'medium';

  return NextResponse.json({
    id: market.condition_id,
    title: market.question,
    category: market.category,
    section,
    currentOdds,
    previousOdds,
    change,
    volume24h,
    totalVolume,
    liquidity,
    confidence,
    lastUpdated: latest?.timestamp ?? market.updated_at,
    startDate: market.start_date,
    endDate: market.end_date,
    outcomes: typeof market.outcomes === 'string' ? JSON.parse(market.outcomes) : market.outcomes,
    chartData,
    volumeProfile: {
      totalVolume,
      uniqueWallets: uniqueWallets.size,
      topWalletConcentration: walletBreakdown.length > 0 ? walletBreakdown[0].percentage / 100 : 0,
    },
    walletBreakdown,
    // Smart money signal
    signal: card?.signal || 'NEUTRAL',
    signalConfidence: Number(card?.signal_confidence) || 0,
    smartBuyVolume: Number(card?.smart_buy_volume) || 0,
    smartSellVolume: Number(card?.smart_sell_volume) || 0,
    smartWalletCount: Number(card?.smart_wallet_count) || 0,
    topSmartWallets,
    // Connected markets from constellation map edges
    connectedMarkets: connectedEdges.map((e) => {
      const meta = connectedTitleMap.get(e.connected_id);
      return {
        id: e.connected_id,
        title: meta?.question ?? e.connected_id,
        category: meta?.category ?? 'other',
        weight: e.combined_weight,
        sharedWallets: e.shared_wallets,
        walletOverlap: e.wallet_overlap,
        priceCorrelation: e.price_corr,
      };
    }),
  });
}
