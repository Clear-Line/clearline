import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { requireSubscription } from '@/lib/api-auth';

export const runtime = 'nodejs';

/**
 * GET /api/auth/discord/start
 *
 * Kicks off the Discord OAuth2 flow. We only ask for the `identify` scope
 * because all we need is the stable snowflake used for @mentions in the
 * shared #alerts channel.
 */
export async function GET() {
  const authError = await requireSubscription();
  if (authError) return authError;

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirectUri = process.env.DISCORD_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: 'Discord OAuth is not configured' },
      { status: 500 },
    );
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify',
    // Clerk user id doubles as the CSRF guard value — verified in the callback.
    state: userId,
    prompt: 'consent',
  });

  const url = `https://discord.com/api/oauth2/authorize?${params.toString()}`;
  return NextResponse.redirect(url);
}
