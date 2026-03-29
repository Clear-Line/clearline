import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Look up user in Supabase
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('id, subscription_status, stripe_customer_id')
    .eq('clerk_id', userId)
    .single();

  if (error || !user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

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
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
    success_url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/terminal?checkout=success`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/pricing?checkout=canceled`,
  });

  return NextResponse.json({ url: session.url });
}
