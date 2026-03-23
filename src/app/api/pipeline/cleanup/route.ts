import { NextRequest, NextResponse } from 'next/server';
import { bq } from '@/lib/bigquery';
import { getRetryCount } from '@/lib/pipeline/self-retry';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Cleanup endpoint — purges old data from BigQuery to control storage.
 *
 * BigQuery DELETE doesn't support LIMIT, so each delete is a single statement
 * that removes all matching rows at once (much simpler than batched Supabase deletes).
 *
 * Retention periods (longer than before — BigQuery has 10GB free):
 *   - market_snapshots: 14 days
 *   - trades: 90 days
 *   - market_analytics: 30 days
 *   - wallet_signals: 30 days
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();
  const errors: string[] = [];
  const results: Record<string, number> = {};

  try {
    // 1. Delete old snapshots (> 14 days)
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();
    const snapResult = await bq
      .from('market_snapshots')
      .delete({ count: 'exact' })
      .lt('timestamp', fourteenDaysAgo);
    if (snapResult.error) errors.push(`Snapshot delete: ${snapResult.error.message}`);
    results.snapshots_deleted = snapResult.count ?? 0;

    // 2. Delete old trades (> 90 days)
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
    const tradeResult = await bq
      .from('trades')
      .delete({ count: 'exact' })
      .lt('timestamp', ninetyDaysAgo);
    if (tradeResult.error) errors.push(`Trade delete: ${tradeResult.error.message}`);
    results.trades_deleted = tradeResult.count ?? 0;

    // 3. Delete stale analytics (> 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const analyticsResult = await bq
      .from('market_analytics')
      .delete({ count: 'exact' })
      .lt('computed_at', thirtyDaysAgo);
    if (analyticsResult.error) errors.push(`Analytics delete: ${analyticsResult.error.message}`);
    results.analytics_deleted = analyticsResult.count ?? 0;

    // 4. Delete old wallet_signals (> 30 days)
    const signalsResult = await bq
      .from('wallet_signals')
      .delete({ count: 'exact' })
      .lt('computed_at', thirtyDaysAgo);
    if (signalsResult.error) errors.push(`Signals delete: ${signalsResult.error.message}`);
    results.signals_deleted = signalsResult.count ?? 0;

    return NextResponse.json({
      success: true,
      ...results,
      duration_ms: Date.now() - startTime,
      retryCount: getRetryCount(req),
      errors: errors.slice(0, 10),
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 },
    );
  }
}
