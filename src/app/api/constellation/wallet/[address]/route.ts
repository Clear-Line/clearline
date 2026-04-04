import { NextResponse } from 'next/server';
import { bq } from '@/lib/bigquery';
import { requireSubscription } from '@/lib/api-auth';

export const runtime = 'nodejs';

const projectId = process.env.GCP_PROJECT_ID!;
const dataset = process.env.BQ_DATASET || 'polymarket';

interface PositionRow {
  market_id: string;
  title: string;
  category: string;
  outcome: string;
  buy_volume: number;
  sell_volume: number;
  avg_buy_price: number;
  trade_count: number;
}

/**
 * GET /api/constellation/wallet/[address] — returns all active market positions
 * for a wallet address, used for map highlighting.
 * Requires auth (Advisor mode).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ address: string }> }
) {
  const authError = await requireSubscription();
  if (authError) return authError;

  const { address } = await params;

  const fq = (table: string) => `\`${projectId}.${dataset}.${table}\``;

  const { data, error } = await bq.rawQuery<PositionRow>(`
    SELECT
      wtp.market_id,
      m.question AS title,
      m.category,
      wtp.outcome,
      wtp.buy_volume,
      wtp.sell_volume,
      wtp.avg_buy_price,
      (wtp.buy_count + wtp.sell_count) AS trade_count
    FROM ${fq('wallet_trade_positions')} wtp
    JOIN ${fq('markets')} m ON m.condition_id = wtp.market_id
    WHERE wtp.wallet_address = @address
      AND m.is_active = true AND m.is_resolved = false
  `, { address });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    address,
    positions: (data ?? []).map((p) => ({
      marketId: p.market_id,
      title: p.title,
      category: p.category ?? 'other',
      outcome: p.outcome,
      buyVolume: p.buy_volume,
      sellVolume: p.sell_volume,
      avgBuyPrice: p.avg_buy_price,
      tradeCount: p.trade_count,
    })),
    count: data?.length ?? 0,
  });
}
