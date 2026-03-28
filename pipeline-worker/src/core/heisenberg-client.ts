/**
 * Heisenberg Prediction Market Intelligence API client.
 *
 * Thin wrapper — all endpoints use one base URL, switching agent_id.
 * Graceful failure: returns null on error so the scanner can fall back to local data.
 *
 * Agent IDs we use:
 *   584 — Falcon Score Leaderboard (top-ranked wallets)
 *   581 — Wallet 360 (deep wallet metrics)
 */

// ─── Types ───

export interface FalconWallet {
  wallet_address: string;
  falcon_score: number;
  total_trades: number;
  win_rate: number;
  pnl_usdc: number;
  avg_position_size: number;
  markets_traded: number;
}

export interface Wallet360 {
  wallet_address: string;
  falcon_score: number;
  win_rate: number;
  total_pnl: number;
  total_trades: number;
  avg_trade_size: number;
  max_drawdown: number;
  sharpe_ratio: number;
  markets_traded: number;
}

// ─── Constants ───

const HEISENBERG_BASE_URL = process.env.HEISENBERG_BASE_URL || 'https://api.heisenberg.so/v1';
const API_KEY = process.env.HEISENBERG_API_KEY || '';
const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1_000;

// ─── Rate limiter (simple token bucket) ───

let tokens = 10;
const maxTokens = 10;
const refillRate = 10; // tokens per second

setInterval(() => {
  tokens = Math.min(maxTokens, tokens + refillRate);
}, 1_000);

async function waitForToken(): Promise<void> {
  while (tokens <= 0) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  tokens--;
}

// ─── Core query function ───

export async function queryAgent<T = unknown>(
  agentId: number,
  params: Record<string, string | number> = {},
): Promise<T[] | null> {
  if (!API_KEY) {
    console.warn('[Heisenberg] No API key configured (HEISENBERG_API_KEY). Skipping.');
    return null;
  }

  const url = new URL(`${HEISENBERG_BASE_URL}/query`);
  const body = {
    agent_id: agentId,
    ...params,
  };

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      await waitForToken();

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.status === 429) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        console.warn(`[Heisenberg] Rate limited (429). Retrying in ${backoff}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.warn(`[Heisenberg] Agent ${agentId} returned ${response.status}: ${text.slice(0, 200)}`);
        if (response.status >= 500 && attempt < MAX_RETRIES - 1) {
          const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, backoff));
          continue;
        }
        return null;
      }

      const json = await response.json();
      // The API may return { data: [...] } or just [...]
      return (Array.isArray(json) ? json : json.data ?? json.results ?? []) as T[];
    } catch (err) {
      if (attempt < MAX_RETRIES - 1) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        console.warn(`[Heisenberg] Agent ${agentId} attempt ${attempt + 1} failed: ${err instanceof Error ? err.message : err}. Retrying in ${backoff}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }
      console.error(`[Heisenberg] Agent ${agentId} failed after ${MAX_RETRIES} attempts:`, err instanceof Error ? err.message : err);
      return null;
    }
  }

  return null;
}

// ─── Convenience functions ───

export async function getFalconLeaderboard(limit = 200): Promise<FalconWallet[] | null> {
  return queryAgent<FalconWallet>(584, { limit });
}

export async function getWallet360(walletAddress: string): Promise<Wallet360[] | null> {
  return queryAgent<Wallet360>(581, { wallet_address: walletAddress });
}
