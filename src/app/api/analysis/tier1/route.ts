import { NextRequest, NextResponse } from 'next/server';
import { computeTier1Signals } from '@/lib/analysis/tier1-signals';

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
    return NextResponse.json({
      success: true,
      computed: result.computed,
      flagged: result.flagged,
      errors: result.errors,
      telemetry: result.telemetry,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 },
    );
  }
}
