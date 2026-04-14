import { NextRequest, NextResponse } from 'next/server';
import { bq } from '@/lib/bigquery';
import {
  MarketWalletApiRow,
  toWalletRow,
  sortWalletRows,
} from '@/components/explore/lib/wallets';

export const runtime = 'nodejs';

const projectId = process.env.GCP_PROJECT_ID!;
const dataset = process.env.BQ_DATASET || 'polymarket';

/**
 * GET /api/markets/[id]/wallets — wallets active in a single market.
 * PUBLIC — mirrors /api/constellation (the Wallets tab renders on the public /explore map).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'Missing market id' }, { status: 400 });
  }

  const fq = (table: string) => `\`${projectId}.${dataset}.${table}\``;

  const { data, error } = await bq.rawQuery<MarketWalletApiRow>(
    `
      SELECT
        wtp.wallet_address,
        wtp.buy_volume,
        wtp.sell_volume,
        wtp.outcome,
        w.accuracy_score,
        w.total_markets_traded,
        w.username
      FROM ${fq('wallet_trade_positions')} wtp
      LEFT JOIN ${fq('wallets')} w ON w.address = wtp.wallet_address
      WHERE wtp.market_id = @market_id
        AND (wtp.buy_volume + wtp.sell_volume) > 0
      ORDER BY (wtp.buy_volume + wtp.sell_volume) DESC
      LIMIT 50
    `,
    { market_id: id },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const wallets = sortWalletRows((data ?? []).map(toWalletRow));

  return NextResponse.json(
    { wallets },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    },
  );
}
