import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { requireSubscription } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabase';
import { ensureUserRecord } from '@/lib/users';
import { isValidPolygonAddress, normalizeAddress } from '@/lib/wallet-address';

export const runtime = 'nodejs';

// ─── DELETE — unlink a wallet from the current user ───
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const authError = await requireSubscription();
  if (authError) return authError;

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { address: rawAddress } = await params;
  if (!isValidPolygonAddress(rawAddress)) {
    return NextResponse.json({ error: 'Invalid Polygon address' }, { status: 400 });
  }

  const address = normalizeAddress(rawAddress);
  const user = await ensureUserRecord(userId);

  const { error } = await supabaseAdmin
    .from('user_wallets')
    .delete()
    .eq('user_id', user.id)
    .eq('wallet_address', address);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
