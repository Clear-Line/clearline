import { supabaseAdmin } from './supabase';

export interface UserSubscription {
  isActive: boolean;
  isFounding: boolean;
  status: string;
  userId: number;
}

export async function getUserSubscription(clerkId: string): Promise<UserSubscription | null> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, subscription_status')
    .eq('clerk_id', clerkId)
    .single();

  if (error || !data) return null;

  const status = data.subscription_status as string;
  const isFounding = data.id <= 100;
  const isActive = status === 'active' || status === 'founding';

  return {
    isActive,
    isFounding,
    status,
    userId: data.id,
  };
}
