import { ensureUserRecord } from './users';

export interface UserSubscription {
  isActive: boolean;
  isFounding: boolean;
  status: string;
  userId: number;
}

export async function getUserSubscription(clerkId: string): Promise<UserSubscription | null> {
  const user = await ensureUserRecord(clerkId);
  const status = user.subscription_status;
  const isFounding = user.id <= 100 || status === 'founding';
  const isActive = status === 'active' || status === 'founding';

  return {
    isActive,
    isFounding,
    status,
    userId: user.id,
  };
}
