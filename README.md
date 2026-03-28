# Clearline

Clearline is a Polymarket intelligence product with:
- a marketing homepage at `/`
- a live terminal at `/terminal`
- smart-money alerts at `/alerts`
- wallet intelligence at `/wallets`

The repo includes both the frontend app and the Railway pipeline worker that powers it.

## Architecture

### App
The root project is a Next.js 16 app that reads from:
- Supabase for market metadata
- BigQuery for serving and analytics tables

Key serving routes:
- `src/app/api/markets/route.ts`
- `src/app/api/markets/[id]/route.ts`
- `src/app/api/alerts/feed/route.ts`
- `src/app/api/wallets/route.ts`

### Pipeline
`pipeline-worker/` is a separate TypeScript worker deployed on Railway.

It runs six active jobs:
- `market-discovery`
- `book-fetcher`
- `trade-fetcher`
- `accuracy`
- `wallet-profiler`
- `smart-money-scanner`

The core serving output is `market_cards`, which powers the terminal and alerts.

## Data Stores

### Supabase
Active table used by the current app / worker:
- `markets`

### BigQuery
Active tables used by the current app / worker:
- `market_snapshots`
- `trades`
- `wallets`
- `wallet_signals`
- `market_cards`

## Local Development

### App
```bash
pnpm install
pnpm dev
```

### Worker
```bash
cd pipeline-worker
npm install
npm run dev
```

## Environment Variables

Shared variables:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GCP_PROJECT_ID`
- `BQ_DATASET`
- `GCP_CREDENTIALS`

App-only:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`

Worker-only:
- `PORT`

## Current State
The project has already moved away from the older large analytics stack.

The live product today is focused on:
- market discovery
- live market snapshots
- recent trade flow
- wallet scoring
- smart-money signal generation

If you are updating docs or building new features, use `market_cards` and the Railway worker as the current source of truth.
