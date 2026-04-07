import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { requireSubscription } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabase';
import { ensureUserRecord } from '@/lib/users';

export const runtime = 'nodejs';

// ─── DELETE — unstar a market ───
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ marketId: string }> },
) {
  const authError = await requireSubscription();
  if (authError) return authError;

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { marketId: rawMarketId } = await params;
  const marketId = decodeURIComponent(rawMarketId).trim();
  if (!marketId || marketId.length > 128) {
    return NextResponse.json({ error: 'Invalid marketId' }, { status: 400 });
  }

  const user = await ensureUserRecord(userId);

  const { error } = await supabaseAdmin
    .from('user_market_watchlist')
    .delete()
    .eq('user_id', user.id)
    .eq('market_id', marketId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
