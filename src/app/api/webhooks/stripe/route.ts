import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');

  if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Missing signature or secret' }, { status: 400 });
  }

  const stripe = getStripe();
  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const customerId = (event.data.object as { customer?: string }).customer;

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as { customer: string; subscription: string };
      await supabaseAdmin
        .from('users')
        .update({
          subscription_status: 'active',
          plan: 'pro',
          stripe_subscription_id: session.subscription,
          updated_at: new Date().toISOString(),
        })
        .eq('stripe_customer_id', session.customer);
      break;
    }

    case 'customer.subscription.deleted': {
      if (customerId) {
        await supabaseAdmin
          .from('users')
          .update({
            subscription_status: 'canceled',
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_customer_id', customerId);
      }
      break;
    }

    case 'invoice.payment_failed': {
      if (customerId) {
        await supabaseAdmin
          .from('users')
          .update({
            subscription_status: 'past_due',
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_customer_id', customerId);
      }
      break;
    }
  }

  return NextResponse.json({ received: true });
}
