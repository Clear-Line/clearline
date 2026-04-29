import { NextResponse } from 'next/server';
import { bq } from '@/lib/bigquery';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const projectId = process.env.GCP_PROJECT_ID!;
const dataset = process.env.BQ_DATASET || 'polymarket';

interface NodeRow {
  id: string;
  title: string;
  category: string;
  yes_price: number | null;
  volume_24h: number | null;
  liquidity: number | null;
  end_date: string | null;
  price_change: number | null;
  smart_wallet_count: number | null;
  insider_count: number | null;
  signal: string | null;
}

interface EdgeRow {
  market_a: string;
  market_b: string;
  wallet_overlap: number;
  shared_wallets: number;
  price_corr: number | null;
  corr_samples: number | null;
  combined_weight: number;
}

/**
 * GET /api/constellation — returns full constellation map data (nodes + edges).
 * PUBLIC — no auth required (Explorer mode).
 */
export async function GET() {
  const fq = (table: string) => `\`${projectId}.${dataset}.${table}\``;

  // Parallel: active markets with latest snapshot + edges
  const [nodesResult, edgesResult] = await Promise.all([
    bq.rawQuery<NodeRow>(`
      SELECT
        m.condition_id AS id,
        m.question AS title,
        m.category,
        m.end_date,
        s.yes_price,
        s.volume_24h,
        s.liquidity,
        c.price_change,
        c.smart_wallet_count,
        i.insider_count,
        c.signal
      FROM ${fq('markets')} m
      INNER JOIN (
        SELECT market_id, yes_price, volume_24h, liquidity,
          ROW_NUMBER() OVER (PARTITION BY market_id ORDER BY timestamp DESC) AS rn
        FROM ${fq('market_snapshots')}
        WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
      ) s ON s.market_id = m.condition_id AND s.rn = 1
      LEFT JOIN (
        SELECT market_id, price_change, smart_wallet_count, signal,
          ROW_NUMBER() OVER (PARTITION BY market_id ORDER BY computed_at DESC) AS rn
        FROM ${fq('market_cards')}
        WHERE computed_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 2 DAY)
      ) c ON c.market_id = m.condition_id AND c.rn = 1
      LEFT JOIN ${fq('market_insiders')} i ON i.market_id = m.condition_id
      WHERE m.is_active = true
        AND m.is_resolved = false
        AND m.category IN ('politics', 'crypto', 'economics', 'geopolitics', 'culture')
        AND s.volume_24h > 0
        AND s.yes_price > 0.01 AND s.yes_price < 0.99
      ORDER BY s.volume_24h DESC
      LIMIT 500
    `),
    bq.rawQuery<EdgeRow>(`
      SELECT market_a, market_b, wallet_overlap, shared_wallets, price_corr, corr_samples, combined_weight
      FROM ${fq('market_edges')}
      WHERE combined_weight > 0.05
    `),
  ]);

  if (nodesResult.error) {
    return NextResponse.json({ error: nodesResult.error.message }, { status: 500 });
  }
  if (edgesResult.error) {
    return NextResponse.json({ error: edgesResult.error.message }, { status: 500 });
  }

  const nodes = (nodesResult.data ?? []).map((n) => ({
    id: n.id,
    title: n.title,
    category: n.category ?? 'other',
    price: n.yes_price ?? null,
    volume: n.volume_24h ?? 0,
    liquidity: n.liquidity ?? 0,
    endDate: n.end_date ?? null,
    priceChange: n.price_change ?? 0,
    smartWalletCount: n.smart_wallet_count ?? 0,
    insiderCount: n.insider_count ?? 0,
    signal: n.signal ?? 'NEUTRAL',
  }));

  // Only include edges where both endpoints are in the visible node set
  const nodeIds = new Set(nodes.map((n) => n.id));

  const rawEdges = (edgesResult.data ?? [])
    .filter((e) => nodeIds.has(e.market_a) && nodeIds.has(e.market_b));

  // Per-node edge cap — prevents any single node from becoming a hub that
  // pulls clusters into a hairball. Each node keeps its top-K strongest edges;
  // an edge survives if either endpoint kept it. See CLAUDE.md fix #7.
  const MAX_EDGES_PER_NODE = 8;
  const nodeAdj = new Map<string, EdgeRow[]>();
  for (const e of rawEdges) {
    for (const id of [e.market_a, e.market_b]) {
      const list = nodeAdj.get(id) ?? [];
      list.push(e);
      nodeAdj.set(id, list);
    }
  }
  const kept = new Set<string>();
  for (const [, edgeList] of nodeAdj) {
    edgeList.sort((a, b) => b.combined_weight - a.combined_weight);
    for (const e of edgeList.slice(0, MAX_EDGES_PER_NODE)) {
      kept.add(`${e.market_a}|${e.market_b}`);
    }
  }

  const edges = rawEdges
    .filter((e) => kept.has(`${e.market_a}|${e.market_b}`))
    .map((e) => ({
      source: e.market_a,
      target: e.market_b,
      weight: e.combined_weight,
      walletOverlap: e.wallet_overlap,
      sharedWallets: e.shared_wallets,
      priceCorrelation: e.price_corr,
      corrSamples: e.corr_samples,
    }));

  const response = NextResponse.json({
    nodes,
    edges,
    generatedAt: new Date().toISOString(),
  });

  // Edges change daily — 1hr cache keeps BQ costs low
  response.headers.set(
    'Cache-Control',
    'public, s-maxage=3600, stale-while-revalidate=1800'
  );

  return response;
}
