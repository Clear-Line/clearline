import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { shouldRetry, scheduleRetry, getRetryCount } from '@/lib/pipeline/self-retry';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Cleanup endpoint — purges old data to keep tables manageable.
 *
 * Deletes:
 *   - market_snapshots older than 3 days (keeps enough for analytics)
 *   - trades older than 30 days
 *   - stale analytics rows (computed_at > 7 days ago)
 *   - wallet_signals older than 14 days
 *
 * All deletes are batched to avoid statement timeouts.
 * Should be run as part of the cron chain (last step).
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();
  const TIME_BUDGET_MS = 50_000;
  const errors: string[] = [];
  const results: Record<string, number> = {};

  try {
    // 1. Delete old snapshots (> 3 days)
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
    let snapsDeleted = 0;
    for (let i = 0; i < 20; i++) {
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        errors.push('Time budget reached during snapshot cleanup');
        break;
      }
      const { count, error } = await supabaseAdmin
        .from('market_snapshots')
        .delete({ count: 'exact' })
        .lt('timestamp', threeDaysAgo)
        .limit(5000);
      if (error) { errors.push(`Snapshot delete: ${error.message}`); break; }
      snapsDeleted += count ?? 0;
      if ((count ?? 0) < 5000) break;
    }
    results.snapshots_deleted = snapsDeleted;

    // 2. Delete old trades (> 30 days)
    if (Date.now() - startTime < TIME_BUDGET_MS) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
      let tradesDeleted = 0;
      for (let i = 0; i < 10; i++) {
        if (Date.now() - startTime > TIME_BUDGET_MS) {
          errors.push('Time budget reached during trade cleanup');
          break;
        }
        const { count, error } = await supabaseAdmin
          .from('trades')
          .delete({ count: 'exact' })
          .lt('timestamp', thirtyDaysAgo)
          .limit(5000);
        if (error) { errors.push(`Trade delete: ${error.message}`); break; }
        tradesDeleted += count ?? 0;
        if ((count ?? 0) < 5000) break;
      }
      results.trades_deleted = tradesDeleted;
    }

    // 3. Delete stale analytics (> 7 days old)
    if (Date.now() - startTime < TIME_BUDGET_MS) {
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const { count, error } = await supabaseAdmin
        .from('market_analytics')
        .delete({ count: 'exact' })
        .lt('computed_at', sevenDaysAgo);
      if (error) errors.push(`Analytics delete: ${error.message}`);
      results.analytics_deleted = count ?? 0;
    }

    // 4. Delete old wallet_signals (> 14 days)
    if (Date.now() - startTime < TIME_BUDGET_MS) {
      const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();
      let signalsDeleted = 0;
      for (let i = 0; i < 5; i++) {
        if (Date.now() - startTime > TIME_BUDGET_MS) {
          errors.push('Time budget reached during signals cleanup');
          break;
        }
        const { count, error } = await supabaseAdmin
          .from('wallet_signals')
          .delete({ count: 'exact' })
          .lt('computed_at', fourteenDaysAgo)
          .limit(5000);
        if (error) { errors.push(`Signals delete: ${error.message}`); break; }
        signalsDeleted += count ?? 0;
        if ((count ?? 0) < 5000) break;
      }
      results.signals_deleted = signalsDeleted;
    }

    const retryCount = getRetryCount(req);
    if (shouldRetry(errors)) {
      scheduleRetry(req, retryCount);
    }

    return NextResponse.json({
      success: true,
      ...results,
      duration_ms: Date.now() - startTime,
      retryCount,
      errors: errors.slice(0, 10),
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 },
    );
  }
}
