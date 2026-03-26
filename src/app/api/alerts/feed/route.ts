/**
 * GET /api/alerts/feed — returns recent alerts from BigQuery.
 * Alerts are now pre-computed by the pipeline worker.
 * This route is read-only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { bq } from '../../../../lib/bigquery';
import { supabaseAdmin } from '../../../../lib/supabase';

export const dynamic = 'force-dynamic';

type AlertType = 'VOLUME_EXPLOSION' | 'SMART_MONEY_ENTRY' | 'RANGE_BREAKOUT' | 'MANIPULATION_WARNING';

const VALID_TYPES = new Set<AlertType>([
  'VOLUME_EXPLOSION',
  'SMART_MONEY_ENTRY',
  'RANGE_BREAKOUT',
  'MANIPULATION_WARNING',
]);

export async function GET(req: NextRequest) {
  try {
    const typeParam = req.nextUrl.searchParams.get('type') as AlertType | null;

    // Fetch recent flagged moves (alerts are stored in flagged_moves by the worker)
    const { data: flags, error } = await bq
      .from('flagged_moves')
      .select('market_id, detection_timestamp, catalyst_type, signal_direction, confidence_score, cluster_score, summary_text, total_volume_usdc, unique_wallets, price_start, price_end, price_delta')
      .gte('detection_timestamp', new Date(Date.now() - 24 * 3600000).toISOString())
      .order('detection_timestamp', { ascending: false })
      .limit(50);

    if (error || !flags) {
      return NextResponse.json({ alerts: [], count: 0, error: error?.message });
    }

    // Map to alert format
    const marketIds = [...new Set(flags.map((f: { market_id: string }) => f.market_id))];
    const { data: markets } = await supabaseAdmin
      .from('markets')
      .select('condition_id, question, category')
      .in('condition_id', marketIds);

    const marketMap = new Map<string, { question: string; category: string }>();
    if (markets) {
      for (const m of markets) marketMap.set(m.condition_id, m);
    }

    let alerts = flags.map((f: Record<string, unknown>) => {
      const market = marketMap.get(f.market_id as string);
      // Map catalyst_type to alert type
      let alertType: AlertType = 'SMART_MONEY_ENTRY';
      const catalyst = f.catalyst_type as string;
      if (catalyst === 'wallet_cluster') alertType = 'SMART_MONEY_ENTRY';
      else if (catalyst === 'volume_spike') alertType = 'VOLUME_EXPLOSION';
      else if (catalyst === 'breakout') alertType = 'RANGE_BREAKOUT';
      else if (catalyst === 'manipulation') alertType = 'MANIPULATION_WARNING';

      return {
        id: `${f.market_id}-${f.detection_timestamp}`,
        type: alertType,
        market_id: f.market_id,
        market_question: market?.question || 'Unknown',
        category: market?.category || 'other',
        detected_at: f.detection_timestamp,
        signal_strength: f.confidence_score ?? f.cluster_score ?? 0,
        summary: f.summary_text || '',
        metrics: {
          price_current: f.price_end ?? 0,
          price_previous: f.price_start ?? 0,
          price_delta: f.price_delta ?? 0,
          volume_24h: f.total_volume_usdc ?? 0,
          wallet_count: f.unique_wallets ?? 0,
          direction: f.signal_direction ?? 'unknown',
        },
      };
    });

    if (typeParam && VALID_TYPES.has(typeParam)) {
      alerts = alerts.filter((a: { type: AlertType }) => a.type === typeParam);
    }

    return NextResponse.json({
      alerts,
      count: alerts.length,
      scan_time: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: String(err), alerts: [], count: 0 },
      { status: 500 },
    );
  }
}
