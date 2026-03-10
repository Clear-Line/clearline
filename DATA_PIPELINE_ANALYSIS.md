# Clearline Data Pipeline — Full Analysis & Diagnosis

## Executive Summary

Out of **1,000+ active markets** on Polymarket, only **~22 markets** get enough data to produce complete analytics. The result: most market detail pages show NULL metrics for VWAP, buy/sell ratio, smart money flow, and price reversion.

This is caused by a **cascading filter problem** — each pipeline stage filters out markets, and by the end, almost nothing is left.

---

## The Pipeline: How Data Flows

```
                         STAGE 1: Market Discovery
                         ─────────────────────────
                         Gamma API → 3,790 markets
                                   ↓
                    [Category filter: politics/economics/geopolitics]
                                   ↓
                         ~300 focused markets
                                   ↓
                    ┌──────────────┼──────────────┐
                    ↓              ↓              ↓
              STAGE 2A        STAGE 2B       STAGE 2C
              Snapshots       Order Books    Trades
              ─────────       ───────────    ──────
              market-poller   book-snap.     trade-monitor
              ↓               ↓              ↓
              ~1000 rows      ~31 updated    ~22 markets
              per cycle       per cycle      get trades
                    ↓              ↓              ↓
                    └──────────────┼──────────────┘
                                   ↓
                         STAGE 3: Analytics Engine
                         ────────────────────────
                         Computes 11 metrics per market
                         Evaluates coverage & publishability
                                   ↓
                         STAGE 4: Frontend
                         ────────────────
                         Market detail pages
                         (most metrics are NULL)
```

---

## Current State: Metric Coverage (from 1,000 sampled analytics rows)

| Metric | % Filled | Depends On |
|--------|----------|------------|
| momentum_1h/6h/24h | 72.5% | Snapshots (price data) |
| volatility_24h | 69.5% | 4+ snapshots |
| convergence_speed | 95.2% | Market end date |
| **price_reversion_rate** | **2.8%** | 8+ snapshots over 2h+ span |
| **vwap_24h** | **0.4%** | 2+ trades, $50+ volume |
| **buy_sell_ratio** | **0.4%** | 2+ trades |
| **smart_money_flow** | **0.0%** | Smart wallet trades (only 36 smart wallets exist) |
| book_imbalance | 77.4% | Order book data from CLOB API |
| liquidity_asymmetry | 21.2% | Both bid AND ask cost-to-move data |

**Overall: 1,883/3,176 rows publishable (59%), avg coverage score: 6.3/100**

---

## Problem 1: Trade Data Is Extremely Sparse

### The Bottleneck

The trade-monitor pipeline works like this:
1. Query `market_snapshots` for markets with `volume_24h > 100` → gets ~150 markets
2. Filter to `is_active = true` → keeps ~100 markets
3. For each market, call Polymarket Data API: `GET /trades?market={id}&limit=100`
4. API returns **empty array** for markets with no recent trading
5. Result: **only ~22 markets actually have trades to fetch**

### Why the Data API Returns Empty

Polymarket's `/trades` endpoint:
- Returns only the **most recent trades** (no date range parameter)
- Returns **empty `[]`** for markets with zero recent activity
- No pagination; just returns up to `limit` most recent trades
- No way to catch up on historical trades retroactively

### Impact

Without trades, these metrics are permanently NULL:
- `vwap_24h` — needs 2+ trades and $50+ USDC volume
- `buy_sell_ratio` — needs 2+ trades
- `smart_money_flow` — needs trades from smart wallets

**Current reality: Only 37 markets have VWAP data. Only 0 have smart money flow.**

---

## Problem 2: Smart Money Pipeline Is Broken

### The Chain

```
117K wallets in DB
       ↓
accuracy-computer: scores wallets on resolved market predictions
       ↓
~5K wallets have accuracy_sample_size > 3
       ↓
Filter: accuracy_score > 0.60
       ↓
36 "smart wallets"
       ↓
smart_money_flow: needs these wallets to have trades in a specific market
       ↓
0 markets have smart money data
```

### Why Only 36 Smart Wallets

1. **Resolved markets are rare**: Accuracy is computed only from markets that have resolved (closed with a winner). Most Polymarket markets stay open for months.
2. **Sample size requirement is high**: Need `accuracy_sample_size > 3` (4+ resolved trades). Most wallets have 0-2.
3. **Accuracy threshold is strict**: Need `accuracy_score > 0.60` (60%+ correct). With 4 trades, you need 3 correct — that's 75% accuracy minimum for the smallest sample.
4. **Tier1 signals are wasted**: The tier1-signals engine computes sophisticated behavior scores (conviction, entry timing, trade concentration) for 78K wallet-market pairs, but **none of this is used** for smart wallet detection. Only raw accuracy matters.

### The Math

- 117K wallets exist
- ~10K have any trades in resolved markets
- ~5K have 4+ trades in resolved markets
- ~500 have accuracy > 0.60
- Of those, only 36 have trades in currently-tracked markets
- Of those 36, even fewer trade in any specific market → **0% smart money coverage**

---

## Problem 3: Category Filter Is Too Narrow

### What Happens

The market-poller classifies markets by keyword matching:
```
"Trump" → politics
"Bitcoin" → crypto (EXCLUDED)
"Super Bowl" → sports (EXCLUDED)
"hurricane" → weather (EXCLUDED)
```

Only `politics`, `economics`, `geopolitics` pass through. This immediately drops **~70% of all Polymarket markets**.

### Impact on Downstream

- book-snapshotter: `.in('category', ['politics', 'economics', 'geopolitics', 'other'])` — slightly wider
- trade-monitor: queries `market_snapshots` → only finds snapshots from focused categories
- analytics-engine: queries markets with recent snapshots → same filter cascade

### The Numbers

| Stage | Markets |
|-------|---------|
| Gamma API total | 3,790 |
| After category filter | ~300 |
| After volume > 100 filter | ~150 |
| After is_active filter | ~100 |
| After Data API returns trades | ~22 |

---

## Problem 4: Order Book Data Has Gaps

### Why 77% book_imbalance but 21% liquidity_asymmetry

**book_imbalance** needs either bid OR ask depth:
- If CLOB API returns any book data, this computes

**liquidity_asymmetry** needs BOTH cost_move_up AND cost_move_down:
- cost_move calculations walk the order book to find the cost to move price 5%
- If the book is too shallow (not enough orders to move price 5%), returns null
- Both sides must succeed → much more restrictive

### CLOB API Failures

~23% of markets consistently return 404 from `clob.polymarket.com/book`:
- Market exists in Gamma but has no CLOB order book
- Market is resolved/delisted
- Token ID is stale or wrong
- Market trades only on AMM, not CLOB

---

## Problem 5: Stale Analytics Rows

887 analytics rows have `coverage_score = 0`. These are old rows computed before the coverage system was added. They need recomputation but the analytics engine only processes markets with recent snapshots (last 48h).

---

## Database Inventory

| Table | Row Count | Notes |
|-------|-----------|-------|
| markets | ~3,790 | All discovered markets |
| market_snapshots | 272,994 | Price + volume snapshots |
| market_analytics | 3,176 | Computed metrics (887 stale) |
| trades | 216,538 | Trade history |
| wallets | 117,046 | Wallet profiles |
| wallet_signals | 78,379 | Tier1 behavior scores |

---

## Root Cause Summary

| # | Problem | Severity | Impact |
|---|---------|----------|--------|
| 1 | **Only ~22 markets get trade data per cron cycle** | CRITICAL | VWAP, buy/sell, smart money all NULL for 97% of markets |
| 2 | **Smart wallet pool is 36 out of 117K (0.03%)** | CRITICAL | smart_money_flow is 0% filled |
| 3 | **Category filter drops 70% of markets** | HIGH | Limits entire pipeline to ~300 political markets |
| 4 | **Price reversion needs 8+ snapshots (16+ hours)** | MEDIUM | 2.8% coverage; slowly fills as crons accumulate |
| 5 | **Liquidity asymmetry needs deep books on both sides** | MEDIUM | 21% coverage; API limitation, can't fix |
| 6 | **887 stale analytics rows with score=0** | LOW | Visual clutter; recomputation needed |
| 7 | **Tier1 signals computed but unused for smart wallet detection** | HIGH | Wasted computation; 78K signals sitting idle |

---

## What Needs to Change

### Tier 1: Trade Coverage (the #1 problem)

The Polymarket Data API only returns recent trades. For markets with no activity, the API returns nothing. This cannot be fixed by calling the API differently — **the data simply doesn't exist for inactive markets**.

**Options:**
1. **Accept the reality**: Most Polymarket markets have very low activity. Only ~50-100 markets trade actively at any time.
2. **Widen the trade window**: Currently analytics uses 7-day trade window. Extending to 30 days would capture more markets that had occasional trades.
3. **Remove trade-dependent metrics from publishability**: Don't require VWAP/BSR/SMF for a market to be publishable. Show them when available, show "No recent trades" when not.
4. **Increase cron frequency for trades**: Run trade-monitor every 30min instead of 2h to catch more activity windows.

### Tier 2: Smart Money Overhaul

**Options:**
1. **Use tier1 signals instead of raw accuracy**: Replace `accuracy > 0.60` with `composite_score > 0.4` from wallet_signals. This already has 78K entries.
2. **Lower the bar**: `accuracy > 0.50` with `sample_size >= 2` would increase the pool 10x.
3. **Hybrid scoring**: `smart_score = 0.5 * accuracy + 0.5 * tier1_composite`. Use whichever is available.
4. **Percentile-based**: "Top 200 wallets by composite score" instead of fixed threshold.

### Tier 3: Category Filter

**Options:**
1. **Remove it entirely**: Process all 3,790 markets. The time budgets + batching will naturally prioritize high-volume markets.
2. **Expand to include 'crypto' and 'other'**: These are valid prediction markets with active trading.
3. **Dynamic prioritization**: Process all markets but sort by volume, so highest-volume markets get processed first within time budget.

### Tier 4: Metric Threshold Adjustments

| Metric | Current Threshold | Suggested |
|--------|-------------------|-----------|
| price_reversion | 8 snapshots, 120min span | 4 snapshots, 60min span |
| vwap_24h | 2 trades, $50 volume | 1 trade, $10 volume |
| buy_sell_ratio | 2 trades | 1 trade |
| smart_money_flow | 1 smart trade, $50 vol | Use tier1 wallets, $10 vol |
| liquidity_asymmetry | Both cost_move values | Accept one-sided data |

---

## Pipeline Execution Order & Timing

Current cron schedule (cron-job.org, every 2 hours):

```
markets  → books → trades → wallets → accuracy → tier1 (x3) → moves → analytics → positions → correlations → cleanup
```

All endpoints have 50s internal time budgets with self-retry (via Next.js `after()`).

### Current Timing (from live tests)

| Endpoint | Duration | Status |
|----------|----------|--------|
| /api/pipeline/markets | 38s | 3,790 upserted |
| /api/pipeline/books | 16s | 31 updated |
| /api/pipeline/trades | 11s | 1,035 trades from 41 markets |
| /api/pipeline/wallets | 0.8s | 4 updated |
| /api/pipeline/accuracy | 14s | 0 new resolutions |
| /api/analysis/tier1 | 15s | Already computed |
| /api/analysis/moves | 7s | 262 markets scanned |
| /api/pipeline/analytics | 13s | 995 computed |
| /api/pipeline/positions | 14s | 0 tracked |

None currently hit the 50s time budget — all complete in one pass.

---

## Code-Level Findings (Added March 10, 2026)

This section maps the observed behavior directly to the current codebase.

### 1) Confirmed: "100 trades only, no pagination"

- In `src/lib/pipeline/trade-monitor.ts` (line 76), every market calls:
  - `fetchMarketTrades(market.condition_id, 100)`
- In `src/lib/pipeline/polymarket.ts` (line 146), `fetchMarketTrades` only sends:
  - `market` + `limit` to `/trades` (line 150-154)
- There is no `offset` loop in either file, so the pipeline only pulls the newest page (max 100 rows) and never older pages.
- Upsert dedupes by `transaction_hash` with `ignoreDuplicates: true` in `trade-monitor.ts` (line 104), so repeated runs can re-read the same recent page and insert little/no new data.

**Impact**
- Historical trade coverage remains thin for many markets, even if those markets had substantial activity earlier.
- Metrics that need broad trade history (`vwap_24h`, `buy_sell_ratio`, `smart_money_flow`) remain sparse.

### 2) Confirmed: "429s drop markets"

- `trade-monitor.ts` uses `Promise.all` with `BATCH_SIZE = 10` (line 66), causing 10 concurrent `/trades` requests.
- On 429, catch block only logs error and increments telemetry (`marketsRateLimited`) in `trade-monitor.ts` (line 136-141).
- There is no per-market retry/backoff/jitter path inside `pollTrades`.
- Self-retry in `src/lib/pipeline/self-retry.ts` only triggers on `"Time budget reached"` (line 16-18), not on 429 bursts.
- Route response truncates errors to first 10 in `src/app/api/pipeline/trades/route.ts` (line 30), so the real rate-limit footprint can be under-reported in API output.

**Impact**
- Any market that 429s in that run contributes zero new trades.
- Coverage appears inconsistent run-to-run.

### 3) Additional code-level bottleneck: stale market selection input

- `trade-monitor.ts` selects candidates from `market_snapshots` with:
  - `.gt('volume_24h', 100)` and `.order('volume_24h')`
  - but no timestamp freshness filter.
- This can select markets that had high volume previously but are not currently active.

**Impact**
- Request budget gets spent on markets likely to return empty/low `/trades` pages now.

### 4) Additional code-level bottleneck: analytics trade horizon mismatch

- `analytics-engine.ts` uses a strict 7-day trade window (`sevenDaysAgo`) for flow metrics.
- Even when older trades exist in `trades`, they are ignored by analytics if outside that window.

**Impact**
- Flow metrics can stay null despite non-trivial historical trade data in the database.

### 5) Additional code-level bottleneck: smart-wallet gate is too narrow

- `analytics-engine.ts` defines smart wallets as:
  - `accuracy_score > 0.60` and `accuracy_sample_size > 3`
- Tier1 wallet signals are not used in this gate.

**Impact**
- Smart-wallet set remains tiny, so `smart_money_flow` almost never computes.

---

## End-to-End Fix Blueprint (Recommended)

### Phase A — Fix ingestion correctness first (highest priority)

1. **Add pagination to `/trades` ingestion**
- Update `fetchMarketTrades` to accept `{ limit, offset, takerOnly }`.
- In `pollTrades`, page until one of:
  - response length < limit,
  - max pages reached per market,
  - time budget threshold reached.
- Keep dedupe by `transaction_hash`.

2. **Add per-market retry with exponential backoff for 429**
- For each market page request:
  - retry up to 3 attempts,
  - backoff schedule (e.g., 250ms, 800ms, 2000ms + jitter).
- Reduce baseline concurrency from 10 to 3-5 (tunable).

3. **Make candidate market selection freshness-aware**
- Select only latest snapshot per market in last `X` hours (e.g., 6h).
- Rank by recency + volume, not volume-only from any age.

4. **Improve observability output**
- Return:
  - `marketsAttempted`, `marketsSucceeded`, `marketsRateLimited`,
  - `pagesFetched`, `retriesUsed`, `newTradesInserted`, `duplicateTradesSkipped`.
- Do not hard-truncate operational errors to 10 in debug mode; include counts by error code.

### Phase B — Align analytics with real market behavior

1. **Introduce dual trade windows**
- Keep `vwap_24h` for short-horizon truth.
- Add backup long-horizon variants (e.g., 7d/30d) for sparse markets.
- In API/frontend, show label: `24h` vs `30d` so semantics stay explicit.

2. **Relax thresholds where mathematically safe**
- `vwap_24h`: allow 1+ trade and low minimum notional.
- `buy_sell_ratio`: if one-sided only, return bounded proxy with low-confidence flag.
- `price_reversion_rate`: lower snapshot minimum (e.g., 4+ snapshots, 60m span) for thin markets.

3. **Smart money: hybrid score**
- Replace strict accuracy-only definition with:
  - `smart_score = 0.6 * tier1_composite + 0.4 * accuracy_component`
- Use percentile/rank-based inclusion (top N wallets) rather than hard fixed threshold.

### Phase C — Serving/data-quality contract

1. Keep raw analytics rows with nulls for diagnostics.
2. Serve only publishable metrics in product endpoints.
3. Include `dataQuality` payload:
- `coverageScore`
- `computedAt`
- `missingMetrics`
- `coverageByMetric`
4. UI should render "Insufficient recent data" rather than raw nulls.

---

## Concrete Code Changes by File

### `src/lib/pipeline/polymarket.ts`
- Extend `fetchMarketTrades` signature:
  - `limit`, `offset`, `takerOnly`
- Pass `offset` query param to `/trades`.

### `src/lib/pipeline/trade-monitor.ts`
- Replace single-page fetch with paginated loop.
- Add 429 retry/backoff logic around each page fetch.
- Lower default concurrency and make it configurable.
- Add telemetry fields for pages/retries/rate-limit counts.

### `src/lib/pipeline/self-retry.ts`
- Extend `shouldRetry` to include sustained rate-limit cases (e.g., high 429 ratio), not only time-budget messages.

### `src/app/api/pipeline/trades/route.ts`
- Return richer telemetry and summarized error histogram.
- Keep capped sample errors, but add full counts by code/class.

### `src/lib/analysis/analytics-engine.ts`
- Add longer fallback trade windows for sparse markets.
- Replace accuracy-only smart-wallet query with hybrid selection logic.
- Maintain metric-level status in `coverage_by_metric`.

---

## Expected Outcomes After Fixes

1. Higher and more stable trade ingestion per run.
2. Lower run-to-run variance from 429 bursts.
3. More markets with non-null trade-flow analytics.
4. Smart-money metrics available for a meaningful subset of markets.
5. Cleaner frontend behavior through explicit coverage states.

---

## Practical Implementation Order

1. Trade pagination + 429 retry/backoff.
2. Freshness-aware market candidate selection.
3. Telemetry/error reporting upgrades.
4. Analytics window/threshold tuning.
5. Smart-wallet hybrid scoring.
6. Final serving-layer and frontend quality-state cleanup.
