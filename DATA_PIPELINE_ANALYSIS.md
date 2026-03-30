# Clearline Data Pipeline — Current State

## Executive Summary
The current Clearline pipeline is no longer the older analytics-heavy batch system.

It has been simplified into a Railway worker that continuously builds a focused serving layer for the app:

- discover live Polymarket markets
- snapshot price / liquidity data
- ingest recent trades
- score wallets
- build `market_cards`

The terminal and alerts now depend primarily on `market_cards`, not on `market_analytics`, `market_edge`, or the older long-chain analysis pipeline.

## Current Architecture

```text
Gamma API + CLOB API + Data API
          ↓
Railway worker (`pipeline-worker/src/worker.ts`)
          ↓
Supabase `markets`
BigQuery `market_snapshots`
BigQuery `trades`
BigQuery `wallets`
BigQuery `wallet_signals`
BigQuery `market_cards`
          ↓
Next.js API routes
          ↓
Homepage preview, Terminal, Alerts, Wallets, Market Detail
```

## Active Worker Jobs

### Ingestion — every 5 minutes
- `market-discovery`
- `book-fetcher`
- `trade-fetcher`

### Enrichment — every 30 minutes
- `accuracy`
- `wallet-profiler`

### Intelligence — every 10 minutes
- `smart-money-scanner`

This is the current production pipeline.

## Core Serving Table: `market_cards`
`market_cards` is now the main intelligence artifact.

It powers:
- `/terminal`
- `/alerts`
- the homepage live preview

Each row is a scored market summary that includes:
- current price
- 24h price change
- volume
- liquidity
- spread
- smart buy volume
- smart sell volume
- smart wallet count
- `BUY` / `SELL` / `NEUTRAL` signal
- signal confidence

## Why Terminal Market Count Can Be Low
The terminal does not show “all Polymarket markets.”

It shows however many rows currently exist in `market_cards`, up to the API limit requested by the frontend.

The scanner currently filters markets before writing cards:
- must have a recent snapshot
- must have `volume_24h > 0`
- must exist in Supabase as active metadata
- must be in focused categories
- must have current price between `0.01` and `0.99`

So a low terminal count usually means:
- the table currently contains few qualifying rows
- the new worker has not yet accumulated broad enough coverage
- the current inclusion rules are intentionally narrow

## What Changed From The Old Pipeline
The older pipeline and docs described:
- many Vercel cron routes
- `market_analytics`
- `market_edge`
- `market_correlations`
- `wallet_positions`
- flagged-move and publishability scoring as primary app inputs

That is no longer the live product path.

Today the live path is:

`Polymarket -> worker -> market_cards -> app`

The older modules may still exist in the repo, but they are not the main serving layer for the current terminal + alerts experience.

## Current Strengths

### 1. Simpler serving path
The app is easier to reason about because terminal and alerts both read from the same precomputed table.

### 2. Faster UI queries
Instead of assembling many metrics on request, the worker does the aggregation ahead of time.

### 3. Clear intelligence focus
The product is now built around smart-money signals instead of a broad but partially filled analytics matrix.

### 4. Better operational fit for Railway
The worker owns scheduling, retries, and health checks in one place.

## Current Limitations

### 1. `market_cards` is still too selective
The scanner favors a small focused set of markets.
This makes the terminal feel sparse when the table has limited coverage.

### 2. Smart-wallet detection is still narrow
Wallet quality currently leans heavily on resolved-market accuracy and recent trade participation.
That is useful, but not yet a best-in-class participant model.

### 3. Trade sparsity remains structural
Many Polymarket markets simply do not trade often enough to produce strong signal quality.
This limits conviction unless the market is liquid and active.

### 4. Legacy analytics tables still exist
They can create confusion during development because they suggest a broader active system than what the app currently uses.

## Current Table Roles

### Supabase
- `markets`
  - source of metadata and resolution state

### BigQuery
- `market_snapshots`
  - recent market state and historical snapshots
- `trades`
  - recent trade flow
- `wallets`
  - wallet profiling and credibility
- `wallet_signals`
  - tier-1 wallet behavior scores
- `market_cards`
  - serving layer for terminal and alerts

## Operational Notes

### Worker runtime
- located in `pipeline-worker/`
- started with `tsx src/worker.ts`
- deployed on Railway
- health endpoint served on `/`

### Root app
- Next.js app in repo root
- reads from internal API routes that query BigQuery and Supabase

## What To Improve Next
If the goal is to make Clearline “the data is the best,” the next level is not another generic analytics table.

The next level is:

1. better wallet-quality modeling
2. market-quality / trustworthiness scoring
3. more explanatory alerts
4. richer market detail with conviction context
5. broader but still high-signal `market_cards` coverage

Practical next steps:

### 1. Upgrade participant scoring
Go beyond plain win rate:
- category-specific accuracy
- entry timing quality
- realized PnL
- recency weighting
- hold-time behavior

### 2. Build market quality scoring
Score:
- spread
- depth
- liquidity
- concentration
- snapshot consistency
- rule / resolution clarity

### 3. Add explanation fields to `market_cards`
Instead of only `BUY` or `SELL`, store a short explanation:
- who moved it
- what changed
- why it is credible

### 4. Expand the serving layer carefully
If terminal coverage is too low, widen inclusion rules deliberately rather than dumping all markets into the terminal.

Examples:
- include more categories
- allow lower volume thresholds
- keep separate “focus” and “broad” terminal modes

---

## Data Storage & Retention — Current State (2026-03-30)

### BigQuery Tables Overview

| Table | Partitioned | Clustered By | Retention | Purge Freq | Approx Rows/Day |
|-------|-------------|-------------|-----------|------------|-----------------|
| `market_snapshots` | `DATE(timestamp)` | `market_id` | **3 days** | Every 6h | ~15k–30k |
| `trades` | `DATE(timestamp)` | `market_id, wallet_address` | **3 days** | Every 6h | ~10k–50k |
| `market_cards` | None | None | **7 days** | Every 6h | ~500–2k |
| `wallets` | None | `address` | **Forever** | Never | Grows slowly (~50/day) |
| `wallet_signals` | `DATE(computed_at)` | `wallet_address, market_id` | **Forever** | Never | ~1k–5k |
| `markets` | None | None | **Forever** | Never | Grows slowly |

### Job Frequencies (Cost-Optimized v2.1)

| Job | Frequency | BigQuery Impact |
|-----|-----------|-----------------|
| `market-discovery` | Every 30 min | Low — mostly API calls + upserts |
| `book-fetcher` | Every 30 min | Medium — reads 500 snapshots, fetches books, upserts |
| `trade-fetcher` | Every 30 min | Medium — reads 1000 snapshots, fetches trades for 200 markets |
| `accuracy` | Every 6 hours | Low-Medium — reads trades (3-day filter), resolves markets |
| `wallet-profiler` | Every 6 hours | Medium — reads trades (3-day filter) for up to 1000 wallets |
| `smart-money-scanner` | Every 2 hours | Medium — reads snapshots, trades, wallets, writes cards |
| `data-purge` | Every 6 hours | Low — DELETE operations |

### Query Volume Caps Per Job Run

| Job | Key Limits |
|-----|-----------|
| `book-fetcher` | 500 markets max |
| `trade-fetcher` | 1000 snapshots → 200 unique markets, 2 pages × 100 trades each |
| `accuracy` | 1000 unresolved markets/page, trades filtered to 3 days |
| `wallet-profiler` | 1000 wallets max, trades filtered to 3 days, batch of 200 |
| `smart-money-scanner` | 500 smart wallets, 500 market candidates |

### API Route Query Costs

| Route | What It Reads | Limits | Partition Filter |
|-------|--------------|--------|-----------------|
| `GET /api/markets` | `market_cards` | 1000 max | None (small table) |
| `GET /api/markets/[id]` | `market_cards` + `market_snapshots` + `trades` | 50 snapshots, 500 trades | **None on trades** ⚠️ |
| `GET /api/alerts/feed` | `market_cards` | 50 | None (small table) |
| `GET /api/wallets` | `wallets` + `trades` + `markets` | 200 wallets, trades 3-day filter | Yes (trades) |
| `GET /api/wallets/[address]` | `wallets` + `trades` + `markets` + `market_cards` | 500 trades, 3-day filter | Yes (trades) |

### Cost Drivers (Ranked)

1. **`wallet-profiler` enrichment** — Even with 3-day filter, scanning trades for 1000 wallets in batches of 200 is the heaviest recurring job
2. **`smart-money-scanner`** — Reads snapshots (24h window), trades, wallets, then writes cards. Runs every 2h.
3. **`trade-fetcher`** — 200 markets × 2 pages × frequent runs = lots of small reads + writes
4. **`/api/markets/[id]` route** — No timestamp filter on trades query, scans all trades for a market
5. **Non-partitioned tables** (`wallets`, `markets`, `market_cards`) — Always full table scan regardless of filters

### What's Stored Forever (Growing)

- **`wallets`** — Every wallet ever profiled. Currently not purged. Will grow indefinitely.
- **`wallet_signals`** — Partitioned by `computed_at` but never purged. Will accumulate.
- **`markets`** — Every market discovered. Never purged. Growth is slow but permanent.

---

## Budget-Constrained MVP Plan

### Current Reality
- **$10/day was the peak** before cost-optimization pass
- **Target: <$1/day** for MVP phase (no paying users yet)
- BigQuery free tier: 1 TB queries/month, 10 GB storage free
- At $5/TB scanned, need to stay under ~6 GB/day of scans

### Recommended MVP Retention Settings

| Table | Current | Recommended MVP | Rationale |
|-------|---------|----------------|-----------|
| `market_snapshots` | 3 days | **3 days** ✅ | Already tight. Partition pruning works. |
| `trades` | 3 days | **3 days** ✅ | Already tight. Partition pruning works. |
| `market_cards` | 7 days | **3 days** | Only latest matters for terminal. 7 days is waste. |
| `wallets` | Forever | **Keep but cap at 5k rows** | Purge wallets with <2 trades and no activity in 30 days |
| `wallet_signals` | Forever | **3 days** | Historical signals have no current use. Add purge. |
| `markets` | Forever | **Keep** | Small table, metadata is cheap, needed for joins |

### Recommended MVP Job Frequencies

| Job | Current | Recommended MVP | Savings |
|-----|---------|----------------|---------|
| `market-discovery` | Every 30 min | **Every 1 hour** | 50% fewer runs |
| `book-fetcher` | Every 30 min | **Every 1 hour** | 50% fewer runs |
| `trade-fetcher` | Every 30 min | **Every 1 hour** | 50% fewer runs |
| `accuracy` | Every 6 hours | **Every 12 hours** | 50% fewer runs |
| `wallet-profiler` | Every 6 hours | **Every 12 hours** | 50% fewer runs |
| `smart-money-scanner` | Every 2 hours | **Every 4 hours** | 50% fewer runs |
| `data-purge` | Every 6 hours | **Every 6 hours** ✅ | Keep — purging saves storage cost |

### Recommended MVP Query Caps

| Setting | Current | Recommended MVP |
|---------|---------|----------------|
| `book-fetcher` markets | 500 | **200** |
| `trade-fetcher` snapshots | 1000 | **500** |
| `trade-fetcher` unique markets | 200 | **100** |
| `smart-money-scanner` wallet pool | 500 | **200** |
| `smart-money-scanner` market candidates | 500 | **200** |
| `wallet-profiler` max wallets | 1000 | **500** |
| `/api/markets/[id]` trades | 500 (no timestamp filter) | **200 + add 3-day filter** |

### Critical Fix Still Needed
**`/api/markets/[id]/route.ts`** — The trades query has NO timestamp filter. Every page view of a market detail page scans the entire `trades` table for that market. Add `.gte('timestamp', threeDaysAgo)` to match all other routes.

### Scaling Plan (Post-MVP)
When revenue justifies it, increase in this order:
1. **Job frequencies first** — more frequent = fresher data, biggest UX improvement
2. **Query caps second** — more markets/wallets covered
3. **Retention last** — longer history enables historical features (PnL charts, trend analysis)

Target tiers:
- **Free tier (<$1/day):** Current MVP settings above
- **Growth ($5/day):** 15-min ingestion, 1-hour enrichment, 7-day retention, 1000 wallet pool
- **Scale ($20/day):** 5-min ingestion, 30-min enrichment, 14-day retention, full wallet coverage

---

## Bottom Line
The current pipeline is simpler, more coherent, and closer to production than the earlier architecture.

The main serving story is now:

`recent market data + recent trade flow + wallet quality -> smart-money market cards`

That is the correct thing to document, build on, and optimize from here.
