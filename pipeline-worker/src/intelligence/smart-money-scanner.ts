/**
 * Smart Money Scanner — the single intelligence module.
 *
 * Replaces: analytics-engine, edge-engine, tier1-signals, correlation-engine,
 *           position-tracker, candidate-ranker, move-detector
 *
 * Signal: "Are high-accuracy wallets buying or selling this market?"
 *
 * Reads:
 *   - BigQuery: trades (last 12h), market_snapshots (latest), wallets (accuracy)
 *   - Supabase: markets (title, category, end_date)
 *
 * Writes:
 *   - BigQuery: market_cards (one row per market, upserted)
 */

import { bq } from '../core/bigquery.js';
import { supabaseAdmin } from '../core/supabase.js';

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
  computed_at: string;
}

// ─── Constants ───

const ACCURACY_THRESHOLD = 0.55;
const MIN_SAMPLE_SIZE = 3;
const ID_BATCH = 200;
const UPSERT_BATCH = 200;

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

// ─── Main ───

export async function scanSmartMoney(): Promise<{
  cards: number;
  errors: string[];
  telemetry: {
    marketsScanned: number;
    marketsWithSignal: number;
    smartWalletsUsed: number;
    duration_ms: number;
  };
}> {
  const startTime = Date.now();
  const errors: string[] = [];

  try {
    // Step 1: Get all smart wallets (accuracy > threshold, enough samples)
    const { data: smartWallets, error: wErr } = await bq
      .from('wallets')
      .select('address, accuracy_score, accuracy_sample_size')
      .gt('accuracy_score', ACCURACY_THRESHOLD)
      .gte('accuracy_sample_size', MIN_SAMPLE_SIZE);

    if (wErr) {
      errors.push(`Wallet fetch error: ${wErr.message}`);
      return { cards: 0, errors, telemetry: { marketsScanned: 0, marketsWithSignal: 0, smartWalletsUsed: 0, duration_ms: Date.now() - startTime } };
    }

    const smartWalletMap = new Map<string, WalletRow>();
    for (const w of smartWallets ?? []) {
      smartWalletMap.set(w.address, w);
    }

    if (smartWalletMap.size === 0) {
      // No smart wallets yet — still build cards without signal
      console.log('[SmartMoney] No smart wallets found (accuracy pipeline may not have run yet). Building cards without signal.');
    }

    // Step 2: Get active markets with recent volume
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    // Get latest snapshots (deduplicated, ordered by volume)
    const { data: latestSnaps } = await bq
      .from('market_snapshots')
      .select('market_id, yes_price, volume_24h, liquidity, spread, timestamp')
      .gte('timestamp', twentyFourHoursAgo)
      .gt('volume_24h', 0)
      .order('volume_24h', { ascending: false })
      .limit(5000);

    // Deduplicate: keep latest per market
    const latestByMarket = new Map<string, SnapshotRow>();
    for (const snap of latestSnaps ?? []) {
      if (!latestByMarket.has(snap.market_id)) {
        latestByMarket.set(snap.market_id, snap);
      }
    }

    const marketIds = [...latestByMarket.keys()];
    if (marketIds.length === 0) {
      return { cards: 0, errors, telemetry: { marketsScanned: 0, marketsWithSignal: 0, smartWalletsUsed: smartWalletMap.size, duration_ms: Date.now() - startTime } };
    }

    // Step 3: Fetch in parallel — market metadata, 24h-ago snapshots, recent trades
    const metaResults: MarketMeta[] = [];
    const olderSnaps: SnapshotRow[] = [];
    const recentTrades: TradeRow[] = [];

    const promises: Promise<void>[] = [];

    // Market metadata from Supabase (batched)
    for (let i = 0; i < marketIds.length; i += ID_BATCH) {
      const batch = marketIds.slice(i, i + ID_BATCH);
      promises.push(
        Promise.resolve(
          supabaseAdmin
            .from('markets')
            .select('condition_id, question, category, end_date')
            .in('condition_id', batch)
            .eq('is_active', true)
        ).then((res: { data: MarketMeta[] | null }) => {
          if (res.data) metaResults.push(...res.data);
        })
      );
    }

    // 24h-ago snapshots for price change
    for (let i = 0; i < marketIds.length; i += ID_BATCH) {
      const batch = marketIds.slice(i, i + ID_BATCH);
      promises.push(
        bq.from('market_snapshots')
          .select('market_id, yes_price, volume_24h, liquidity, spread, timestamp')
          .in('market_id', batch)
          .lte('timestamp', twentyFourHoursAgo)
          .gte('timestamp', fortyEightHoursAgo)
          .order('timestamp', { ascending: false })
          .limit(batch.length)
          .then((r: { data: SnapshotRow[] | null }) => {
            if (r.data) olderSnaps.push(...r.data);
          })
      );
    }

    // Recent trades (last 12h) — only if we have smart wallets
    if (smartWalletMap.size > 0) {
      for (let i = 0; i < marketIds.length; i += ID_BATCH) {
        const batch = marketIds.slice(i, i + ID_BATCH);
        promises.push(
          bq.from('trades')
            .select('market_id, wallet_address, side, size_usdc, timestamp')
            .in('market_id', batch)
            .gte('timestamp', twelveHoursAgo)
            .then((r: { data: TradeRow[] | null }) => {
              if (r.data) recentTrades.push(...r.data);
            })
        );
      }
    }

    await Promise.all(promises);

    // Index data
    const metaByMarket = new Map<string, MarketMeta>();
    for (const m of metaResults) {
      metaByMarket.set(m.condition_id, m);
    }

    const price24hAgo = new Map<string, number>();
    const seen24h = new Set<string>();
    for (const snap of olderSnaps) {
      if (!seen24h.has(snap.market_id)) {
        seen24h.add(snap.market_id);
        price24hAgo.set(snap.market_id, snap.yes_price);
      }
    }

    // Group trades by market, filter to smart wallets
    const smartTradesByMarket = new Map<string, { wallet: string; side: string; volume: number; accuracy: number }[]>();
    for (const t of recentTrades) {
      const wallet = smartWalletMap.get(t.wallet_address);
      if (!wallet) continue;
      if (!smartTradesByMarket.has(t.market_id)) smartTradesByMarket.set(t.market_id, []);
      smartTradesByMarket.get(t.market_id)!.push({
        wallet: t.wallet_address,
        side: t.side,
        volume: Number(t.size_usdc) || 0,
        accuracy: wallet.accuracy_score,
      });
    }

    // Step 4: Build market cards
    const FOCUS = new Set(['politics', 'economics', 'geopolitics', 'crypto']);
    const cards: MarketCard[] = [];
    let marketsWithSignal = 0;

    for (const marketId of marketIds) {
      const meta = metaByMarket.get(marketId);
      const latest = latestByMarket.get(marketId);
      if (!meta || !latest) continue;

      const category = classifyCategory(meta.question, meta.category);
      if (!FOCUS.has(category)) continue;

      const currentPrice = Number(latest.yes_price) || 0;
      if (currentPrice <= 0.01 || currentPrice >= 0.99) continue;

      const prevPrice = price24hAgo.get(marketId) ?? currentPrice;
      const priceChange = currentPrice - prevPrice;

      // Smart money signal
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

      // Top smart wallets (for display)
      const walletAgg = new Map<string, { side: string; volume: number; accuracy: number }>();
      for (const t of smartTrades) {
        const existing = walletAgg.get(t.wallet);
        if (existing) {
          existing.volume += t.volume;
        } else {
          walletAgg.set(t.wallet, { side: t.side, volume: t.volume, accuracy: t.accuracy });
        }
      }

      const topWallets = [...walletAgg.entries()]
        .sort((a, b) => b[1].volume - a[1].volume)
        .slice(0, 5)
        .map(([address, data]) => ({
          address: `${address.slice(0, 6)}...${address.slice(-4)}`,
          accuracy: Math.round(data.accuracy * 100),
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
        volume_24h: Number(latest.volume_24h) || 0,
        liquidity: Number(latest.liquidity) || 0,
        spread: latest.spread != null ? Number(latest.spread) : null,
        signal,
        signal_confidence: signalConfidence,
        smart_buy_volume: Math.round(smartBuyVolume),
        smart_sell_volume: Math.round(smartSellVolume),
        smart_wallet_count: smartWalletSet.size,
        top_smart_wallets: JSON.stringify(topWallets),
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
        duration_ms: Date.now() - startTime,
      },
    };
  } catch (err) {
    errors.push(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
    return {
      cards: 0,
      errors,
      telemetry: { marketsScanned: 0, marketsWithSignal: 0, smartWalletsUsed: 0, duration_ms: Date.now() - startTime },
    };
  }
}
