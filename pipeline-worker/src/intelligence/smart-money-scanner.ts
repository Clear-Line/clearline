/**
 * Smart Money Scanner — the single intelligence module.
 *
 * Signal: "Are high-accuracy wallets buying or selling this market?"
 *
 * Data sources:
 *   - BigQuery: trades (last 12h), market_snapshots (latest + 48h), wallets (accuracy)
 *   - Supabase: markets (title, category, end_date)
 *   - Heisenberg API: Falcon Score leaderboard (enrichment layer, optional)
 *
 * Enrichment signals (computed from local data):
 *   - Volume-price divergence (Edge 3)
 *   - Liquidity vacuum detection (Edge 5)
 *
 * Writes:
 *   - BigQuery: market_cards (one row per market, upserted)
 */

import { bq } from '../core/bigquery.js';
import { getFalconLeaderboard, type FalconWallet } from '../core/heisenberg-client.js';

// ─── Types ───

interface TradeRow {
  market_id: string;
  wallet_address: string;
  side: string;       // 'BUY' | 'SELL'
  size_usdc: number;
  timestamp: string;
}

interface WalletRow {
  address: string;
  accuracy_score: number;
  accuracy_sample_size: number;
}

interface SnapshotRow {
  market_id: string;
  yes_price: number;
  volume_24h: number;
  liquidity: number;
  spread: number | null;
  timestamp: string;
}

interface MarketMeta {
  condition_id: string;
  question: string;
  category: string | null;
  end_date: string | null;
}

interface MarketCard {
  market_id: string;
  title: string;
  category: string;
  end_date: string | null;
  current_price: number;
  price_24h_ago: number;
  price_change: number;
  volume_24h: number;
  liquidity: number;
  spread: number | null;
  signal: 'BUY' | 'SELL' | 'NEUTRAL';
  signal_confidence: number;
  smart_buy_volume: number;
  smart_sell_volume: number;
  smart_wallet_count: number;
  top_smart_wallets: string; // JSON
  volume_divergence: number | null;
  spread_ratio: number | null;
  depth_ratio: number | null;
  liquidity_vacuum: boolean;
  computed_at: string;
}

// ─── Smart wallet with merged scoring ───

interface SmartWallet {
  address: string;
  accuracy_score: number;
  falcon_score: number | null;  // null if not in Falcon leaderboard
  sample_size: number;
}

// ─── Constants ───

const ACCURACY_THRESHOLD = 0.55;
const MIN_SAMPLE_SIZE = 3;
const ID_BATCH = 200;
const UPSERT_BATCH = 200;
const DIVERGENCE_THRESHOLD = 5;
const SPREAD_VACUUM_THRESHOLD = 2.0;
const DEPTH_VACUUM_THRESHOLD = 0.5;

// ─── Category classification ───

function classifyCategory(question: string, dbCategory: string | null): string {
  if (dbCategory === 'politics' || dbCategory === 'economics' || dbCategory === 'geopolitics' || dbCategory === 'crypto') {
    return dbCategory;
  }
  const q = question.toLowerCase();
  if (/iran|israel|gaza|ukraine|russia|china|taiwan|war |conflict|sanctions|military|nato|ceasefire|invasion|missile|nuclear|north korea|houthi|hezbollah|syria|yemen|coup|terror|strike/.test(q)) return 'geopolitics';
  if (/president|gop|democrat|republican|election|senate|governor|congress|vote|primary|caucus|ballot|trump|biden/.test(q)) return 'politics';
  if (/fed |interest rate|inflation|gdp|s&p|nasdaq|recession|unemployment|tariff|trade war|oil price|treasury|debt ceiling|stock market|dow jones/.test(q)) return 'economics';
  if (/bitcoin|btc|ethereum|eth|crypto|solana|sol /.test(q)) return 'crypto';
  return dbCategory || 'other';
}

// ─── Merge local wallets with Falcon leaderboard ───

async function buildSmartWalletPool(): Promise<{
  pool: Map<string, SmartWallet>;
  falconEnriched: boolean;
}> {
  // Local wallets (ground truth — always available)
  const { data: localWallets, error: wErr } = await bq
    .from('wallets')
    .select('address, accuracy_score, accuracy_sample_size')
    .gt('accuracy_score', ACCURACY_THRESHOLD)
    .gte('accuracy_sample_size', MIN_SAMPLE_SIZE);

  const pool = new Map<string, SmartWallet>();

  for (const w of localWallets ?? []) {
    pool.set(w.address, {
      address: w.address,
      accuracy_score: w.accuracy_score,
      falcon_score: null,
      sample_size: w.accuracy_sample_size,
    });
  }

  if (wErr) {
    console.warn(`[SmartMoney] Local wallet fetch warning: ${wErr.message}`);
  }

  // Heisenberg Falcon enrichment (optional — fails gracefully)
  let falconEnriched = false;
  try {
    const falconWallets = await getFalconLeaderboard(200);

    if (falconWallets && falconWallets.length > 0) {
      falconEnriched = true;
      console.log(`[SmartMoney] Falcon leaderboard: ${falconWallets.length} wallets loaded`);

      for (const fw of falconWallets) {
        const addr = fw.wallet_address;
        const existing = pool.get(addr);

        if (existing) {
          // Wallet in both sources — add Falcon score
          existing.falcon_score = fw.falcon_score;
        } else {
          // Wallet only in Falcon — add to pool with Falcon data
          // Use Falcon win_rate as accuracy proxy if it's above threshold
          const winRate = fw.win_rate ?? 0;
          if (winRate >= ACCURACY_THRESHOLD || fw.falcon_score >= 50) {
            pool.set(addr, {
              address: addr,
              accuracy_score: winRate,
              falcon_score: fw.falcon_score,
              sample_size: fw.total_trades ?? 0,
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[SmartMoney] Falcon enrichment failed (falling back to local wallets): ${err instanceof Error ? err.message : err}`);
  }

  return { pool, falconEnriched };
}

// ─── Main ───

export async function scanSmartMoney(): Promise<{
  cards: number;
  errors: string[];
  telemetry: {
    marketsScanned: number;
    marketsWithSignal: number;
    smartWalletsUsed: number;
    falconEnriched: boolean;
    vacuumsDetected: number;
    divergencesDetected: number;
    duration_ms: number;
  };
}> {
  const startTime = Date.now();
  const errors: string[] = [];

  try {
    // Step 1: Build merged smart wallet pool (local + Falcon)
    const { pool: smartWalletMap, falconEnriched } = await buildSmartWalletPool();

    if (smartWalletMap.size === 0) {
      console.log('[SmartMoney] No smart wallets found (accuracy pipeline may not have run yet). Building cards without signal.');
    }

    // Step 2: Get active markets with recent volume
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Get latest snapshot per market — deduplicated at the SQL level
    // This returns one row per market (the most recent snapshot), ordered by volume
    const { data: dedupedSnaps, error: snapErr } = await bq.rawQuery<SnapshotRow>(`
      SELECT market_id, yes_price, volume_24h, liquidity, spread, timestamp
      FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY market_id ORDER BY timestamp DESC) AS rn
        FROM \`${process.env.GCP_PROJECT_ID}.${process.env.BQ_DATASET || 'polymarket'}.market_snapshots\`
        WHERE timestamp >= @cutoff AND volume_24h > 0
      )
      WHERE rn = 1
      ORDER BY volume_24h DESC
      LIMIT 2000
    `, { cutoff: twentyFourHoursAgo });

    if (snapErr) {
      errors.push(`Snapshot fetch error: ${snapErr.message}`);
    }

    const latestByMarket = new Map<string, SnapshotRow>();
    for (const snap of dedupedSnaps ?? []) {
      latestByMarket.set(snap.market_id, snap);
    }

    const marketIds = [...latestByMarket.keys()];
    if (marketIds.length === 0) {
      return { cards: 0, errors, telemetry: { marketsScanned: 0, marketsWithSignal: 0, smartWalletsUsed: smartWalletMap.size, falconEnriched, vacuumsDetected: 0, divergencesDetected: 0, duration_ms: Date.now() - startTime } };
    }

    // Step 3: Fetch in parallel — market metadata, 24h-ago snapshots, 7d avg, recent trades
    const metaResults: MarketMeta[] = [];
    const olderSnaps: SnapshotRow[] = [];
    const recentTrades: TradeRow[] = [];
    const weekAvgSpread = new Map<string, { sum: number; count: number }>();
    const weekAvgDepth = new Map<string, { sum: number; count: number }>();

    const promises: Promise<void>[] = [];

    // Market metadata from BigQuery (batched — no is_active filter to maximize cards)
    for (let i = 0; i < marketIds.length; i += ID_BATCH) {
      const batch = marketIds.slice(i, i + ID_BATCH);
      promises.push(
        bq
          .from('markets')
          .select('condition_id, question, category, end_date')
          .in('condition_id', batch)
          .then((res: { data: MarketMeta[] | null }) => {
            if (res.data) metaResults.push(...res.data);
          })
      );
    }

    // Older snapshots for price change (4-8h ago window)
    for (let i = 0; i < marketIds.length; i += ID_BATCH) {
      const batch = marketIds.slice(i, i + ID_BATCH);
      promises.push(
        bq.from('market_snapshots')
          .select('market_id, yes_price, volume_24h, liquidity, spread, timestamp')
          .in('market_id', batch)
          .lte('timestamp', fourHoursAgo)
          .gte('timestamp', eightHoursAgo)
          .order('timestamp', { ascending: false })
          .limit(batch.length)
          .then((r: { data: SnapshotRow[] | null }) => {
            if (r.data) olderSnaps.push(...r.data);
          })
      );
    }

    // Recent avg spread/depth for liquidity vacuum — aggregate at SQL level (4-24h window)
    {
      const dataset = `${process.env.GCP_PROJECT_ID}.${process.env.BQ_DATASET || 'polymarket'}`;
      promises.push(
        bq.rawQuery<{ market_id: string; avg_spread: number; avg_liquidity: number; snap_count: number }>(
          `SELECT market_id,
                  AVG(spread) as avg_spread,
                  AVG(liquidity) as avg_liquidity,
                  COUNT(*) as snap_count
           FROM \`${dataset}.market_snapshots\`
           WHERE timestamp >= @windowStart AND timestamp < @windowEnd
           GROUP BY market_id
           HAVING COUNT(*) >= 3`,
          { windowStart: twentyFourHoursAgo, windowEnd: fourHoursAgo }
        ).then((r) => {
          if (r.data) {
            for (const row of r.data) {
              weekAvgSpread.set(row.market_id, { sum: Number(row.avg_spread) * Number(row.snap_count), count: Number(row.snap_count) });
              weekAvgDepth.set(row.market_id, { sum: Number(row.avg_liquidity) * Number(row.snap_count), count: Number(row.snap_count) });
            }
          }
          if (r.error) errors.push(`Week avg fetch: ${r.error.message}`);
        })
      );
    }

    // Recent trades (last 12h) — filter to smart wallets at SQL level to avoid pulling 100K+ rows
    if (smartWalletMap.size > 0) {
      const walletAddresses = [...smartWalletMap.keys()];
      // Use raw SQL with wallet filter for efficiency
      const dataset = `${process.env.GCP_PROJECT_ID}.${process.env.BQ_DATASET || 'polymarket'}`;
      promises.push(
        bq.rawQuery<TradeRow>(
          `SELECT market_id, wallet_address, side, size_usdc, timestamp
           FROM \`${dataset}.trades\`
           WHERE timestamp >= @cutoff
             AND wallet_address IN UNNEST(@wallets)`,
          { cutoff: twoHoursAgo, wallets: walletAddresses }
        ).then((r) => {
          if (r.data) recentTrades.push(...r.data);
          if (r.error) errors.push(`Trade fetch: ${r.error.message}`);
        })
      );
    }

    await Promise.all(promises);

    // Index data
    const metaByMarket = new Map<string, MarketMeta>();
    for (const m of metaResults) {
      metaByMarket.set(m.condition_id, m);
    }

    const price24hAgo = new Map<string, number>();
    const volume24hAgo = new Map<string, number>();
    const seen24h = new Set<string>();
    for (const snap of olderSnaps) {
      if (!seen24h.has(snap.market_id)) {
        seen24h.add(snap.market_id);
        price24hAgo.set(snap.market_id, snap.yes_price);
        volume24hAgo.set(snap.market_id, snap.volume_24h);
      }
    }

    // weekAvgSpread and weekAvgDepth are populated by the raw SQL query above

    // Group trades by market — trades already filtered to smart wallets at SQL level
    const smartTradesByMarket = new Map<string, { wallet: string; side: string; volume: number; accuracy: number; falcon_score: number | null }[]>();
    for (const t of recentTrades) {
      const wallet = smartWalletMap.get(t.wallet_address);
      if (!wallet) continue;
      if (!smartTradesByMarket.has(t.market_id)) smartTradesByMarket.set(t.market_id, []);
      smartTradesByMarket.get(t.market_id)!.push({
        wallet: t.wallet_address,
        side: t.side,
        volume: Number(t.size_usdc) || 0,
        accuracy: wallet.accuracy_score,
        falcon_score: wallet.falcon_score,
      });
    }

    // Step 4: Build market cards
    const cards: MarketCard[] = [];
    let marketsWithSignal = 0;
    let vacuumsDetected = 0;
    let divergencesDetected = 0;

    for (const marketId of marketIds) {
      const meta = metaByMarket.get(marketId);
      const latest = latestByMarket.get(marketId);
      if (!meta || !latest) continue;

      const category = classifyCategory(meta.question, meta.category);
      if (category === 'sports') continue;

      const currentPrice = Number(latest.yes_price) || 0;
      if (currentPrice <= 0.01 || currentPrice >= 0.99) continue;

      const prevPrice = price24hAgo.get(marketId) ?? currentPrice;
      const priceChange = currentPrice - prevPrice;

      // ── Smart money signal ──
      const smartTrades = smartTradesByMarket.get(marketId) ?? [];
      let smartBuyVolume = 0;
      let smartSellVolume = 0;
      const smartWalletSet = new Set<string>();

      for (const t of smartTrades) {
        smartWalletSet.add(t.wallet);
        if (t.side === 'BUY' || t.side === 'buy') {
          smartBuyVolume += t.volume;
        } else {
          smartSellVolume += t.volume;
        }
      }

      const totalSmartVolume = smartBuyVolume + smartSellVolume;
      let signal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
      let signalConfidence = 0;

      if (totalSmartVolume > 0) {
        const ratio = Math.abs(smartBuyVolume - smartSellVolume) / totalSmartVolume;
        signalConfidence = Math.round(ratio * 100) / 100;

        if (ratio > 0.2) { // At least 60/40 split to generate signal
          signal = smartBuyVolume > smartSellVolume ? 'BUY' : 'SELL';
          marketsWithSignal++;
        }
      }

      // ── Volume-price divergence (Edge 3) ──
      let volumeDivergence: number | null = null;
      const prevVolume = volume24hAgo.get(marketId);
      const currentVolume = Number(latest.volume_24h) || 0;

      if (prevVolume != null && prevVolume > 0) {
        const volumeChangePct = (currentVolume - prevVolume) / prevVolume;
        const priceChangePct = prevPrice > 0 ? Math.abs(priceChange) / prevPrice : 0;
        volumeDivergence = Math.round((volumeChangePct / Math.max(priceChangePct, 0.01)) * 100) / 100;

        if (volumeDivergence > DIVERGENCE_THRESHOLD) {
          divergencesDetected++;
          // Boost confidence if smart wallets are present and volume is accumulating
          if (smartWalletSet.size > 0 && signal !== 'NEUTRAL') {
            signalConfidence = Math.min(1, signalConfidence * 1.2);
          }
        }
      }

      // ── Liquidity vacuum detection (Edge 5) ──
      let spreadRatio: number | null = null;
      let depthRatio: number | null = null;
      let liquidityVacuum = false;

      const currentSpread = latest.spread != null ? Number(latest.spread) : null;
      const currentDepth = Number(latest.liquidity) || 0;

      const avgSpreadEntry = weekAvgSpread.get(marketId);
      const avgDepthEntry = weekAvgDepth.get(marketId);

      if (currentSpread != null && avgSpreadEntry && avgSpreadEntry.count >= 3) {
        const avgSpread = avgSpreadEntry.sum / avgSpreadEntry.count;
        if (avgSpread > 0.001) {
          spreadRatio = Math.round((currentSpread / avgSpread) * 100) / 100;
        }
      }

      if (currentDepth > 0 && avgDepthEntry && avgDepthEntry.count >= 3) {
        const avgDepth = avgDepthEntry.sum / avgDepthEntry.count;
        if (avgDepth > 0) {
          depthRatio = Math.round((currentDepth / avgDepth) * 100) / 100;
        }
      }

      if ((spreadRatio != null && spreadRatio > SPREAD_VACUUM_THRESHOLD) ||
          (depthRatio != null && depthRatio < DEPTH_VACUUM_THRESHOLD)) {
        liquidityVacuum = true;
        vacuumsDetected++;
      }

      // ── Top smart wallets (for display) ──
      const walletAgg = new Map<string, { side: string; volume: number; accuracy: number; falcon_score: number | null }>();
      for (const t of smartTrades) {
        const existing = walletAgg.get(t.wallet);
        if (existing) {
          existing.volume += t.volume;
        } else {
          walletAgg.set(t.wallet, { side: t.side, volume: t.volume, accuracy: t.accuracy, falcon_score: t.falcon_score });
        }
      }

      const topWallets = [...walletAgg.entries()]
        .sort((a, b) => b[1].volume - a[1].volume)
        .slice(0, 5)
        .map(([address, data]) => ({
          address: `${address.slice(0, 6)}...${address.slice(-4)}`,
          accuracy: Math.round(data.accuracy * 100),
          falcon_score: data.falcon_score,
          side: data.side,
          volume: Math.round(data.volume),
        }));

      cards.push({
        market_id: marketId,
        title: meta.question,
        category,
        end_date: meta.end_date,
        current_price: currentPrice,
        price_24h_ago: prevPrice,
        price_change: Math.round(priceChange * 10000) / 10000,
        volume_24h: currentVolume,
        liquidity: currentDepth,
        spread: currentSpread,
        signal,
        signal_confidence: signalConfidence,
        smart_buy_volume: Math.round(smartBuyVolume),
        smart_sell_volume: Math.round(smartSellVolume),
        smart_wallet_count: smartWalletSet.size,
        top_smart_wallets: JSON.stringify(topWallets),
        volume_divergence: volumeDivergence,
        spread_ratio: spreadRatio,
        depth_ratio: depthRatio,
        liquidity_vacuum: liquidityVacuum,
        computed_at: new Date().toISOString(),
      });
    }

    // Step 5: Upsert to BigQuery
    let upserted = 0;
    for (let i = 0; i < cards.length; i += UPSERT_BATCH) {
      const chunk = cards.slice(i, i + UPSERT_BATCH);
      const { error } = await bq
        .from('market_cards')
        .upsert(chunk, { onConflict: 'market_id' });

      if (error) {
        errors.push(`Upsert batch ${i}: ${error.message}`);
      } else {
        upserted += chunk.length;
      }
    }

    return {
      cards: upserted,
      errors: errors.slice(0, 10),
      telemetry: {
        marketsScanned: marketIds.length,
        marketsWithSignal,
        smartWalletsUsed: smartWalletMap.size,
        falconEnriched,
        vacuumsDetected,
        divergencesDetected,
        duration_ms: Date.now() - startTime,
      },
    };
  } catch (err) {
    errors.push(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
    return {
      cards: 0,
      errors,
      telemetry: { marketsScanned: 0, marketsWithSignal: 0, smartWalletsUsed: 0, falconEnriched: false, vacuumsDetected: 0, divergencesDetected: 0, duration_ms: Date.now() - startTime },
    };
  }
}
