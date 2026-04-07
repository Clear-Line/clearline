import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { requireSubscription } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabase';
import { ensureUserRecord } from '@/lib/users';

export const runtime = 'nodejs';

// ─── GET — list the current user's watchlisted market ids ───
export async function GET() {
  const authError = await requireSubscription();
  if (authError) return authError;

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const user = await ensureUserRecord(userId);

  const { data, error } = await supabaseAdmin
    .from('user_market_watchlist')
    .select('market_id')
    .eq('user_id', user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    marketIds: (data ?? []).map((r) => r.market_id as string),
  });
}

// ─── POST — star a market ───
export async function POST(request: Request) {
  const authError = await requireSubscription();
  if (authError) return authError;

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: { marketId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const marketId = typeof body.marketId === 'string' ? body.marketId.trim() : '';
  if (!marketId || marketId.length > 128) {
    return NextResponse.json({ error: 'Invalid marketId' }, { status: 400 });
  }

  const user = await ensureUserRecord(userId);

  const { error } = await supabaseAdmin
    .from('user_market_watchlist')
    .insert({ user_id: user.id, market_id: marketId });

  if (error) {
    // Unique-constraint collision — treat as idempotent success
    if (error.code !== '23505') {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
