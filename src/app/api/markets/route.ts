import { NextResponse } from 'next/server';
import { bq } from '@/lib/bigquery';
import { requireSubscription } from '@/lib/api-auth';

export const runtime = 'nodejs';

/**
 * GET /api/markets — reads pre-computed market_cards from BigQuery.
 * Requires authentication + active subscription.
 */
export async function GET(request: Request) {
  const authError = await requireSubscription();
  if (authError) return authError;

  const DEFAULT_LIMIT = 200;
  const MAX_LIMIT = 1000;

  const { searchParams } = new URL(request.url);
  const rawLimit = Number(searchParams.get('limit') ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(rawLimit)))
    : DEFAULT_LIMIT;

  const { data, error } = await bq
    .from('market_cards')
    .select('*')
    .order('volume_24h', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[/api/markets] BigQuery error:', error.message);
    return NextResponse.json({ markets: [], count: 0, error: error.message }, { status: 500 });
  }

  const markets = (data ?? []).map((row: Record<string, unknown>) => {
    const currentOdds = Number(row.current_price) || 0;
    const previousOdds = Number(row.price_24h_ago) || currentOdds;
    const change = Number(row.price_change) || 0;
    const volume = Number(row.volume_24h) || 0;
    const liquidity = Number(row.liquidity) || 0;

    // Confidence from volume + price move
    const volScore = Math.min(volume / 500_000, 1) * 50;
    const moveScore = Math.min(Math.abs(change) / 0.10, 1) * 50;
    const confidenceScore = Math.round(volScore + moveScore);
    let confidence: 'high' | 'medium' | 'low' = 'low';
    if (confidenceScore >= 60) confidence = 'high';
    else if (confidenceScore >= 30) confidence = 'medium';

    const category = row.category as string || 'other';
    const section = category === 'politics' ? 'political'
      : category === 'geopolitics' ? 'geopolitics'
      : category === 'crypto' ? 'crypto'
      : 'economics';

    // Parse top smart wallets
    let topSmartWallets: unknown[] = [];
    try {
      if (row.top_smart_wallets) topSmartWallets = JSON.parse(row.top_smart_wallets as string);
    } catch { /* ignore */ }

    return {
      id: row.market_id,
      title: row.title,
      category,
      section,
      currentOdds,
      previousOdds,
      change,
      volume24h: volume,
      confidence,
      confidenceScore,
      traders: null,
      lastUpdated: row.computed_at,
      liquidity,
      spread: row.spread != null ? Number(row.spread) : null,
      signal: row.signal || 'NEUTRAL',
      signalConfidence: Number(row.signal_confidence) || 0,
      smartBuyVolume: Number(row.smart_buy_volume) || 0,
      smartSellVolume: Number(row.smart_sell_volume) || 0,
      smartWalletCount: Number(row.smart_wallet_count) || 0,
      topSmartWallets,
    };
  }).filter((m: { category: string }) => m.category !== 'sports');

  return NextResponse.json({ markets, count: markets.length });
}
