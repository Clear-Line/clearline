import { NextRequest, NextResponse } from 'next/server';
import { Webhook } from 'svix';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;
  if (!WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  const svix_id = req.headers.get('svix-id');
  const svix_timestamp = req.headers.get('svix-timestamp');
  const svix_signature = req.headers.get('svix-signature');

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return NextResponse.json({ error: 'Missing svix headers' }, { status: 400 });
  }

  const body = await req.text();

  let event: { type: string; data: Record<string, unknown> };
  try {
    const wh = new Webhook(WEBHOOK_SECRET);
    event = wh.verify(body, {
      'svix-id': svix_id,
      'svix-timestamp': svix_timestamp,
      'svix-signature': svix_signature,
    }) as typeof event;
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (event.type === 'user.created') {
    const clerkId = event.data.id as string;
    const email = (event.data.email_addresses as { email_address: string }[])?.[0]?.email_address ?? null;

    // Insert user — sequential id determines founding status
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .insert({ clerk_id: clerkId, email })
      .select('id')
      .single();

    if (error) {
      console.error('[Clerk Webhook] Insert error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // First 100 users get founding status (lifetime free)
    if (user && user.id <= 100) {
      await supabaseAdmin
        .from('users')
        .update({ subscription_status: 'founding', plan: 'founding' })
        .eq('clerk_id', clerkId);
    }

    console.log(`[Clerk Webhook] User created: ${clerkId}, id: ${user?.id}, founding: ${user && user.id <= 100}`);
  }

  return NextResponse.json({ received: true });
}
