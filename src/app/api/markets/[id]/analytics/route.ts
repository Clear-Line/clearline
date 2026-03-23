import { NextResponse } from 'next/server';
import { bq } from '@/lib/bigquery';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: marketId } = await params;

  // ─── Precomputed analytics from market_analytics table ───

  const { data: analytics } = await bq
    .from('market_analytics')
    .select('*')
    .eq('market_id', marketId)
    .single();

  // ─── Volume profile: computed on-the-fly from trades ───

  const { data: trades } = await bq
    .from('trades')
    .select('price, size_usdc, side')
    .eq('market_id', marketId);

  const volumeProfile = computeVolumeProfile(trades ?? []);

  // ─── Position delta for flagged wallets ───

  const { data: positions } = await bq
    .from('wallet_positions')
    .select('wallet_address, position_size, outcome, snapshot_time')
    .eq('market_id', marketId)
    .order('snapshot_time', { ascending: false })
    .limit(200);

  const positionDeltas = computePositionDeltas(positions ?? []);

  // ─── Smart wallet activity ───

  const { data: smartWallets } = await bq
    .from('wallets')
    .select('address, accuracy_score, accuracy_sample_size, credibility_score, total_pnl_usdc')
    .gt('accuracy_score', 0.60)
    .gt('accuracy_sample_size', 3);

  const smartAddresses = new Set((smartWallets ?? []).map((w) => w.address));

  const { data: smartTrades } = smartAddresses.size > 0
    ? await bq
        .from('trades')
        .select('wallet_address, side, size_usdc, price, timestamp')
        .eq('market_id', marketId)
        .in('wallet_address', [...smartAddresses])
        .order('timestamp', { ascending: false })
        .limit(100)
    : { data: [] };

  const smartWalletActivity = (smartWallets ?? [])
    .filter((w) => (smartTrades ?? []).some((t) => t.wallet_address === w.address))
    .map((w) => {
      const wTrades = (smartTrades ?? []).filter((t) => t.wallet_address === w.address);
      const buyVol = wTrades.filter((t) => t.side === 'BUY').reduce((s, t) => s + Number(t.size_usdc), 0);
      const sellVol = wTrades.filter((t) => t.side === 'SELL').reduce((s, t) => s + Number(t.size_usdc), 0);
      return {
        address: `${w.address.slice(0, 6)}...${w.address.slice(-4)}`,
        fullAddress: w.address,
        accuracy: w.accuracy_score,
        sampleSize: w.accuracy_sample_size,
        credibility: w.credibility_score,
        pnl: w.total_pnl_usdc,
        netDirection: buyVol > sellVol ? 'BUY' : 'SELL',
        buyVolume: buyVol,
        sellVolume: sellVol,
        tradeCount: wTrades.length,
      };
    })
    .sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0));

  // ─── Edge analytics (predictive signals) ───

  const { data: edgeData } = await bq
    .from('market_edge')
    .select('*')
    .eq('market_id', marketId)
    .single();

  // ─── Latest book snapshot for real-time book metrics ───

  const { data: latestBook } = await bq
    .from('market_snapshots')
    .select('spread, book_depth_bid_5c, book_depth_ask_5c, book_imbalance, cost_move_up_5pct, cost_move_down_5pct, timestamp')
    .eq('market_id', marketId)
    .not('spread', 'is', null)
    .order('timestamp', { ascending: false })
    .limit(1)
    .single();

  // ─── Build dataQuality object ───

  const coverageByMetric = analytics?.coverage_by_metric ?? null;
  const isPublishable = analytics?.is_publishable ?? false;
  const coverageScore = analytics?.coverage_score ?? 0;
  const missingDeps = analytics?.missing_dependencies ?? [];

  return NextResponse.json({
    marketId,
    computedAt: analytics?.computed_at ?? null,

    // Data quality metadata
    dataQuality: {
      isPublishable,
      coverageScore,
      computedAt: analytics?.computed_at ?? null,
      missingDependencies: missingDeps,
      coverageByMetric,
    },

    // Price behavior
    momentum: {
      '1h': analytics?.momentum_1h ?? null,
      '6h': analytics?.momentum_6h ?? null,
      '24h': analytics?.momentum_24h ?? null,
    },
    volatility24h: analytics?.volatility_24h ?? null,
    convergenceSpeed: analytics?.convergence_speed ?? null,
    priceReversionRate: analytics?.price_reversion_rate ?? null,

    // Volume / flow
    vwap24h: analytics?.vwap_24h ?? null,
    buySellRatio: analytics?.buy_sell_ratio ?? null,
    smartMoneyFlow: analytics?.smart_money_flow ?? null,

    // Order book
    bookImbalance: analytics?.book_imbalance ?? latestBook?.book_imbalance ?? null,
    liquidityAsymmetry: analytics?.liquidity_asymmetry ?? null,
    spread: latestBook?.spread ?? null,
    bookDepthBid: latestBook?.book_depth_bid_5c ?? null,
    bookDepthAsk: latestBook?.book_depth_ask_5c ?? null,
    costMoveUp5pct: latestBook?.cost_move_up_5pct ?? null,
    costMoveDown5pct: latestBook?.cost_move_down_5pct ?? null,

    // Volume profile
    volumeProfile,

    // Insider / smart money
    smartWalletActivity,
    positionDeltas,

    // Edge analytics (predictive signals)
    edge: edgeData ? {
      score: edgeData.edge_score ?? null,
      direction: edgeData.edge_direction ?? null,
      reasoning: (() => { try { return JSON.parse(edgeData.edge_reasoning ?? '[]'); } catch { return []; } })(),
      computedAt: edgeData.computed_at ?? null,
      signals: {
        smartMoneyLeadLag: {
          value: edgeData.smart_money_lead_lag ?? null,
          direction: edgeData.smart_money_direction ?? null,
          strength: edgeData.smart_money_strength ?? null,
        },
        volumePriceDivergence: {
          value: edgeData.volume_price_divergence ?? null,
          direction: edgeData.volume_price_direction ?? null,
          strength: edgeData.volume_price_strength ?? null,
        },
        whaleAccumulation: {
          value: edgeData.whale_accumulation ?? null,
          direction: edgeData.whale_direction ?? null,
          strength: edgeData.whale_strength ?? null,
        },
        emaMomentum: {
          value: edgeData.ema_momentum ?? null,
          direction: edgeData.ema_direction ?? null,
          strength: edgeData.ema_strength ?? null,
        },
        marketRegime: {
          regime: edgeData.market_regime ?? null,
          confidence: edgeData.regime_confidence ?? null,
        },
      },
      context: {
        snapshotCount: edgeData.snapshot_count ?? 0,
        tradeCount: edgeData.trade_count ?? 0,
        smartTradeCount: edgeData.smart_trade_count ?? 0,
      },
    } : null,
  });
}

// ─── Helpers ───

interface TradeRow {
  price: number;
  size_usdc: number;
  side: string;
}

function computeVolumeProfile(trades: TradeRow[]) {
  if (trades.length === 0) return [];

  // Bucket by price in 5% increments (0.00-0.05, 0.05-0.10, etc.)
  const BUCKET_SIZE = 0.05;
  const buckets = new Map<string, { volume: number; buyVolume: number; sellVolume: number; tradeCount: number }>();

  for (const t of trades) {
    const price = Number(t.price) || 0;
    const usdc = Number(t.size_usdc) || 0;
    if (price <= 0 || price > 1 || usdc <= 0) continue;

    const bucketStart = Math.floor(price / BUCKET_SIZE) * BUCKET_SIZE;
    const bucketEnd = bucketStart + BUCKET_SIZE;
    const key = `${bucketStart.toFixed(2)}-${bucketEnd.toFixed(2)}`;

    const existing = buckets.get(key) ?? { volume: 0, buyVolume: 0, sellVolume: 0, tradeCount: 0 };
    existing.volume += usdc;
    existing.tradeCount++;
    if (t.side === 'BUY') existing.buyVolume += usdc;
    else existing.sellVolume += usdc;
    buckets.set(key, existing);
  }

  return [...buckets.entries()]
    .map(([priceRange, data]) => ({
      priceRange,
      volume: Math.round(data.volume * 100) / 100,
      buyPct: data.volume > 0 ? Math.round((data.buyVolume / data.volume) * 100) : 50,
      tradeCount: data.tradeCount,
    }))
    .sort((a, b) => a.priceRange.localeCompare(b.priceRange));
}

interface PositionRow {
  wallet_address: string;
  position_size: number;
  outcome: string;
  snapshot_time: string;
}

function computePositionDeltas(positions: PositionRow[]) {
  if (positions.length === 0) return [];

  // Group by wallet, get last 2 snapshots to compute delta
  const byWallet = new Map<string, PositionRow[]>();
  for (const p of positions) {
    if (!byWallet.has(p.wallet_address)) byWallet.set(p.wallet_address, []);
    byWallet.get(p.wallet_address)!.push(p);
  }

  const deltas = [];
  for (const [wallet, snaps] of byWallet) {
    if (snaps.length < 1) continue;

    const latest = snaps[0];
    const previous = snaps.length > 1 ? snaps[1] : null;
    const delta = previous ? latest.position_size - previous.position_size : 0;

    deltas.push({
      wallet: `${wallet.slice(0, 6)}...${wallet.slice(-4)}`,
      fullAddress: wallet,
      currentSize: latest.position_size,
      previousSize: previous?.position_size ?? null,
      delta,
      outcome: latest.outcome,
      lastSnapshot: latest.snapshot_time,
    });
  }

  return deltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}
