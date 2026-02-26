import { NextRequest, NextResponse } from 'next/server';
import { pollMarkets } from '@/src/lib/pipeline/market-poller';

export const runtime = 'nodejs';
export const maxDuration = 60; // seconds

export async function GET(req: NextRequest) {
  // Simple auth: check for a secret header to prevent public access
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await pollMarkets();
    return NextResponse.json({
      success: true,
      upserted: result.upserted,
      errors: result.errors.slice(0, 10), // cap error output
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 },
    );
  }
}
