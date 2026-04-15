import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { getAppUrl } from '@/lib/app-url';
import { getStripe } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabase';
import { ensureUserRecord } from '@/lib/users';

export const runtime = 'nodejs';

export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const user = await ensureUserRecord(userId);

  // Founding members already have access
  if (user.subscription_status === 'founding' || user.subscription_status === 'active') {
    return NextResponse.json({ error: 'You already have access' }, { status: 400 });
  }

  // Create or reuse Stripe customer
  const stripe = getStripe();
  let customerId = user.stripe_customer_id as string | null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      metadata: { clerk_id: userId, supabase_user_id: String(user.id) },
    });
    customerId = customer.id;

    await supabaseAdmin
      .from('users')
      .update({ stripe_customer_id: customerId })
      .eq('clerk_id', userId);
  }

  // Create checkout session
  const appUrl = await getAppUrl();
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
    success_url: `${appUrl}/explore?checkout=success`,
    cancel_url: `${appUrl}/pricing?checkout=canceled`,
  });

  return NextResponse.json({ url: session.url });
}
