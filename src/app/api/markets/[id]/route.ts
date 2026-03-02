import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/src/lib/supabase';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Fetch the market
  const { data: market, error: mErr } = await supabaseAdmin
    .from('markets')
    .select('condition_id, question, category, outcomes, start_date, end_date, is_active, updated_at')
    .eq('condition_id', id)
    .single();

  if (mErr || !market) {
    return NextResponse.json({ error: 'Market not found' }, { status: 404 });
  }

  // Fetch last 50 snapshots with actual volume data (from Gamma API, not CLOB)
  const { data: snapshots } = await supabaseAdmin
    .from('market_snapshots')
    .select('yes_price, no_price, volume_24h, total_volume, liquidity, timestamp')
    .eq('market_id', id)
    .not('volume_24h', 'is', null)
    .order('timestamp', { ascending: false })
    .limit(50);

  const snaps = snapshots ?? [];
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

  // Fetch trades for this market to build wallet breakdown
  const { data: trades } = await supabaseAdmin
    .from('trades')
    .select('wallet_address, size_usdc, side, timestamp')
    .eq('market_id', id)
    .order('timestamp', { ascending: false })
    .limit(500);

  // Aggregate wallet activity
  const walletMap = new Map<string, { volume: number; count: number; sides: string[] }>();
  let totalTradeVolume = 0;
  const uniqueWallets = new Set<string>();

  for (const t of trades ?? []) {
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

  // Sort wallets by volume and take top 5
  const sortedWallets = [...walletMap.entries()]
    .sort((a, b) => b[1].volume - a[1].volume)
    .slice(0, 5);

  // Look up wallet accuracy for top wallets
  const topAddresses = sortedWallets.map(([addr]) => addr);
  const { data: walletData } = topAddresses.length > 0
    ? await supabaseAdmin
        .from('wallets')
        .select('address, accuracy_score, accuracy_sample_size, total_markets_traded')
        .in('address', topAddresses)
    : { data: [] };

  const walletAccuracyMap = new Map(
    (walletData ?? []).map((w) => [w.address, w]),
  );

  const walletBreakdown = sortedWallets.map(([addr, data]) => {
    const walletInfo = walletAccuracyMap.get(addr);
    const pct = totalTradeVolume > 0 ? Math.round((data.volume / totalTradeVolume) * 100) : 0;
    return {
      walletId: `${addr.slice(0, 6)}...${addr.slice(-4)}`,
      fullAddress: addr,
      percentage: pct,
      accuracy: walletInfo?.accuracy_score ? Math.round(walletInfo.accuracy_score * 100) : null,
      tradeCount: data.count,
      totalMarkets: walletInfo?.total_markets_traded ?? null,
    };
  });

  const topWalletConcentration = walletBreakdown.length > 0 ? walletBreakdown[0].percentage / 100 : 0;

  // Fetch flagged moves for this market
  const { data: flaggedMoves } = await supabaseAdmin
    .from('flagged_moves')
    .select('summary_text, confidence_score, catalyst_type, catalyst_description, detection_timestamp, price_delta, signal_direction')
    .eq('market_id', id)
    .order('detection_timestamp', { ascending: false })
    .limit(5);

  // Build catalysts from flagged moves
  const catalysts = (flaggedMoves ?? [])
    .filter((fm) => fm.catalyst_type)
    .map((fm) => ({
      type: fm.catalyst_type,
      description: fm.catalyst_description || fm.summary_text,
      timestamp: fm.detection_timestamp,
    }));

  // Confidence
  const absDelta = Math.abs(change);
  let confidence: 'high' | 'medium' | 'low' = 'low';
  if (absDelta >= 0.03 && volume24h > 50_000) {
    confidence = 'high';
  } else if (absDelta >= 0.01 || volume24h > 20_000) {
    confidence = 'medium';
  } else if (volume24h > 0 || liquidity > 10_000) {
    confidence = 'medium';
  }

  const section = market.category === 'politics' ? 'political'
    : market.category === 'geopolitics' ? 'geopolitics'
    : 'economics';

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
    outcomes: market.outcomes,
    chartData,
    volumeProfile: {
      totalVolume: totalTradeVolume || totalVolume,
      uniqueWallets: uniqueWallets.size,
      topWalletConcentration,
    },
    walletBreakdown,
    catalysts,
    flaggedMoves: (flaggedMoves ?? []).map((fm) => ({
      summary: fm.summary_text,
      confidence: fm.confidence_score,
      direction: fm.signal_direction,
      priceDelta: fm.price_delta,
      timestamp: fm.detection_timestamp,
    })),
  });
}
