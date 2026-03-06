import { NextResponse } from 'next/server';
import { detectArbitrage } from '@/lib/analysis/correlation-engine';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET() {
  try {
    const result = await detectArbitrage();
    return NextResponse.json({
      opportunities: result.opportunities,
      count: result.opportunities.length,
      errors: result.errors.slice(0, 5),
    });
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 },
    );
  }
}
