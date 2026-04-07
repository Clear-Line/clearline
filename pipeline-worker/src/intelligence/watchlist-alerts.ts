/**
 * Watchlist alerts — scans markets the Clearline users are watching, detects
 * price moves beyond a threshold over a configurable window, then posts a
 * single Discord embed to the Clearline `#alerts` channel per moved market.
 *
 * The embed @mentions every user watching the market whose notifications are
 * enabled and who hasn't already been alerted recently. The Clearline
 * differentiator: each embed also includes the top 3 connected markets from
 * `market_edges` — nobody else has that constellation data.
 *
 * Runs every 15 minutes. Idempotent via `user_market_alert_log` dedup.
 */

import { bq } from '../core/bigquery.js';
import { supabaseAdmin } from '../core/supabase.js';

// ─── Config ───

/** Default threshold for a "big move" when the user hasn't customized settings. */
const DEFAULT_MIN_PRICE_MOVE = 0.05;
/** Default look-back window for the move. */
const DEFAULT_WINDOW_HOURS = 24;
/** Don't re-alert the same user about the same market within this window (hours). */
const DEDUP_WINDOW_HOURS = 24;
/** Allow a re-alert inside the dedup window if the price has drifted at least this much since the last alert. */
const REALERT_DRIFT = 0.02;

// ─── Types ───

interface MoveRow {
  market_id: string;
  current_price: number;
  old_price: number;
  price_delta: number;
  question: string | null;
  category: string | null;
  volume_24h: number | null;
}

interface ConnectedMarketRow {
  market_id: string;
  question: string;
  combined_weight: number;
  current_price: number | null;
  price_delta_24h: number | null;
}

interface WatcherRow {
  user_id: number;
  discord_user_id: string;
}

interface AlertLogRow {
  user_id: number;
  price_at_alert: number;
  alerted_at: string;
}

// ─── Main entrypoint ───

export async function runWatchlistAlerts(): Promise<{
  marketsScanned: number;
  marketsMoved: number;
  alertsSent: number;
  usersMentioned: number;
  errors: string[];
}> {
  const errors: string[] = [];
  const webhookUrl = process.env.CLEARLINE_DISCORD_WEBHOOK_URL;
  const baseUrl = process.env.CLEARLINE_BASE_URL || 'https://clearline.app';

  if (!webhookUrl) {
    return {
      marketsScanned: 0,
      marketsMoved: 0,
      alertsSent: 0,
      usersMentioned: 0,
      errors: ['CLEARLINE_DISCORD_WEBHOOK_URL not set'],
    };
  }

  // ─── 1. Collect distinct watchlisted markets ───

  const { data: watchRows, error: watchErr } = await supabaseAdmin
    .from('user_market_watchlist')
    .select('market_id');

  if (watchErr) {
    return {
      marketsScanned: 0,
      marketsMoved: 0,
      alertsSent: 0,
      usersMentioned: 0,
      errors: [`Failed to read watchlist: ${watchErr.message}`],
    };
  }

  const marketIds = Array.from(
    new Set((watchRows ?? []).map((r) => r.market_id as string)),
  );

  if (marketIds.length === 0) {
    return { marketsScanned: 0, marketsMoved: 0, alertsSent: 0, usersMentioned: 0, errors };
  }

  // ─── 2. Compute current-vs-window-ago price for each market ───

  const moves = await detectMoves(marketIds, DEFAULT_WINDOW_HOURS, DEFAULT_MIN_PRICE_MOVE);
  if (moves.length === 0) {
    return {
      marketsScanned: marketIds.length,
      marketsMoved: 0,
      alertsSent: 0,
      usersMentioned: 0,
      errors,
    };
  }

  // ─── 3. Per moved market: gather watchers, dedup, fire webhook ───

  let alertsSent = 0;
  let totalMentioned = 0;

  for (const move of moves) {
    try {
      const watchers = await fetchWatchers(move.market_id);
      if (watchers.length === 0) continue;

      const recentAlerts = await fetchRecentAlerts(
        move.market_id,
        watchers.map((w) => w.user_id),
      );

      // Filter out users that were alerted recently and whose price hasn't drifted enough
      const eligible = watchers.filter((w) => {
        const recent = recentAlerts.get(w.user_id);
        if (!recent) return true;
        const drift = Math.abs(move.current_price - Number(recent.price_at_alert));
        return drift >= REALERT_DRIFT;
      });

      if (eligible.length === 0) continue;

      // Look up top-3 connected markets from market_edges
      const connected = await fetchConnectedMarkets(move.market_id);

      const ok = await postAlert({
        webhookUrl,
        baseUrl,
        move,
        connected,
        mentionIds: eligible.map((e) => e.discord_user_id),
      });

      if (!ok) {
        errors.push(`Discord webhook failed for market ${move.market_id}`);
        continue;
      }

      alertsSent++;
      totalMentioned += eligible.length;

      // Insert dedup log rows
      const logRows = eligible.map((e) => ({
        user_id: e.user_id,
        market_id: move.market_id,
        price_at_alert: move.current_price,
      }));
      const { error: logErr } = await supabaseAdmin
        .from('user_market_alert_log')
        .insert(logRows);
      if (logErr) {
        errors.push(`Failed to write alert log: ${logErr.message}`);
      }
    } catch (err) {
      errors.push(
        `Market ${move.market_id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    marketsScanned: marketIds.length,
    marketsMoved: moves.length,
    alertsSent,
    usersMentioned: totalMentioned,
    errors,
  };
}

// ─── BigQuery: price moves ───

async function detectMoves(
  marketIds: string[],
  windowHours: number,
  minMove: number,
): Promise<MoveRow[]> {
  const projectId = process.env.GCP_PROJECT_ID!;
  const dataset = process.env.BQ_DATASET || 'polymarket';
  const fq = (t: string) => `\`${projectId}.${dataset}.${t}\``;

  const { data, error } = await bq.rawQuery<MoveRow>(
    `
    WITH ranked AS (
      SELECT
        market_id,
        yes_price,
        timestamp AS snap_ts,
        ROW_NUMBER() OVER (PARTITION BY market_id ORDER BY timestamp DESC) AS rn_latest,
        ROW_NUMBER() OVER (
          PARTITION BY market_id
          ORDER BY ABS(TIMESTAMP_DIFF(timestamp, TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @windowHours HOUR), MINUTE))
        ) AS rn_window
      FROM ${fq('market_snapshots')}
      WHERE market_id IN UNNEST(@marketIds)
        AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @lookbackHours HOUR)
    ),
    latest AS (
      SELECT market_id, yes_price AS current_price FROM ranked WHERE rn_latest = 1
    ),
    old AS (
      SELECT market_id, yes_price AS old_price FROM ranked WHERE rn_window = 1
    ),
    vol AS (
      SELECT
        market_id,
        SUM(size_usdc) AS volume_24h
      FROM ${fq('trades')}
      WHERE market_id IN UNNEST(@marketIds)
        AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
      GROUP BY market_id
    )
    SELECT
      l.market_id,
      l.current_price,
      o.old_price,
      l.current_price - o.old_price AS price_delta,
      m.question,
      m.category,
      v.volume_24h
    FROM latest l
    JOIN old o USING (market_id)
    JOIN ${fq('markets')} m ON m.condition_id = l.market_id
    LEFT JOIN vol v ON v.market_id = l.market_id
    WHERE ABS(l.current_price - o.old_price) >= @minMove
      AND m.is_active = true
      AND m.is_resolved = false
    `,
    { marketIds, windowHours, minMove, lookbackHours: windowHours + 2 },
  );

  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    ...r,
    current_price: Number(r.current_price),
    old_price: Number(r.old_price),
    price_delta: Number(r.price_delta),
    volume_24h: r.volume_24h == null ? null : Number(r.volume_24h),
  }));
}

// ─── BigQuery: connected markets from market_edges ───

async function fetchConnectedMarkets(marketId: string): Promise<ConnectedMarketRow[]> {
  const projectId = process.env.GCP_PROJECT_ID!;
  const dataset = process.env.BQ_DATASET || 'polymarket';
  const fq = (t: string) => `\`${projectId}.${dataset}.${t}\``;

  const { data, error } = await bq.rawQuery<ConnectedMarketRow>(
    `
    WITH neighbors AS (
      SELECT
        CASE WHEN market_a = @marketId THEN market_b ELSE market_a END AS other_id,
        combined_weight
      FROM ${fq('market_edges')}
      WHERE market_a = @marketId OR market_b = @marketId
      ORDER BY combined_weight DESC
      LIMIT 3
    ),
    latest_cards AS (
      SELECT *
      FROM (
        SELECT
          market_id,
          current_price,
          price_change,
          ROW_NUMBER() OVER (PARTITION BY market_id ORDER BY computed_at DESC) AS rn
        FROM ${fq('market_cards')}
      )
      WHERE rn = 1
    )
    SELECT
      n.other_id AS market_id,
      m.question,
      n.combined_weight,
      lc.current_price,
      lc.price_change AS price_delta_24h
    FROM neighbors n
    JOIN ${fq('markets')} m ON m.condition_id = n.other_id
    LEFT JOIN latest_cards lc ON lc.market_id = n.other_id
    ORDER BY n.combined_weight DESC
    `,
    { marketId },
  );

  if (error) {
    // Non-fatal — just return empty
    return [];
  }
  return (data ?? []).map((r) => ({
    ...r,
    combined_weight: Number(r.combined_weight),
    current_price: r.current_price == null ? null : Number(r.current_price),
    price_delta_24h: r.price_delta_24h == null ? null : Number(r.price_delta_24h),
  }));
}

// ─── Supabase: watchers + dedup log ───

async function fetchWatchers(marketId: string): Promise<WatcherRow[]> {
  // Two-step fetch — both tables reference users.id but have no direct FK,
  // so we can't use a PostgREST embedded join here.
  const { data: watchlistRows, error: wErr } = await supabaseAdmin
    .from('user_market_watchlist')
    .select('user_id')
    .eq('market_id', marketId);

  if (wErr) throw new Error(wErr.message);
  const userIds = (watchlistRows ?? []).map((r) => r.user_id as number);
  if (userIds.length === 0) return [];

  const { data: discordRows, error: dErr } = await supabaseAdmin
    .from('user_discord')
    .select('user_id, discord_user_id')
    .in('user_id', userIds)
    .eq('notifications_enabled', true);

  if (dErr) throw new Error(dErr.message);

  return ((discordRows ?? []) as Array<{ user_id: number; discord_user_id: string }>).map(
    (r) => ({ user_id: r.user_id, discord_user_id: r.discord_user_id }),
  );
}

async function fetchRecentAlerts(
  marketId: string,
  userIds: number[],
): Promise<Map<number, AlertLogRow>> {
  const since = new Date(Date.now() - DEDUP_WINDOW_HOURS * 3_600_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('user_market_alert_log')
    .select('user_id, price_at_alert, alerted_at')
    .eq('market_id', marketId)
    .in('user_id', userIds)
    .gte('alerted_at', since);

  if (error) throw new Error(error.message);

  const map = new Map<number, AlertLogRow>();
  for (const row of (data ?? []) as AlertLogRow[]) {
    // Keep the most recent entry per user
    const existing = map.get(row.user_id);
    if (!existing || existing.alerted_at < row.alerted_at) {
      map.set(row.user_id, row);
    }
  }
  return map;
}

// ─── Discord embed ───

interface PostAlertInput {
  webhookUrl: string;
  baseUrl: string;
  move: MoveRow;
  connected: ConnectedMarketRow[];
  mentionIds: string[];
}

async function postAlert({
  webhookUrl,
  baseUrl,
  move,
  connected,
  mentionIds,
}: PostAlertInput): Promise<boolean> {
  const deltaPoints = Math.round(move.price_delta * 100);
  const arrow = deltaPoints >= 0 ? '+' : '';
  const title = `${truncate(move.question || move.market_id, 80)} — moved ${arrow}${deltaPoints} points`;

  const description =
    `Price moved **${arrow}${deltaPoints} points** in the last ${DEFAULT_WINDOW_HOURS}h ` +
    `(${move.old_price.toFixed(2)} → ${move.current_price.toFixed(2)})` +
    (move.volume_24h != null ? `\nVolume 24h: ${formatMoney(move.volume_24h)}` : '');

  const connectedValue =
    connected.length === 0
      ? '_No strongly connected markets yet_'
      : connected
          .map((c) => {
            const direction =
              c.price_delta_24h == null
                ? ''
                : ` — moved ${c.price_delta_24h >= 0 ? '+' : ''}${Math.round(
                    c.price_delta_24h * 100,
                  )}pts`;
            return `• [${truncate(c.question, 70)}](${baseUrl}/market/${c.market_id})${direction}`;
          })
          .join('\n');

  const embed = {
    title,
    url: `${baseUrl}/market/${move.market_id}`,
    description,
    color: deltaPoints >= 0 ? 0x10b981 : 0xef4444,
    fields: [
      {
        name: '🌐 Connected markets (from constellation)',
        value: connectedValue,
      },
    ],
    footer: { text: 'Clearline • watchlist alert' },
    timestamp: new Date().toISOString(),
  };

  const content = mentionIds.map((id) => `<@${id}>`).join(' ');

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        embeds: [embed],
        allowed_mentions: { parse: ['users'] },
      }),
    });

    if (!res.ok) {
      console.error(
        `[watchlist-alerts] Discord webhook returned ${res.status}: ${await res.text().catch(() => '')}`,
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error('[watchlist-alerts] Discord webhook error:', err);
    return false;
  }
}

// ─── Helpers ───

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function formatMoney(n: number): string {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
}
