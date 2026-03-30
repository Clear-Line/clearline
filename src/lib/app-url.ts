import { headers } from 'next/headers';

export async function getAppUrl(): Promise<string> {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL;
  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, '');
  }

  const headerStore = await headers();
  const host =
    headerStore.get('x-forwarded-host') ??
    headerStore.get('host') ??
    process.env.VERCEL_URL ??
    'localhost:3000';

  const protocol =
    headerStore.get('x-forwarded-proto') ??
    (host.includes('localhost') ? 'http' : 'https');

  return `${protocol}://${host}`;
}
