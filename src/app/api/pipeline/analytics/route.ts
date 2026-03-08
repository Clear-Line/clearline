import { NextRequest, NextResponse } from 'next/server';
import { computeAnalytics } from '@/lib/analysis/analytics-engine';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await computeAnalytics();
    return NextResponse.json({
      success: true,
      computed: result.computed,
      publishable: result.publishable,
      telemetry: result.telemetry,
      errors: result.errors.slice(0, 10),
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 },
    );
  }
}
