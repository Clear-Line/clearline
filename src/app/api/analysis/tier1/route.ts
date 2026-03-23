import { NextRequest, NextResponse } from 'next/server';
import { computeTier1Signals } from '@/lib/analysis/tier1-signals';
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
    const result = await computeTier1Signals();
    const retryCount = getRetryCount(req);

    if (shouldRetry(result.errors)) {
      scheduleRetry(req, retryCount);
    }

    return NextResponse.json({
      success: true,
      computed: result.computed,
      flagged: result.flagged,
      telemetry: result.telemetry,
      retryCount,
      errors: result.errors,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 },
    );
  }
}
