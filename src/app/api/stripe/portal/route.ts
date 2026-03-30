import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { getAppUrl } from '@/lib/app-url';
import { getStripe } from '@/lib/stripe';
import { ensureUserRecord } from '@/lib/users';

export const runtime = 'nodejs';

export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const user = await ensureUserRecord(userId);
  if (!user?.stripe_customer_id) {
    return NextResponse.json({ error: 'No billing account found' }, { status: 404 });
  }

  const stripe = getStripe();
  const appUrl = await getAppUrl();
  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripe_customer_id,
    return_url: `${appUrl}/terminal`,
  });

  return NextResponse.json({ url: session.url });
}
