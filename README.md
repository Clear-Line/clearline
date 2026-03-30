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
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_PRICE_ID`
- `STRIPE_WEBHOOK_SECRET`
- `CLERK_WEBHOOK_SECRET`
- `NEXT_PUBLIC_APP_URL` (optional locally, recommended in production)

Worker-only:
- `PORT`

## Billing And Auth Setup

The app now has these integration paths:
- Clerk handles sign-in/sign-up and route protection.
- Stripe Checkout creates subscriptions at `/api/stripe/checkout`.
- Stripe Billing Portal is available at `/api/stripe/portal`.
- Clerk webhooks write users into Supabase at `/api/webhooks/clerk`.
- Stripe webhooks update subscription status in Supabase at `/api/webhooks/stripe`.

Important implementation detail:
- The app no longer hard-depends on the Clerk webhook to create a user row. If the webhook is delayed or missing, authenticated requests can create the Supabase `users` record lazily.

## Vercel Deploy Notes

Use these settings in Vercel:
- Install command: `pnpm install`
- Build command: `pnpm build`

Make sure the Vercel project has the same env vars as `.env.local`, especially:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_PRICE_ID`
- `STRIPE_WEBHOOK_SECRET`
- `CLERK_WEBHOOK_SECRET`

After deploy, update external dashboards to point at your production domain:
- In Clerk, set the app domain and webhook target to `https://<your-domain>/api/webhooks/clerk`.
- In Stripe, set the webhook target to `https://<your-domain>/api/webhooks/stripe`.
- In Stripe, make sure `STRIPE_PRICE_ID` is the recurring price you want Checkout to sell.

## Current State
The project has already moved away from the older large analytics stack.

The live product today is focused on:
- market discovery
- live market snapshots
- recent trade flow
- wallet scoring
- smart-money signal generation

If you are updating docs or building new features, use `market_cards` and the Railway worker as the current source of truth.
