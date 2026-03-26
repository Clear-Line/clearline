/**
 * GET /api/analytics/arbitrage — returns arbitrage opportunities.
 * Now reads pre-computed correlations from BigQuery instead of computing on-the-fly.
 */

import { NextResponse } from 'next/server';
import { bq } from '../../../../lib/bigquery';
import { supabaseAdmin } from '../../../../lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Get active markets with event grouping
    const { data: markets, error: mErr } = await supabaseAdmin
      .from('markets')
      .select('condition_id, question, event_id')
      .eq('is_active', true)
      .not('event_id', 'is', null);

    if (mErr || !markets) {
      return NextResponse.json({ opportunities: [], count: 0, error: mErr?.message });
    }

    // Group by event (only events with 2+ markets)
    const byEvent = new Map<string, typeof markets>();
    for (const m of markets) {
      if (!m.event_id) continue;
      if (!byEvent.has(m.event_id)) byEvent.set(m.event_id, []);
      byEvent.get(m.event_id)!.push(m);
    }

    const multiMarketEvents = [...byEvent.entries()].filter(([, ms]) => ms.length >= 2);
    const eventMarketIds = multiMarketEvents.flatMap(([, ms]) => ms.map((m) => m.condition_id));

    // Get latest prices
    const ID_BATCH = 200;
    const latestPrices = new Map<string, number>();

    for (let i = 0; i < eventMarketIds.length; i += ID_BATCH) {
      const batch = eventMarketIds.slice(i, i + ID_BATCH);
      const { data: snaps } = await bq
        .from('market_snapshots')
        .select('market_id, yes_price')
        .in('market_id', batch)
        .order('timestamp', { ascending: false })
        .limit(batch.length * 5);

      if (snaps) {
        for (const s of snaps as { market_id: string; yes_price: number }[]) {
          if (!latestPrices.has(s.market_id)) {
            latestPrices.set(s.market_id, s.yes_price);
          }
        }
      }
    }

    // Check each event for arbitrage
    const opportunities = [];
    const DEVIATION_THRESHOLD = 0.05;

    for (const [eventId, eventMarkets] of multiMarketEvents) {
      const marketData = eventMarkets.map((m) => ({
        conditionId: m.condition_id,
        question: m.question,
        yesPrice: latestPrices.get(m.condition_id) ?? 0,
      }));

      const probSum = marketData.reduce((s, m) => s + m.yesPrice, 0);
      const deviation = Math.abs(probSum - 1.0);

      if (deviation > DEVIATION_THRESHOLD) {
        opportunities.push({
          eventId,
          markets: marketData,
          probabilitySum: Math.round(probSum * 10000) / 10000,
          deviation: Math.round(deviation * 10000) / 10000,
        });
      }
    }

    opportunities.sort((a, b) => b.deviation - a.deviation);

    return NextResponse.json({
      opportunities,
      count: opportunities.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: String(err), opportunities: [], count: 0 },
      { status: 500 },
    );
  }
}
