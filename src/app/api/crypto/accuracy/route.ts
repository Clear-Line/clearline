import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json(
    { error: 'Crypto accuracy service is disabled' },
    { status: 410 },
  );
}
