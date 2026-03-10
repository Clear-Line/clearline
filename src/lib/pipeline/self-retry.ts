/**
 * Self-retry helper for pipeline API routes.
 *
 * When a pipeline function hits its time budget and returns "Time budget reached",
 * the route fires another request to itself using Next.js `after()` so the
 * remaining work gets processed immediately instead of waiting for the next cron cycle.
 *
 * Uses `after()` which runs code after the response is sent — Vercel keeps the
 * function alive for this purpose (supported in Next.js 15+).
 */

import { after } from 'next/server';

const MAX_RETRIES = 5; // safety cap to prevent infinite loops

export function shouldRetry(errors: string[]): boolean {
  // Retry on time budget exhaustion
  if (errors.some((e) => e.includes('Time budget reached'))) return true;
  // Retry if high rate of 429 errors (>= 3 rate-limited markets)
  const rateLimitCount = errors.filter((e) => e.includes('429') || e.includes('rate')).length;
  if (rateLimitCount >= 3) return true;
  return false;
}

/**
 * Schedule a retry request to the same endpoint using Next.js `after()`.
 * The retry runs after the current response is sent to the client.
 * Pass `X-Retry-Count` header to track depth and prevent runaway loops.
 */
export function scheduleRetry(req: Request, retryCount: number): void {
  if (retryCount >= MAX_RETRIES) return;

  const url = new URL(req.url);
  const authHeader = req.headers.get('authorization');

  const headers: Record<string, string> = {
    'X-Retry-Count': String(retryCount + 1),
  };
  if (authHeader) headers['Authorization'] = authHeader;

  after(async () => {
    try {
      await fetch(url.toString(), { method: 'GET', headers });
    } catch {
      // Silently ignore — if the retry fails it'll pick up next cron cycle
    }
  });
}

export function getRetryCount(req: Request): number {
  return parseInt(req.headers.get('x-retry-count') || '0', 10) || 0;
}
