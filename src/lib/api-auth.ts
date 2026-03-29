import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { getUserSubscription } from './subscription';

/**
 * Require an authenticated user with an active subscription.
 * Returns a 401/403 NextResponse if the user fails the check, or null if OK.
 */
export async function requireSubscription(): Promise<NextResponse | null> {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const sub = await getUserSubscription(userId);

  if (!sub || !sub.isActive) {
    return NextResponse.json({ error: 'Active subscription required' }, { status: 403 });
  }

  return null;
}
