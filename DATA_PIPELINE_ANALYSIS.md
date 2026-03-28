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

## Bottom Line
The current pipeline is simpler, more coherent, and closer to production than the earlier architecture.

The main serving story is now:

`recent market data + recent trade flow + wallet quality -> smart-money market cards`

That is the correct thing to document, build on, and optimize from here.
