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

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
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
      WHERE combined_weight > 0.10
      ORDER BY combined_weight DESC
      LIMIT 30000
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

  const edges: Array<{
    source: string;
    target: string;
    weight: number;
    walletOverlap?: number;
    sharedWallets?: number;
    priceCorrelation?: number | null;
    corrSamples?: number | null;
    synthetic?: boolean;
    reason?: string;
  }> = rawEdges
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

  // ─── Synthetic overlay: fill out non-crypto categories + topic links ───
  // Real edges are too sparse outside crypto to make the map feel connected.
  // We add (a) intra-category nearest-neighbor edges by volume rank, and
  // (b) shared-keyword cross-category edges (Iran, Trump, Fed, election, …).
  const existingPair = new Set(edges.map((e) => pairKey(e.source, e.target)));
  const syntheticEdges: typeof edges = [];

  // (a) intra-category: connect each market to its top-K same-category neighbors by volume
  const byCategory = new Map<string, typeof nodes>();
  for (const n of nodes) {
    const arr = byCategory.get(n.category) ?? [];
    arr.push(n);
    byCategory.set(n.category, arr);
  }
  const INTRA_K = 5;
  for (const [, list] of byCategory) {
    const sorted = [...list].sort((a, b) => b.volume - a.volume);
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      for (let j = i + 1; j < Math.min(sorted.length, i + 1 + INTRA_K); j++) {
        const b = sorted[j];
        const key = pairKey(a.id, b.id);
        if (existingPair.has(key)) continue;
        existingPair.add(key);
        syntheticEdges.push({
          source: a.id,
          target: b.id,
          weight: 0.18,
          synthetic: true,
          reason: `same-category:${a.category}`,
        });
      }
    }
  }

  // (b) cross-category by shared keyword in question title
  const TOPICS: Array<{ key: string; pattern: RegExp }> = [
    { key: 'iran', pattern: /\biran(?:ian)?\b/i },
    { key: 'israel', pattern: /\bisrael(?:i)?\b|\bgaza\b|\bhamas\b/i },
    { key: 'russia', pattern: /\brussia(?:n)?\b|\bputin\b|\bukraine\b/i },
    { key: 'china', pattern: /\bchina\b|\bchinese\b|\btaiwan\b|\bxi jinping\b/i },
    { key: 'trump', pattern: /\btrump\b/i },
    { key: 'biden', pattern: /\bbiden\b/i },
    { key: 'republicans', pattern: /\brepublican(?:s)?\b|\bgop\b/i },
    { key: 'democrats', pattern: /\bdemocrat(?:s|ic)?\b/i },
    { key: 'election', pattern: /\belection\b|\bprimary\b|\bvotes?\b|\bsenate\b|\bhouse\b/i },
    { key: 'fed-rates', pattern: /\bfed\b|\binterest rate\b|\brate cut\b|\brate hike\b|\bfomc\b/i },
    { key: 'inflation', pattern: /\binflation\b|\bcpi\b|\bppi\b/i },
    { key: 'recession', pattern: /\brecession\b|\bgdp\b/i },
    { key: 'oil', pattern: /\boil\b|\bopec\b|\bcrude\b/i },
    { key: 'bitcoin', pattern: /\bbitcoin\b|\bbtc\b/i },
    { key: 'ethereum', pattern: /\bethereum\b|\beth\b/i },
    { key: 'ai', pattern: /\b(ai|artificial intelligence|openai|gpt|chatgpt|anthropic|claude)\b/i },
    { key: 'spacex', pattern: /\bspacex\b|\belon musk\b|\btesla\b/i },
  ];
  const topicBuckets = new Map<string, typeof nodes>();
  for (const n of nodes) {
    const title = n.title ?? '';
    for (const t of TOPICS) {
      if (t.pattern.test(title)) {
        const arr = topicBuckets.get(t.key) ?? [];
        arr.push(n);
        topicBuckets.set(t.key, arr);
      }
    }
  }
  const PER_TOPIC_CAP = 60; // max pairs per topic
  for (const [topic, bucket] of topicBuckets) {
    if (bucket.length < 2) continue;
    const sorted = [...bucket].sort((a, b) => b.volume - a.volume);
    let added = 0;
    outer: for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        if (added >= PER_TOPIC_CAP) break outer;
        const a = sorted[i];
        const b = sorted[j];
        const key = pairKey(a.id, b.id);
        if (existingPair.has(key)) continue;
        existingPair.add(key);
        syntheticEdges.push({
          source: a.id,
          target: b.id,
          weight: a.category === b.category ? 0.22 : 0.28,
          synthetic: true,
          reason: `topic:${topic}`,
        });
        added++;
      }
    }
  }

  edges.push(...syntheticEdges);

  // Keep only top 800 edges by weight (real edges win on ties — higher weight)
  const topEdges = edges
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 800);

  const response = NextResponse.json({
    nodes,
    edges: topEdges,
    generatedAt: new Date().toISOString(),
  });

  // Edges change daily — 1hr cache keeps BQ costs low
  response.headers.set(
    'Cache-Control',
    'public, s-maxage=3600, stale-while-revalidate=1800'
  );

  return response;
}
