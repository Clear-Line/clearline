import { NextRequest, NextResponse } from 'next/server';
import { detectAndFlagMoves } from '@/lib/analysis/move-detector';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await detectAndFlagMoves();
    return NextResponse.json({
      success: true,
      detected: result.detected,
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
