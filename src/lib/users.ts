import { currentUser } from '@clerk/nextjs/server';
import { supabaseAdmin } from './supabase';

export interface AppUserRecord {
  id: number;
  clerk_id: string;
  email: string | null;
  subscription_status: string;
  plan: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}

const APP_USER_COLUMNS = 'id, clerk_id, email, subscription_status, plan, stripe_customer_id, stripe_subscription_id';

async function markFoundingIfEligible(clerkId: string, userId: number) {
  if (userId > 100) {
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from('users')
    .update({ subscription_status: 'founding', plan: 'founding' })
    .eq('clerk_id', clerkId)
    .select(APP_USER_COLUMNS)
    .single();

  if (error) {
    throw error;
  }

  return data as AppUserRecord;
}

export async function ensureUserRecord(clerkId: string): Promise<AppUserRecord> {
  const existingResult = await supabaseAdmin
    .from('users')
    .select(APP_USER_COLUMNS)
    .eq('clerk_id', clerkId)
    .maybeSingle();

  if (existingResult.error) {
    throw existingResult.error;
  }

  if (existingResult.data) {
    return existingResult.data as AppUserRecord;
  }

  const clerkUser = await currentUser();
  if (!clerkUser || clerkUser.id !== clerkId) {
    throw new Error('Unable to load the authenticated Clerk user.');
  }

  const email =
    clerkUser.primaryEmailAddress?.emailAddress ??
    clerkUser.emailAddresses?.[0]?.emailAddress ??
    null;

  const insertResult = await supabaseAdmin
    .from('users')
    .insert({ clerk_id: clerkId, email })
    .select(APP_USER_COLUMNS)
    .single();

  if (insertResult.error) {
    const retryResult = await supabaseAdmin
      .from('users')
      .select(APP_USER_COLUMNS)
      .eq('clerk_id', clerkId)
      .maybeSingle();

    if (retryResult.error || !retryResult.data) {
      throw insertResult.error;
    }

    return retryResult.data as AppUserRecord;
  }

  const insertedUser = insertResult.data as AppUserRecord;
  return (await markFoundingIfEligible(clerkId, insertedUser.id)) ?? insertedUser;
}
