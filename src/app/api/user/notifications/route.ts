import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { requireSubscription } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabase';
import { ensureUserRecord } from '@/lib/users';

export const runtime = 'nodejs';

interface DiscordSettingsRow {
  discord_user_id: string;
  discord_username: string | null;
  notifications_enabled: boolean;
  min_price_move: number;
  window_hours: number;
  linked_at: string;
}

function serialize(row: DiscordSettingsRow | null) {
  if (!row) return null;
  return {
    discordUserId: row.discord_user_id,
    discordUsername: row.discord_username,
    notificationsEnabled: row.notifications_enabled,
    minPriceMove: Number(row.min_price_move),
    windowHours: row.window_hours,
    linkedAt: row.linked_at,
  };
}

// ─── GET — current Discord + notification settings (null if not linked) ───
export async function GET() {
  const authError = await requireSubscription();
  if (authError) return authError;

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const user = await ensureUserRecord(userId);

  const { data, error } = await supabaseAdmin
    .from('user_discord')
    .select(
      'discord_user_id, discord_username, notifications_enabled, min_price_move, window_hours, linked_at',
    )
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ settings: serialize(data as DiscordSettingsRow | null) });
}

// ─── PUT — update notification settings ───
export async function PUT(request: Request) {
  const authError = await requireSubscription();
  if (authError) return authError;

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: {
    notificationsEnabled?: unknown;
    minPriceMove?: unknown;
    windowHours?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof body.notificationsEnabled === 'boolean') {
    patch.notifications_enabled = body.notificationsEnabled;
  }
  if (typeof body.minPriceMove === 'number' && body.minPriceMove > 0 && body.minPriceMove < 1) {
    patch.min_price_move = body.minPriceMove;
  }
  if (
    typeof body.windowHours === 'number' &&
    Number.isInteger(body.windowHours) &&
    body.windowHours >= 1 &&
    body.windowHours <= 168
  ) {
    patch.window_hours = body.windowHours;
  }

  const user = await ensureUserRecord(userId);

  const { data, error } = await supabaseAdmin
    .from('user_discord')
    .update(patch)
    .eq('user_id', user.id)
    .select(
      'discord_user_id, discord_username, notifications_enabled, min_price_move, window_hours, linked_at',
    )
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: 'Discord not linked' }, { status: 404 });
  }

  return NextResponse.json({ settings: serialize(data as DiscordSettingsRow) });
}

// ─── DELETE — unlink Discord ───
export async function DELETE() {
  const authError = await requireSubscription();
  if (authError) return authError;

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const user = await ensureUserRecord(userId);

  const { error } = await supabaseAdmin
    .from('user_discord')
    .delete()
    .eq('user_id', user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
