/**
 * Polymarket Data API client for the Next.js app.
 * Thin wrapper — just the endpoints needed by API routes.
 */

const DATA_API = 'https://data-api.polymarket.com';

export interface PolymarketTrade {
  proxyWallet: string;
  timestamp: number;
  conditionId: string;
  type: string;
  size: number;
  usdcSize: number;
  transactionHash: string;
  price: number;
  asset: string;
  side: 'BUY' | 'SELL';
  outcomeIndex: number;
  title: string;
  slug: string;
  outcome: string;
  name?: string;
  pseudonym?: string;
}

export async function fetchWalletActivity(
  walletAddress: string,
  conditionId?: string,
): Promise<PolymarketTrade[]> {
  const params = new URLSearchParams({
    user: walletAddress,
    type: 'TRADE',
    sortBy: 'TIMESTAMP',
    sortDirection: 'DESC',
  });
  if (conditionId) params.set('market', conditionId);

  const res = await fetch(`${DATA_API}/activity?${params}`);
  if (!res.ok) throw new Error(`Data /activity failed: ${res.status}`);
  return res.json();
}
