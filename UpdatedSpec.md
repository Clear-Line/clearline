# Clearline — Current Technical Specification

## 1. Purpose
This document describes the current production-oriented architecture of Clearline after the pipeline simplification.

It replaces the earlier spec that described a much larger analytics platform with many inactive layers. The current system is narrower and more operational:
- ingest live Polymarket market data
- score wallets
- generate smart-money market cards
- serve those cards to the terminal and alerts UI

## 2. Product Definition
Clearline is a Polymarket intelligence product built around three user-facing surfaces:

1. **Terminal**
   A live market-scanning interface powered by precomputed `market_cards`

2. **Alerts**
   A feed of `BUY` / `SELL` smart-money signals derived from wallet activity and market context

3. **Wallet Intelligence**
   A leaderboard and detail surface for active wallets, using accuracy, recent trades, and composite behavior scores

There is also a public marketing homepage at `/` that explains the product and routes users into the terminal.

## 3. System Architecture

```text
Polymarket APIs
  ├─ Gamma API (market discovery)
  ├─ CLOB API (book / pricing)
  └─ Data API (trades / wallet activity)
          ↓
Railway Pipeline Worker
  ├─ market-discovery
  ├─ book-fetcher
  ├─ trade-fetcher
  ├─ accuracy
  ├─ wallet-profiler
  └─ smart-money-scanner
          ↓
Storage
  ├─ Supabase: markets metadata + resolution state
  └─ BigQuery: snapshots, trades, wallets, wallet_signals, market_cards
          ↓
Next.js App
  ├─ homepage
  ├─ terminal
  ├─ alerts
  ├─ wallets
  └─ market detail
```

## 4. Deployment Model

### Frontend
- Next.js 16 app in the repo root
- Reads from Supabase and BigQuery through internal API routes

### Pipeline
- TypeScript worker in `pipeline-worker/`
- Deployed on Railway
- Uses `node-cron` internally
- Exposes `/` health check for Railway

Relevant files:
- `pipeline-worker/src/worker.ts`
- `pipeline-worker/railway.toml`

## 5. Data Stores

### 5.1 Supabase
Clearline currently uses Supabase primarily for market metadata and resolution tracking.

Active table:
- `markets`
  - `condition_id`
  - `question`
  - `category`
  - `outcomes`
  - `clob_token_ids`
  - `start_date`
  - `end_date`
  - `is_active`
  - `is_resolved`
  - `resolved_outcome`

### 5.2 BigQuery
BigQuery is the primary analytical and serving store.

Active tables in the current product path:

- `market_snapshots`
  - point-in-time price and liquidity history

- `trades`
  - recent market trade flow by wallet

- `wallets`
  - wallet-level profiling, accuracy, PnL, credibility

- `wallet_signals`
  - per-wallet / per-market behavioral scoring

- `market_cards`
  - current serving table for terminal and alerts

Legacy tables may still exist in migrations or old setup files, but they are not the main serving path for the live app.

## 6. Pipeline Jobs

### 6.1 Market Discovery
File:
- `pipeline-worker/src/ingestion/market-discovery.ts`

Responsibilities:
- pull active market metadata from Gamma
- classify categories
- upsert Supabase `markets`
- insert fresh `market_snapshots`

### 6.2 Book Fetcher
File:
- `pipeline-worker/src/ingestion/book-fetcher.ts`

Responsibilities:
- fetch order-book data
- enrich snapshots with spread / liquidity context

### 6.3 Trade Fetcher
File:
- `pipeline-worker/src/ingestion/trade-fetcher.ts`

Responsibilities:
- ingest recent trade flow from Polymarket
- upsert `trades`
- ensure participating wallets exist in `wallets`

### 6.4 Accuracy Computer
File:
- `pipeline-worker/src/enrichment/accuracy-computer.ts`

Responsibilities:
- detect resolved markets from Gamma
- mark Supabase `markets` as resolved
- compute wallet accuracy on resolved markets

### 6.5 Wallet Profiler
File:
- `pipeline-worker/src/enrichment/wallet-profiler.ts`

Responsibilities:
- compute trade counts
- compute total traded volume
- compute total markets traded
- compute credibility and realized PnL
- consume `wallet_signals` where available

### 6.6 Smart Money Scanner
File:
- `pipeline-worker/src/intelligence/smart-money-scanner.ts`

Responsibilities:
- read recent snapshots, trades, and wallet scores
- aggregate smart-wallet activity by market
- produce one `market_cards` row per qualifying market

This job is the current intelligence core of the product.

## 7. `market_cards` Serving Model
`market_cards` is the critical table that powers both the terminal and alerts.

Each row includes:
- market id
- title
- category
- end date
- current price
- 24h-ago price
- price change
- 24h volume
- liquidity
- spread
- signal (`BUY`, `SELL`, `NEUTRAL`)
- signal confidence
- smart buy volume
- smart sell volume
- smart wallet count
- top smart wallets
- computed timestamp

### Inclusion Rules
The smart-money scanner currently writes cards only for markets that:
- have recent snapshots
- have recent non-zero volume
- exist as active markets in Supabase
- fall into focused categories
- are not near fully resolved prices (`<= 0.01` or `>= 0.99`)

This means the size of the terminal is determined by the scanner and available data, not by the frontend alone.

## 8. Frontend Surfaces

### `/`
Marketing homepage that explains the product and previews live terminal data

### `/terminal`
Primary product UI for market scanning

### `/alerts`
Smart-money signal feed based on `market_cards`

### `/wallets`
Wallet leaderboard backed by `wallets`, `wallet_signals`, and recent `trades`

### `/market/[id]`
Market detail route that joins:
- Supabase `markets`
- BigQuery `market_cards`
- BigQuery `market_snapshots`
- BigQuery `trades`
- BigQuery `wallets`

## 9. Current API Routes

- `src/app/api/markets/route.ts`
  - returns terminal feed from `market_cards`

- `src/app/api/markets/[id]/route.ts`
  - returns market detail payload

- `src/app/api/alerts/feed/route.ts`
  - returns alert feed from `market_cards`

- `src/app/api/wallets/route.ts`
  - returns wallet leaderboard and recent activity

## 10. Current Constraints
The simplified architecture has tradeoffs:

1. `market_cards` is intentionally selective
   - the product currently favors cleaner, more liquid, more interpretable markets over complete market coverage

2. wallet quality still leans heavily on resolved-market accuracy
   - this works, but it is not yet a full participant-quality model

3. sparse trades remain a structural limitation on many Polymarket markets
   - low-activity markets naturally produce weaker intelligence

4. several legacy analytics modules still exist in the repo
   - they are not the main serving path today

## 11. Recommended Direction
The next analytical step for Clearline is not more UI chrome. It is deeper conviction modeling.

Priority improvements:

1. add better participant-quality scoring
2. add market quality / trustworthiness scoring
3. add open-interest / holder / position context
4. turn alerts into explanatory theses, not just `BUY` / `SELL` badges
5. track forward performance and calibration of every signal

That direction fits the current architecture and compounds the value of the Railway worker rather than replacing it.
