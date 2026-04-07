import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { requireSubscription } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabase';
import { ensureUserRecord } from '@/lib/users';

export const runtime = 'nodejs';

interface DiscordTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
}

interface DiscordIdentityResponse {
  id?: string;
  username?: string;
  global_name?: string;
}

function settingsRedirect(baseUrl: string, query: string) {
  const url = new URL('/settings', baseUrl);
  url.search = query;
  return NextResponse.redirect(url);
}

/**
 * GET /api/auth/discord/callback
 *
 * Exchanges the OAuth2 `code` for an access token, calls `/users/@me` once to
 * capture the Discord snowflake + username, stores it in `user_discord`, then
 * discards the access token. We never need it again — @mentions only require
 * the stable snowflake.
 */
export async function GET(request: Request) {
  const authError = await requireSubscription();
  if (authError) return authError;

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  if (!code) {
    return settingsRedirect(origin, 'discord=missing_code');
  }

  // CSRF guard: state must match the Clerk userId we set in /start
  if (state !== userId) {
    return settingsRedirect(origin, 'discord=state_mismatch');
  }

  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const redirectUri = process.env.DISCORD_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return settingsRedirect(origin, 'discord=not_configured');
  }

  // ─── Exchange code → access token ───
  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    return settingsRedirect(origin, 'discord=token_exchange_failed');
  }

  const tokenData: DiscordTokenResponse = await tokenRes.json();
  if (!tokenData.access_token) {
    return settingsRedirect(origin, 'discord=no_access_token');
  }

  // ─── Fetch identity ───
  const identityRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!identityRes.ok) {
    return settingsRedirect(origin, 'discord=identity_failed');
  }

  const identity: DiscordIdentityResponse = await identityRes.json();
  if (!identity.id) {
    return settingsRedirect(origin, 'discord=no_identity');
  }

  // ─── Upsert into user_discord ───
  const user = await ensureUserRecord(userId);

  const { error } = await supabaseAdmin
    .from('user_discord')
    .upsert(
      {
        user_id: user.id,
        discord_user_id: identity.id,
        discord_username: identity.global_name || identity.username || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );

  if (error) {
    return settingsRedirect(origin, `discord=supabase_error`);
  }

  return settingsRedirect(origin, 'discord=linked');
}
