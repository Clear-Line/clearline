import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('stripe_customer_id')
    .eq('clerk_id', userId)
    .single();

  if (!user?.stripe_customer_id) {
    return NextResponse.json({ error: 'No billing account found' }, { status: 404 });
  }

  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripe_customer_id,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/terminal`,
  });

  return NextResponse.json({ url: session.url });
}
