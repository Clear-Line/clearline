# Clearline — Next Steps

## Current State
- Data pipelines working: markets, trades, books, wallet profiler
- 4 Supabase tables populated: `markets`, `market_snapshots`, `trades`, `wallets`
- Frontend fully built but using mock data
- `flagged_moves` table empty — no detection engine yet

## Pipeline Endpoints
| Endpoint | What it does | Status |
|----------|-------------|--------|
| `/api/pipeline/markets` | Fetches active markets + price snapshots | Working |
| `/api/pipeline/trades` | Fetches recent trades per market | Working |
| `/api/pipeline/books` | Fetches order book depth/spread | Working |
| `/api/pipeline/wallets` | Aggregates wallet stats from trades | Working |

## Next Steps (in priority order)

### 1. Tier 1 Signals — Wallet-Level Detection
Score each wallet on suspicious behavior:
- Historical accuracy (win rate on resolved markets)
- Market concentration (% of trades in one market)
- Position size relative to market volume
- Entry timing (trades before big price moves)
- Conviction behavior (accumulation patterns)

### 2. Move Detection Engine (Tier 2-3)
Flag suspicious trading patterns → populate `flagged_moves`:
- Detect large trades before price spikes
- Cross-wallet coordination analysis
- Compute credibility score (0-100) per flag
- Generate summary text explaining each flag

### 3. Connect Frontend to Real Data
Replace mock data with Supabase queries:
- Dashboard: real markets + snapshots
- Wallet page: real wallet stats
- Market detail: real trades + flagged moves

### 4. External Catalyst Matching
Correlate price moves with external events:
- News API integration
- Poll data from aggregators
- Time-window correlation with detected moves

### 5. Automation
- Set up cron jobs (GitHub Actions or external service)
- Auto-cleanup of old data to stay within Supabase free tier

## Notes
- Trades endpoint fetches 50 per market (API max is 500, can increase)
- 429 rate limit errors are normal — missed markets get picked up next run
- Supabase free tier: 500MB storage, currently using ~10MB
