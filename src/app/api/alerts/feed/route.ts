import { NextRequest, NextResponse } from 'next/server';
import { scanForAlerts, AlertType } from '@/lib/analysis/alert-scanner';

export const runtime = 'nodejs';
export const maxDuration = 60;

const VALID_TYPES = new Set<AlertType>([
  'VOLUME_EXPLOSION',
  'SMART_MONEY_ENTRY',
  'RANGE_BREAKOUT',
  'MANIPULATION_WARNING',
]);

export async function GET(req: NextRequest) {
  try {
    const typeParam = req.nextUrl.searchParams.get('type') as AlertType | null;
    const result = await scanForAlerts();

    let alerts = result.alerts;
    if (typeParam && VALID_TYPES.has(typeParam)) {
      alerts = alerts.filter((a) => a.type === typeParam);
    }

    return NextResponse.json({
      alerts,
      count: alerts.length,
      scan_time: result.scan_time,
      telemetry: result.telemetry,
    });
  } catch (err) {
    return NextResponse.json(
      { error: String(err), alerts: [], count: 0 },
      { status: 500 },
    );
  }
}
