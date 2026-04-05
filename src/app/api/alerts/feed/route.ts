import { NextRequest, NextResponse } from 'next/server';
import { bq } from '../../../../lib/bigquery';
import { requireSubscription } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/alerts/feed — smart money entry/exit alerts.
 * Requires authentication + active subscription.
 */
export async function GET(req: NextRequest) {
  const authError = await requireSubscription();
  if (authError) return authError;

  const start = Date.now();

  const { data, error } = await bq
    .from('market_cards')
    .select('market_id, title, category, signal, signal_confidence, smart_buy_volume, smart_sell_volume, smart_wallet_count, top_smart_wallets, current_price, price_change, volume_24h, volume_divergence, spread_ratio, depth_ratio, liquidity_vacuum, computed_at')
    .order('signal_confidence', { ascending: false })
    .limit(50);

  if (error) {
    console.error('[/api/alerts/feed] BigQuery error:', error.message);
    return NextResponse.json({ alerts: [], count: 0, error: error.message }, { status: 500 });
  }

  const alerts = (data ?? [])
    .filter((row: Record<string, unknown>) => row.signal && row.signal !== 'NEUTRAL' && row.category !== 'sports')
    .map((row: Record<string, unknown>) => {
      let topWallets: unknown[] = [];
      try {
        if (row.top_smart_wallets) topWallets = JSON.parse(row.top_smart_wallets as string);
      } catch { /* ignore */ }

      const volumeDivergence = Number(row.volume_divergence) || null;
      const spreadRatio = Number(row.spread_ratio) || null;
      const depthRatio = Number(row.depth_ratio) || null;
      const liquidityVacuum = Boolean(row.liquidity_vacuum);

      // Compute compound badges
      const badges: string[] = [];
      if (volumeDivergence != null && volumeDivergence > 5) badges.push('VOLUME_ACCUMULATION');
      if (liquidityVacuum) badges.push('LIQUIDITY_WARNING');
      if (badges.length > 0 && row.signal !== 'NEUTRAL') badges.push('HIGH_CONVICTION');

      return {
        id: `${row.market_id}-${row.signal}`,
        type: row.signal === 'BUY' ? 'SMART_MONEY_BUY' : 'SMART_MONEY_SELL',
        market_id: row.market_id,
        market_question: row.title,
        category: row.category,
        detected_at: row.computed_at,
        signal: row.signal,
        signal_confidence: Number(row.signal_confidence) || 0,
        smart_buy_volume: Number(row.smart_buy_volume) || 0,
        smart_sell_volume: Number(row.smart_sell_volume) || 0,
        smart_wallet_count: Number(row.smart_wallet_count) || 0,
        current_price: Number(row.current_price) || 0,
        price_change: Number(row.price_change) || 0,
        volume_24h: Number(row.volume_24h) || 0,
        top_wallets: topWallets,
        volume_divergence: volumeDivergence,
        spread_ratio: spreadRatio,
        depth_ratio: depthRatio,
        liquidity_vacuum: liquidityVacuum,
        badges,
      };
    });

  const response = NextResponse.json({
    alerts,
    count: alerts.length,
    scan_time: `${Date.now() - start}ms`,
  });
  response.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=150');
  return response;
}
