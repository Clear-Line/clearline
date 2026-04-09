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
  const MAX_LIMIT = 500;

  const { searchParams } = new URL(request.url);
  const rawLimit = Number(searchParams.get('limit') ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(rawLimit)))
    : DEFAULT_LIMIT;

  const projectId = process.env.GCP_PROJECT_ID!;
  const ds = process.env.BQ_DATASET || 'polymarket';
  const fq = (table: string) => `\`${projectId}.${ds}.${table}\``;

  // LEFT JOIN market_insiders to surface the new behavioral signal alongside
  // the existing card payload. market_insiders is a tiny one-row-per-market
  // table — the join adds essentially zero scan bytes.
  const { data, error } = await bq.rawQuery<Record<string, unknown>>(`
    SELECT c.*, i.insider_count, i.top_insiders
    FROM ${fq('market_cards')} c
    LEFT JOIN ${fq('market_insiders')} i ON i.market_id = c.market_id
    ORDER BY c.volume_24h DESC
    LIMIT ${limit}
  `);

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

    // Parse top smart wallets (legacy historical-accuracy signal)
    let topSmartWallets: unknown[] = [];
    try {
      if (row.top_smart_wallets) topSmartWallets = JSON.parse(row.top_smart_wallets as string);
    } catch { /* ignore */ }

    // Parse top insiders (new behavioral signal from market_insiders join)
    let topInsiders: unknown[] = [];
    try {
      if (row.top_insiders) topInsiders = JSON.parse(row.top_insiders as string);
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
      insiderCount: Number(row.insider_count) || 0,
      topInsiders,
    };
  }).filter((m: { category: string }) => m.category !== 'sports');

  const response = NextResponse.json({ markets, count: markets.length });
  response.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=150');
  return response;
}
