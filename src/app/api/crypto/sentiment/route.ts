import { NextResponse } from 'next/server';
import { bq } from '@/lib/bigquery';
import { requireSubscription } from '@/lib/api-auth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const authError = await requireSubscription();
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const asset = searchParams.get('asset') || 'BTC';

  // Fetch latest crypto signals for this asset (up to 2: 1h + 4h timeframes)
  const { data: signalRows, error: sErr } = await bq
    .from('crypto_signals')
    .select('*')
    .eq('asset', asset)
    .order('computed_at', { ascending: false })
    .limit(10);

  if (sErr) {
    return NextResponse.json({ error: sErr.message }, { status: 500 });
  }

  // Deduplicate: keep only the latest signal per timeframe
  const latestByTimeframe = new Map<string, Record<string, unknown>>();
  for (const row of signalRows ?? []) {
    const tf = row.timeframe as string;
    if (!latestByTimeframe.has(tf)) {
      latestByTimeframe.set(tf, row);
    }
  }

  // Fetch latest derivatives data
  const { data: derivRows, error: dErr } = await bq
    .from('crypto_derivatives')
    .select('*')
    .eq('asset', asset)
    .order('fetched_at', { ascending: false })
    .limit(1);

  if (dErr) {
    return NextResponse.json({ error: dErr.message }, { status: 500 });
  }

  const deriv = derivRows?.[0] ?? null;

  // Format signals
  const signals = [...latestByTimeframe.values()].map((s: Record<string, unknown>) => ({
    asset: s.asset,
    timeframe: s.timeframe,
    polymarketProb: s.polymarket_prob,
    polymarketQuestion: s.polymarket_question,
    polymarketMarketId: s.polymarket_market_id,
    derivativesProb: s.derivatives_prob,
    sds: s.sds,
    sdsDirection: s.sds_direction,
    signalBreakdown: {
      fundingRate: s.signal_funding_rate != null ? {
        value: s.signal_funding_rate,
        raw: deriv?.funding_rate ?? null,
        label: 'Funding Rate',
        direction: (s.signal_funding_rate as number) > 0 ? 'bullish' : 'bearish',
      } : null,
      cvd: s.signal_cvd != null ? {
        value: s.signal_cvd,
        raw: s.timeframe === '1h' ? (deriv?.cvd_1h ?? null) : (deriv?.cvd_4h ?? null),
        label: 'Spot CVD',
        direction: (s.signal_cvd as number) > 0 ? 'bullish' : 'bearish',
      } : null,
      optionsSkew: s.signal_options_skew != null ? {
        value: s.signal_options_skew,
        raw: deriv?.options_skew ?? null,
        label: 'Options Skew',
        direction: (s.signal_options_skew as number) > 0 ? 'bullish' : 'bearish',
      } : null,
      openInterest: s.signal_oi != null ? {
        value: s.signal_oi,
        raw: deriv?.oi_change_pct ?? null,
        label: 'Open Interest',
        direction: (s.signal_oi as number) > 0 ? 'bullish' : 'bearish',
      } : null,
      liquidations: s.signal_liquidation != null ? {
        value: s.signal_liquidation,
        raw: deriv?.liquidation_ratio ?? null,
        label: 'Liquidations',
        direction: (s.signal_liquidation as number) > 0 ? 'bullish' : 'bearish',
      } : null,
    },
    signalsActive: s.signals_active,
    signalsAgreeing: s.signals_agreeing,
    agreementScore: s.agreement_score,
    confidence: s.confidence,
    spotPrice: s.spot_price,
    windowEnd: s.window_end,
    computedAt: s.computed_at,
  }));

  // Format derivatives
  const derivatives = deriv ? {
    asset: deriv.asset,
    fundingRate: deriv.funding_rate,
    spotPrice: deriv.spot_price,
    cvd1h: deriv.cvd_1h,
    cvd4h: deriv.cvd_4h,
    buyVol: deriv.cvd_raw_buy_vol,
    sellVol: deriv.cvd_raw_sell_vol,
    optionsSkew: deriv.options_skew,
    oiChangePct: deriv.oi_change_pct,
    fetchedAt: deriv.fetched_at,
  } : null;

  return NextResponse.json({
    signals,
    derivatives,
    meta: {
      phase: 2,
      activeSignals: ['funding_rate', 'cvd', 'options_skew', 'oi'],
      totalSignals: 5,
    },
  });
}
