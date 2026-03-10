import { NextRequest, NextResponse } from 'next/server';
import { pollTrades } from '@/lib/pipeline/trade-monitor';
import { shouldRetry, scheduleRetry, getRetryCount } from '@/lib/pipeline/self-retry';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await pollTrades();
    const retryCount = getRetryCount(req);

    if (shouldRetry(result.errors)) {
      scheduleRetry(req, retryCount);
    }

    // Summarize errors by type for observability
    const errorSummary: Record<string, number> = {};
    for (const e of result.errors) {
      const key = e.includes('429') ? '429_rate_limited'
        : e.includes('Time budget') ? 'time_budget'
        : e.includes('failed') ? 'api_error'
        : 'other';
      errorSummary[key] = (errorSummary[key] || 0) + 1;
    }

    return NextResponse.json({
      success: true,
      inserted: result.inserted,
      skipped: result.skipped,
      telemetry: result.telemetry,
      retryCount,
      errorSummary,
      errors: result.errors.slice(0, 10),
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 },
    );
  }
}
