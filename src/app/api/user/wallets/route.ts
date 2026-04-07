import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { requireSubscription } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabase';
import { ensureUserRecord } from '@/lib/users';
import { isValidPolygonAddress, normalizeAddress } from '@/lib/wallet-address';

export const runtime = 'nodejs';

interface UserWalletRow {
  id: number;
  wallet_address: string;
  label: string | null;
  created_at: string;
}

function serialize(row: UserWalletRow) {
  return {
    id: row.id,
    address: row.wallet_address,
    label: row.label,
    createdAt: row.created_at,
  };
}

async function listWallets(userId: number) {
  const { data, error } = await supabaseAdmin
    .from('user_wallets')
    .select('id, wallet_address, label, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []).map(serialize);
}

// ─── GET — list current user's linked wallets ───
export async function GET() {
  const authError = await requireSubscription();
  if (authError) return authError;

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const user = await ensureUserRecord(userId);
  const wallets = await listWallets(user.id);
  return NextResponse.json({ wallets });
}

// ─── POST — link a new wallet ───
export async function POST(request: Request) {
  const authError = await requireSubscription();
  if (authError) return authError;

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: { address?: unknown; label?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const rawAddress = typeof body.address === 'string' ? body.address.trim() : '';
  if (!isValidPolygonAddress(rawAddress)) {
    return NextResponse.json(
      { error: 'Invalid Polygon address. Expected a 0x-prefixed 40-character hex string.' },
      { status: 400 },
    );
  }

  const address = normalizeAddress(rawAddress);
  const label =
    typeof body.label === 'string' && body.label.trim().length > 0
      ? body.label.trim().slice(0, 64)
      : null;

  const user = await ensureUserRecord(userId);

  const { error } = await supabaseAdmin
    .from('user_wallets')
    .insert({ user_id: user.id, wallet_address: address, label });

  if (error) {
    // Unique-constraint collision — treat as idempotent success
    if (error.code !== '23505') {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  const wallets = await listWallets(user.id);
  return NextResponse.json({ wallets });
}
