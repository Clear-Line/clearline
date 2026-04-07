import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { bq } from '@/lib/bigquery';
import { supabaseAdmin } from '@/lib/supabase';
import { requireSubscription } from '@/lib/api-auth';
import { ensureUserRecord } from '@/lib/users';

export const runtime = 'nodejs';
export const revalidate = 60;

const projectId = process.env.GCP_PROJECT_ID!;
const dataset = process.env.BQ_DATASET || 'polymarket';

interface PositionRow {
  market_id: string;
  title: string;
  category: string | null;
  outcome: string | null;
  buy_volume: number;
  sell_volume: number;
  avg_buy_price: number;
  buy_count: number;
  sell_count: number;
  current_price: number | null;
  wallet_address: string;
}

interface AggregatedPosition {
  marketId: string;
  title: string;
  category: string;
  side: 'BUY' | 'SELL';
  invested: number;
  avgPrice: number;
  currentPrice: number;
  currentValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  trades: number;
  wallets: string[];
}

/**
 * GET /api/user/positions
 *
 * Returns the aggregated active Polymarket positions for every wallet the
 * signed-in user has linked. Used by the constellation map to draw the
 * green-ring overlay and the floating portfolio HUD.
 */
export async function GET() {
  const authError = await requireSubscription();
  if (authError) return authError;

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const user = await ensureUserRecord(userId);

  // ─── Read linked wallets from Supabase ───
  const { data: walletRows, error: wErr } = await supabaseAdmin
    .from('user_wallets')
    .select('wallet_address')
    .eq('user_id', user.id);

  if (wErr) {
    return NextResponse.json({ error: wErr.message }, { status: 500 });
  }

  const addresses = (walletRows ?? []).map((r) => r.wallet_address as string);

  if (addresses.length === 0) {
    return NextResponse.json({
      wallets: [],
      positions: [],
      totals: { exposure: 0, unrealizedPnl: 0, held: 0 },
    });
  }

  // ─── Query BigQuery for all positions across every linked wallet ───
  const fq = (table: string) => `\`${projectId}.${dataset}.${table}\``;

  const { data: rows, error: qErr } = await bq.rawQuery<PositionRow>(
    `
    WITH latest_cards AS (
      SELECT *
      FROM (
        SELECT
          market_id,
          current_price,
          ROW_NUMBER() OVER (PARTITION BY market_id ORDER BY computed_at DESC) AS rn
        FROM ${fq('market_cards')}
      )
      WHERE rn = 1
    )
    SELECT
      wtp.market_id,
      m.question AS title,
      m.category,
      wtp.outcome,
      wtp.buy_volume,
      wtp.sell_volume,
      wtp.avg_buy_price,
      wtp.buy_count,
      wtp.sell_count,
      lc.current_price,
      wtp.wallet_address
    FROM ${fq('wallet_trade_positions')} wtp
    JOIN ${fq('markets')} m ON m.condition_id = wtp.market_id
    LEFT JOIN latest_cards lc ON lc.market_id = wtp.market_id
    WHERE wtp.wallet_address IN UNNEST(@addresses)
      AND m.is_active = true
      AND m.is_resolved = false
    `,
    { addresses },
  );

  if (qErr) {
    return NextResponse.json({ error: qErr.message }, { status: 500 });
  }

  // ─── Aggregate per market (dedupe across wallets) ───
  const agg = new Map<
    string,
    {
      title: string;
      category: string;
      buyVolumeTotal: number;
      sellVolumeTotal: number;
      weightedAvgBuyNumerator: number; // sum(avg_buy_price * buy_volume)
      weightedAvgBuyDenom: number;     // sum(buy_volume)
      buyCount: number;
      sellCount: number;
      currentPrice: number;
      wallets: Set<string>;
    }
  >();

  for (const row of rows ?? []) {
    const existing = agg.get(row.market_id) ?? {
      title: row.title || row.market_id.slice(0, 16) + '...',
      category: row.category || 'other',
      buyVolumeTotal: 0,
      sellVolumeTotal: 0,
      weightedAvgBuyNumerator: 0,
      weightedAvgBuyDenom: 0,
      buyCount: 0,
      sellCount: 0,
      currentPrice: Number(row.current_price ?? 0),
      wallets: new Set<string>(),
    };

    const buyVol = Number(row.buy_volume ?? 0);
    const sellVol = Number(row.sell_volume ?? 0);
    const avgBuy = Number(row.avg_buy_price ?? 0);

    existing.buyVolumeTotal += buyVol;
    existing.sellVolumeTotal += sellVol;
    existing.buyCount += Number(row.buy_count ?? 0);
    existing.sellCount += Number(row.sell_count ?? 0);

    // Weighted avg across wallets: weight by each wallet's buy volume
    if (avgBuy > 0 && buyVol > 0) {
      existing.weightedAvgBuyNumerator += avgBuy * buyVol;
      existing.weightedAvgBuyDenom += buyVol;
    }

    existing.wallets.add(row.wallet_address);
    agg.set(row.market_id, existing);
  }

  // ─── Build output positions ───
  const positions: AggregatedPosition[] = [];
  let totalExposure = 0;
  let totalUnrealizedPnl = 0;

  for (const [marketId, p] of agg) {
    const netInvested = p.buyVolumeTotal - p.sellVolumeTotal;
    const avgPrice =
      p.weightedAvgBuyDenom > 0 ? p.weightedAvgBuyNumerator / p.weightedAvgBuyDenom : 0;

    // Shares held ≈ buyVolume / avgBuyPrice; current value = shares * currentPrice
    const currentValue =
      avgPrice > 0 ? (p.buyVolumeTotal / avgPrice) * p.currentPrice - p.sellVolumeTotal : 0;
    const unrealizedPnl = currentValue - netInvested;
    const unrealizedPnlPct = netInvested > 0 ? (unrealizedPnl / netInvested) * 100 : 0;

    // Skip fully-exited positions
    if (netInvested <= 0.5) continue;

    positions.push({
      marketId,
      title: p.title,
      category: p.category,
      side: p.buyVolumeTotal >= p.sellVolumeTotal ? 'BUY' : 'SELL',
      invested: Math.round(netInvested * 100) / 100,
      avgPrice: Math.round(avgPrice * 10000) / 10000,
      currentPrice: Math.round(p.currentPrice * 10000) / 10000,
      currentValue: Math.round(currentValue * 100) / 100,
      unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
      unrealizedPnlPct: Math.round(unrealizedPnlPct * 10) / 10,
      trades: p.buyCount + p.sellCount,
      wallets: [...p.wallets],
    });

    totalExposure += netInvested;
    totalUnrealizedPnl += unrealizedPnl;
  }

  positions.sort((a, b) => b.invested - a.invested);

  return NextResponse.json({
    wallets: addresses,
    positions,
    totals: {
      exposure: Math.round(totalExposure * 100) / 100,
      unrealizedPnl: Math.round(totalUnrealizedPnl * 100) / 100,
      held: positions.length,
    },
  });
}
