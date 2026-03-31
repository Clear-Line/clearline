import { NextResponse } from 'next/server';
import { bq } from '@/lib/bigquery';
import { requireSubscription } from '@/lib/api-auth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const authError = await requireSubscription();
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const timeframe = searchParams.get('timeframe');
  const limit = Math.min(parseInt(searchParams.get('limit') || '200'), 500);

  let query = bq
    .from('btc_market_cycles')
    .select('*')
    .eq('is_resolved', true)
    .order('window_end', { ascending: false })
    .limit(limit);

  if (timeframe === '1h' || timeframe === '4h') {
    query = query.eq('timeframe', timeframe);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Reverse to oldest-first for charting
  const cycles = (data ?? []).reverse();

  let clearlineWins = 0;
  let polymarketWins = 0;

  const history = cycles.map((c: Record<string, unknown>, i: number) => {
    if (c.clearline_correct) clearlineWins++;
    if (c.polymarket_correct) polymarketWins++;

    const n = i + 1;
    return {
      windowEnd: c.window_end,
      timeframe: c.timeframe,
      question: c.question,
      initialPolymarketProb: c.initial_polymarket_prob,
      initialDerivativesProb: c.initial_derivatives_prob,
      initialSds: c.initial_sds,
      initialConfidence: c.initial_confidence,
      initialSpotPrice: c.initial_spot_price,
      resolutionOutcome: c.resolution_outcome,
      clearlinePredictedUp: c.clearline_predicted_up,
      polymarketPredictedUp: c.polymarket_predicted_up,
      clearlineCorrect: c.clearline_correct,
      polymarketCorrect: c.polymarket_correct,
      clearlineRollingAccuracy: Math.round((clearlineWins / n) * 10000) / 100,
      polymarketRollingAccuracy: Math.round((polymarketWins / n) * 10000) / 100,
    };
  });

  const total = cycles.length;

  return NextResponse.json({
    history,
    summary: {
      total,
      clearlineWins,
      clearlineLosses: total - clearlineWins,
      clearlineAccuracy: total > 0 ? Math.round((clearlineWins / total) * 10000) / 100 : null,
      polymarketWins,
      polymarketLosses: total - polymarketWins,
      polymarketAccuracy: total > 0 ? Math.round((polymarketWins / total) * 10000) / 100 : null,
    },
  });
}
