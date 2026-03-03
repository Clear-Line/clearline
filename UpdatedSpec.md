# Clearline Terminal — Technical Specification & System Architecture

## Document Purpose

This document is the single source of truth for the Clearline Terminal project. It defines what Clearline is, how the system works end-to-end, what every component does, what data flows where, and how to build each piece. Written for human developers and AI coding agents alike.

---

## 1. What Clearline Is

Clearline Terminal is the first professional-grade intelligence and analytics platform for prediction markets — the Bloomberg Terminal for Polymarket.

Clearline does NOT predict outcomes. Clearline does NOT execute trades (in MVP). Clearline does NOT identify or doxx individuals behind wallet addresses.

Clearline provides three core capabilities:

1. **Market Intelligence** — Real-time monitoring with proprietary credibility scores, insider activity detection, and diagnostic breakdowns answering "should I trust this price?"

2. **Quantitative Analytics** — Wall Street quant-finance metrics adapted for prediction markets: momentum, volatility, order flow, correlation, liquidity modeling, expected value computation.

3. **Portfolio Management** — Connect your Polymarket wallet for position tracking, P&L, diversification metrics, risk assessment, and alerts when held markets show suspicious activity.

---

## 2. The Problem

Prediction markets are increasingly treated as authoritative probability sources. Polymarket processed over $3.5B in volume during the 2024 election cycle. But the analytical infrastructure is zero. No terminal. No screening tools. No portfolio analytics. No systematic way to assess price trustworthiness.

Today a participant must: check Polymarket.com for raw prices, scroll Twitter for whale commentary, query Dune Analytics with SQL for on-chain data, check FiveThirtyEight for polling, and manually track positions. Clearline unifies everything.

### Documented Insider Cases
1. **Maduro Capture Market (Jan 2026):** ~$32k turned to ~$400k before operation went public
2. **Israeli Military Strike Bets (2025-2026):** Led to arrests; classified intelligence alleged
3. **Super Bowl Halftime Props:** Single account predicted nearly all outcomes correctly
4. **Nobel Peace Prize Spike (2025):** Odds shifted dramatically before announcement

---

## 3. System Architecture

```
Layer 1: Data Ingestion (Polymarket APIs + External Sources)
    ↓
Layer 2: Storage & Indexing (PostgreSQL + Redis)
    ↓
Layer 3: Analytics Engine (Wallet Profiling, Quant Metrics, Detection)
    ↓
Layer 4: Intelligence Generation (Scores, Diagnostics, Signals)
    ↓
Layer 5: Application Backend (FastAPI REST + WebSocket)
    ↓
Layer 6: Frontend Terminal (React/Next.js)
```

---

## 4. Polymarket API Ecosystem

### 4.1 Gamma API — Market Discovery
- **URL:** `https://gamma-api.polymarket.com`
- **Auth:** None | **Rate:** ~1000 req/hr
- Key endpoints: `GET /events`, `GET /markets`, `GET /tags`
- Key fields: `outcomePrices` (current probability), `clobTokenIds` (for CLOB queries), `conditionId` (primary key), `volume24hr`

### 4.2 CLOB API — Order Book & Pricing
- **URL:** `https://clob.polymarket.com`
- **Auth:** None for reads | **Rate:** ~1000 req/hr
- Key endpoints: `GET /book`, `POST /books` (batch), `GET /midpoint`, `GET /spread`, `GET /prices-history`
- Book returns `bids[]` and `asks[]` with `price` and `size`. Size in tokens; USD = size × price.

### 4.3 Data API — Wallet Positions, Trades, Activity
- **URL:** `https://data-api.polymarket.com`
- **Auth:** None | **Most important API for Clearline**
- Key endpoints: `GET /positions`, `GET /trades`, `GET /activity`, `GET /holders`
- Activity params: `user` (required), `market`, `type` (TRADE,SPLIT,MERGE,REDEEM), `start`, `end`, `side`, `sortBy`

### 4.4 WebSocket — Real-Time
- **URL:** `wss://ws-subscriptions-clob.polymarket.com/ws/`
- Subscribe: `{ "type": "subscribe", "channel": "market", "assets_id": "TOKEN_ID" }`

### 4.5 Polygonscan — Wallet On-Chain Data
- **URL:** `https://api.polygonscan.com/api`
- **Auth:** Free API key | **Rate:** 5/sec
- Used for wallet creation dates + funding source tracing. Cache permanently.

---

## 5. Complete Metrics Framework

### 5.1 TIER 1: Wallet Behavior Signals
Computed per wallet, per trade, automatically.

**5.1.1 Wallet Age Delta**
Time between wallet creation and first trade in target market.
Scoring: <1hr=1.0, <24hr=0.85, <7d=0.6, <4wk=0.3, >1mo=0.1, >6mo=0.0

**5.1.2 Trade Concentration**
% of wallet's total PM volume in single market.
Scoring: >95%=1.0, 80-95%=0.8, 70-80%=0.6, 50-70%=0.3, <50%=0.0

**5.1.3 Position Size Relative to Market**
Trade size / market's 7-day avg daily volume.
Scoring: >25%=1.0, 10-25%=0.7, 5-10%=0.4, 1-5%=0.15, <1%=0.0

**5.1.4 Conviction Behavior**
Three patterns: Accumulation (buying dips), Scaling In (incremental entry), Hold Through Dip (no selling during 10%+ drawdown).
Score: 0.4×accumulation + 0.3×scaling + 0.3×hold

**5.1.5 Entry Timing**
Volume timing anomaly (trading during quiet periods) + pre-catalyst timing (trading before identifiable public events).
Pre-catalyst entries from fresh wallets = strongest single signal.

**5.1.6 Historical Accuracy**
Win rate on resolved markets, weighted by entry timing.

**5.1.7 Composite Wallet Score (0.0–1.0)**
```
composite = age_delta×0.25 + concentration×0.20 + size×0.20 + conviction×0.15 + timing×0.20
```
Wallets with composite > 0.5 are "flagged."

### 5.2 TIER 2: Cross-Wallet Pattern Detection

**5.2.1 Signal Clustering** — Count of flagged wallets betting same direction in 72hr window. Score = count × avg strength.

**5.2.2 Behavioral Fingerprinting** — DBSCAN clustering on behavioral vectors (trading hour, avg size, market sequence). Catches Sybil/wallet recycling.

**5.2.3 Funding Source Correlation** — Multiple wallets funded from same address. Strongest Sybil signal.

**5.2.4 Cross-Market Position Mapping** — Flagged wallets with correlated positions across related markets suggesting coherent information narrative.

### 5.3 TIER 3: Market-Level Intelligence

**5.3.1 Market Credibility Score (0–100)**
```
credibility = unique_traders×20 + wallet_diversity×15 + book_depth×20 + spread×10 + volume_consistency×15 + (100-informed_activity)×0.20
```
Green ≥70. Yellow 40-69. Red <40.

**5.3.2 Informed Activity Index (0–100)** — Flagged volume share × avg flag strength.

**5.3.3 Catalyst Attribution** — EXPLAINED (matching poll/news/event) or UNEXPLAINED.

**5.3.4 Evasion Sophistication Score** — Quantifies effort to disguise activity. Higher evasion = more likely real info.

### 5.4 TIER 4: Quantitative Trading Metrics

#### Price Behavior
**5.4.1 Implied Probability Momentum** — Linear regression slope of price over 6h/24h/3d/7d windows. Source: market_snapshots.

**5.4.2 Convergence Speed** — |price-0.50| / days_to_resolution, tracked over time. Acceleration = new information.

**5.4.3 Prediction Market Volatility Index (PMVI)** — Std dev of price changes over rolling 24h. High vol+high volume=info discovery. High vol+low volume=noise. Low vol+volume spike=someone knows.

**5.4.4 Price Reversion Rate** — % of move that reverts in 6/12/24/48 hours. Insider moves revert less than noise.

#### Order Book
**5.4.5 Book Imbalance** — (total_bids-total_asks)/(total_bids+total_asks). Range -1 to +1. Positive=buying pressure.

**5.4.6 Liquidity Asymmetry** — Cost to move price up 5¢ vs down 5¢. Identifies directional vulnerability.

**5.4.7 Order Book Refill Rate** — Time for depth to restore after large trade. Fast=credible. Slow=fragile.

#### Volume & Flow
**5.4.8 Smart Money Flow Index** — Net directional volume from high-accuracy wallets vs retail. Divergence = smart money likely correct.

**5.4.9 VWAP** — sum(price×size)/sum(size). Price above VWAP=overextended. Below=potential value.

**5.4.10 Volume Profile** — Volume distribution across price levels. High-volume zones = support/resistance.

**5.4.11 Buy/Sell Ratio** — buy_vol/(buy_vol+sell_vol). >0.6=buying pressure. <0.4=selling pressure.

**5.4.12 Volume Spike Ratio** — Current volume / historical avg. >3x = something happening.

#### Cross-Market
**5.4.13 Correlation Matrix** — Rolling 7d correlations between markets. Isolated moves (no correlation) suggest insider info.

**5.4.14 Arbitrage Detection** — Mathematical inconsistencies between related markets.

**5.4.15 Contagion Speed** — Time lag between correlated market moves. Tradeable: use leader to predict laggard.

#### Time-Based
**5.4.16 Time Decay Curve** — Expected convergence vs actual. Ahead of schedule = early information.

**5.4.17 Day/Hour Patterns** — Systematic volume/volatility/direction patterns by time.

**5.4.18 Resolution Proximity Effect** — How dynamics change approaching resolution. Insider spike in final 72hr = follow the move.

#### Portfolio-Level
**5.4.19 Portfolio Beta** — Market sensitivity to aggregate political sentiment index.

**5.4.20 Kelly Criterion** — kelly = (your_prob - market_prob)/(1 - market_prob). Uses credibility-adjusted probability.

**5.4.21 Expected Value Score** — Composite signal: probability adjusted by credibility, smart flow, momentum, convergence, reversion. Positive = underpriced. Negative = overpriced.

### 5.5 TIER 5: Historical Calibration

**5.5.1 Signal Accuracy Ledger** — Track every flag, record outcome at resolution, publish accuracy by confidence level.

**5.5.2 Poll-Market Divergence** — Track gaps between polls and market, record which was closer at resolution.

---

## 6. Database Schema

```sql
CREATE TABLE markets (
  condition_id VARCHAR(66) PRIMARY KEY,
  question TEXT NOT NULL,
  slug VARCHAR(255),
  event_id VARCHAR(66),
  category VARCHAR(100),
  outcomes JSONB NOT NULL,
  clob_token_ids JSONB NOT NULL,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  is_resolved BOOLEAN DEFAULT FALSE,
  resolved_outcome VARCHAR(50),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE market_snapshots (
  id BIGSERIAL PRIMARY KEY,
  market_id VARCHAR(66) NOT NULL REFERENCES markets(condition_id),
  timestamp TIMESTAMPTZ NOT NULL,
  yes_price DECIMAL(8,6) NOT NULL,
  no_price DECIMAL(8,6) NOT NULL,
  volume_24h DECIMAL(16,2),
  total_volume DECIMAL(16,2),
  liquidity DECIMAL(16,2),
  spread DECIMAL(8,6),
  midpoint DECIMAL(8,6),
  book_depth_bid_5c DECIMAL(16,2),
  book_depth_ask_5c DECIMAL(16,2),
  book_imbalance DECIMAL(6,4),
  unique_traders_24h INTEGER,
  buy_volume_24h DECIMAL(16,2),
  sell_volume_24h DECIMAL(16,2),
  vwap_24h DECIMAL(8,6),
  volatility_24h DECIMAL(8,6),
  momentum_6h DECIMAL(8,6),
  momentum_24h DECIMAL(8,6)
);
CREATE INDEX idx_snapshots_market_time ON market_snapshots(market_id, timestamp DESC);

CREATE TABLE trades (
  id BIGSERIAL PRIMARY KEY,
  market_id VARCHAR(66) NOT NULL REFERENCES markets(condition_id),
  wallet_address VARCHAR(42) NOT NULL,
  side VARCHAR(4) NOT NULL,
  size_tokens DECIMAL(20,6) NOT NULL,
  size_usdc DECIMAL(16,2) NOT NULL,
  price DECIMAL(8,6) NOT NULL,
  outcome VARCHAR(50) NOT NULL,
  outcome_index INTEGER NOT NULL,
  transaction_hash VARCHAR(66),
  timestamp TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_trades_market_time ON trades(market_id, timestamp DESC);
CREATE INDEX idx_trades_wallet ON trades(wallet_address, timestamp DESC);

CREATE TABLE wallets (
  address VARCHAR(42) PRIMARY KEY,
  first_seen_chain TIMESTAMPTZ,
  first_seen_polymarket TIMESTAMPTZ,
  total_markets_traded INTEGER DEFAULT 0,
  total_volume_usdc DECIMAL(16,2) DEFAULT 0,
  total_trades INTEGER DEFAULT 0,
  accuracy_score DECIMAL(5,4),
  accuracy_sample_size INTEGER DEFAULT 0,
  is_smart_money BOOLEAN DEFAULT FALSE,
  username VARCHAR(255),
  pseudonym VARCHAR(255),
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE wallet_positions (
  id BIGSERIAL PRIMARY KEY,
  wallet_address VARCHAR(42) NOT NULL REFERENCES wallets(address),
  market_id VARCHAR(66) NOT NULL REFERENCES markets(condition_id),
  outcome VARCHAR(50) NOT NULL,
  size_tokens DECIMAL(20,6) NOT NULL,
  avg_entry_price DECIMAL(8,6) NOT NULL,
  initial_value_usdc DECIMAL(16,2),
  current_value_usdc DECIMAL(16,2),
  pnl_usdc DECIMAL(16,2),
  pnl_percent DECIMAL(10,4),
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(wallet_address, market_id, outcome)
);

CREATE TABLE flagged_moves (
  id BIGSERIAL PRIMARY KEY,
  market_id VARCHAR(66) NOT NULL REFERENCES markets(condition_id),
  detection_timestamp TIMESTAMPTZ NOT NULL,
  move_start_time TIMESTAMPTZ NOT NULL,
  move_end_time TIMESTAMPTZ NOT NULL,
  price_start DECIMAL(8,6) NOT NULL,
  price_end DECIMAL(8,6) NOT NULL,
  price_delta DECIMAL(8,6) NOT NULL,
  total_volume_usdc DECIMAL(16,2) NOT NULL,
  unique_wallets INTEGER NOT NULL,
  wallet_concentration_top1 DECIMAL(5,4),
  wallet_concentration_top3 DECIMAL(5,4),
  wallet_concentration_top5 DECIMAL(5,4),
  flagged_wallet_count INTEGER DEFAULT 0,
  flagged_wallet_agreement DECIMAL(5,4),
  flagged_volume_share DECIMAL(5,4),
  cluster_score DECIMAL(8,2),
  book_depth_at_start DECIMAL(16,2),
  spread_at_start DECIMAL(8,6),
  volume_spike_ratio DECIMAL(8,2),
  confidence_score INTEGER NOT NULL,
  informed_activity_index INTEGER NOT NULL,
  catalyst_type VARCHAR(20),
  catalyst_description TEXT,
  reversion_6h DECIMAL(5,4),
  reversion_24h DECIMAL(5,4),
  signal_direction VARCHAR(5),
  summary_text TEXT NOT NULL
);

CREATE TABLE market_analytics (
  id BIGSERIAL PRIMARY KEY,
  market_id VARCHAR(66) NOT NULL REFERENCES markets(condition_id),
  computed_date DATE NOT NULL,
  credibility_score INTEGER,
  informed_activity_index INTEGER,
  momentum_7d DECIMAL(8,6),
  volatility_7d DECIMAL(8,6),
  convergence_speed DECIMAL(8,6),
  smart_money_flow DECIMAL(16,2),
  retail_flow DECIMAL(16,2),
  buy_sell_ratio DECIMAL(5,4),
  vwap DECIMAL(8,6),
  expected_value_yes DECIMAL(8,6),
  expected_value_no DECIMAL(8,6),
  reversion_rate_avg DECIMAL(5,4),
  days_to_resolution INTEGER,
  UNIQUE(market_id, computed_date)
);

CREATE TABLE catalysts (
  id BIGSERIAL PRIMARY KEY,
  type VARCHAR(20) NOT NULL,
  title TEXT NOT NULL,
  source VARCHAR(255),
  source_url TEXT,
  published_at TIMESTAMPTZ NOT NULL,
  keywords JSONB,
  matched_market_ids JSONB
);

CREATE TABLE wallet_clusters (
  id BIGSERIAL PRIMARY KEY,
  cluster_id UUID NOT NULL,
  wallet_address VARCHAR(42) NOT NULL REFERENCES wallets(address),
  cluster_type VARCHAR(30) NOT NULL,
  confidence DECIMAL(5,4) NOT NULL,
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(cluster_id, wallet_address)
);

CREATE TABLE market_correlations (
  id BIGSERIAL PRIMARY KEY,
  market_a VARCHAR(66) NOT NULL,
  market_b VARCHAR(66) NOT NULL,
  correlation_7d DECIMAL(6,4),
  correlation_30d DECIMAL(6,4),
  avg_contagion_lag_hours DECIMAL(8,2),
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(market_a, market_b)
);

CREATE TABLE signal_accuracy_ledger (
  id BIGSERIAL PRIMARY KEY,
  flagged_move_id BIGINT REFERENCES flagged_moves(id),
  market_id VARCHAR(66) NOT NULL,
  flag_timestamp TIMESTAMPTZ NOT NULL,
  confidence_score INTEGER NOT NULL,
  flagged_direction VARCHAR(5) NOT NULL,
  market_resolved_at TIMESTAMPTZ,
  actual_outcome VARCHAR(5),
  flag_was_correct BOOLEAN
);

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  tier VARCHAR(10) DEFAULT 'free',
  wallet_address VARCHAR(42),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE user_alerts (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  market_id VARCHAR(66) REFERENCES markets(condition_id),
  min_confidence_score INTEGER DEFAULT 70,
  alert_on VARCHAR(20) DEFAULT 'low_confidence',
  channel VARCHAR(20) DEFAULT 'email',
  is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE user_followed_markets (
  user_id INTEGER NOT NULL REFERENCES users(id),
  market_id VARCHAR(66) NOT NULL REFERENCES markets(condition_id),
  PRIMARY KEY(user_id, market_id)
);
```

---

## 7. Terminal Pages

### Navigation
```
[CLEARLINE TERMINAL] [Portfolio] [Wallet Tracker] [News Feed] [Alerts] [Accuracy] [Insider Cases] [Sign In] [UPGRADE PRO]
```

### 7.1 Terminal (Home)
- Left: Portfolio summary (if wallet) or market health overview + High Informed Activity sidebar
- Center: Market cards grid (sort: Most Suspicious, Top Movers, Highest Volume, Your Markets)
- Each card: category, question, probability, change, credibility badge, informed %, volume, traders, one-line summary
- Top: Live ticker

### 7.2 Market Detail
- Header: question, probability, credibility badge, informed index
- Price chart with flagged move + catalyst markers
- Quant metrics panel: momentum, volatility, VWAP, buy/sell ratio, book imbalance, convergence, smart flow, EV
- Market health: traders, volume, depth, spread, concentration, consistency
- Flagged moves: expandable diagnostics
- Sidebar: catalysts, correlated markets, top holders (Pro)

### 7.3 Portfolio
- Wallet connection (public address, read-only)
- Total capital, P&L, position count
- Diversification donut (by category)
- Correlation risk indicator
- Position table with credibility warnings
- Kelly sizing suggestions (Pro)

### 7.4 Wallet Tracker
- Search by address
- Flagged wallets feed (sorted by composite score)
- Wallet profile: age, markets, volume, accuracy, positions, history, clusters

### 7.5 News Feed — Clearline Daily stories + catalyst feed
### 7.6 Alerts — Builder + history
### 7.7 Accuracy — Stats, rolling chart, resolved cases
### 7.8 Insider Cases — Documented case library

---

## 8. Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Python + FastAPI |
| Database | PostgreSQL (+ TimescaleDB at scale) |
| Cache/Queue | Redis |
| Scheduler | Celery or APScheduler |
| Frontend | React + Next.js + Tailwind |
| Charts | Recharts or TradingView Lightweight Charts |
| Email | Resend or SendGrid |
| Deploy | Docker + Docker Compose |

---

## 9. File Structure

```
clearline/
├── SPEC.md
├── docker-compose.yml
├── .env.example
├── backend/
│   ├── requirements.txt
│   ├── alembic/
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── database.py
│   │   ├── models/ (market, trade, wallet, flagged_move, analytics, catalyst, correlation, user)
│   │   ├── ingestion/ (market_poller, trade_monitor, book_snapshotter, catalyst_fetcher)
│   │   ├── analysis/ (wallet_profiler, move_detector, diagnostic, clustering, quant_metrics, credibility, portfolio, correlation, expected_value)
│   │   ├── api/ (markets, moves, wallets, portfolio, analytics, alerts, feed, auth)
│   │   ├── services/ (alerting, newsletter)
│   │   └── clients/ (polymarket, polygonscan, news)
│   └── tests/
├── frontend/
│   ├── src/
│   │   ├── app/ (page, markets/[id], portfolio, wallets, wallets/[addr], moves/[id], feed, alerts, accuracy, cases)
│   │   ├── components/ (MarketCard, ConfidenceBadge, PriceChart, DiagnosticPanel, QuantMetrics, PortfolioDashboard, WalletProfile, BookVisualizer, CorrelationMatrix, AlertConfig)
│   │   └── lib/ (api, types)
│   └── public/
└── scripts/ (seed_markets, backfill_trades, compute_analytics)
```

---

## 10. Config Constants

```python
MOVE_THRESHOLD_30MIN_PP = 3.0
MOVE_THRESHOLD_2HR_PP = 5.0
MOVE_MIN_VOLUME_USD = 500
WALLET_AGE_DELTA_HIGH_HOURS = 1
TRADE_CONCENTRATION_HIGH = 0.70
POSITION_SIZE_RELATIVE_HIGH = 0.25
COMPOSITE_SCORE_FLAG_THRESHOLD = 0.5
CREDIBILITY_GREEN = 70
CREDIBILITY_YELLOW = 40
SMART_MONEY_ACCURACY_THRESHOLD = 0.70
SMART_MONEY_MIN_SAMPLE = 5
CLUSTER_TIME_WINDOW_HOURS = 72
CLUSTER_MIN_WALLETS = 3
MARKET_POLL_SECONDS = 300
TRADE_POLL_SECONDS = 120
BOOK_POLL_SECONDS = 600
ANALYTICS_COMPUTE_SECONDS = 3600
CATALYST_POLL_SECONDS = 1800
PM_MAX_REQUESTS_HOUR = 900
POLYGONSCAN_MAX_PER_SEC = 4
```

---

## 11. API Endpoints

```
# Public
GET  /api/v1/markets
GET  /api/v1/markets/{id}
GET  /api/v1/markets/{id}/history
GET  /api/v1/markets/{id}/moves
GET  /api/v1/markets/{id}/analytics
GET  /api/v1/markets/{id}/correlations
GET  /api/v1/moves/{id}
GET  /api/v1/feed
GET  /api/v1/accuracy
GET  /api/v1/cases

# Auth (free)
GET/POST /api/v1/me/alerts
GET  /api/v1/me/followed-markets
POST /api/v1/me/connect-wallet
GET  /api/v1/me/portfolio
GET  /api/v1/me/portfolio/positions

# Auth (Pro)
GET  /api/v1/markets/{id}/wallets
GET  /api/v1/markets/{id}/smart-flow
GET  /api/v1/markets/{id}/expected-value
GET  /api/v1/wallets/{address}
GET  /api/v1/wallets/{address}/positions
GET  /api/v1/wallets/{address}/accuracy
GET  /api/v1/moves/{id}/wallets
GET  /api/v1/clusters/{id}
GET  /api/v1/portfolio/kelly
GET  /api/v1/portfolio/correlation-risk
GET  /api/v1/screening
```

---

## 12. Development Phases

**Phase 1 (Weeks 1-3): Data Foundation** — PostgreSQL, Market Poller, Trade Monitor, Book Snapshotter. Result: DB with live data.

**Phase 2 (Weeks 3-6): Core Analytics** — Wallet profiling, move detection, credibility scores, basic quant metrics. Result: Computed scores for every market.

**Phase 3 (Weeks 6-9): Terminal Frontend** — Home page, market detail, wallet tracker, dark terminal aesthetic. Result: Functional web app.

**Phase 4 (Weeks 9-12): Portfolio + Advanced** — Wallet connection, portfolio dashboard, correlations, smart flow, EV, Kelly. Result: Complete terminal.

**Phase 5 (Weeks 12+): Distribution** — Alerts, newsletter, accuracy ledger, insider cases, Sybil detection, screening.

---

## 13. Environment Variables

```bash
DATABASE_URL=postgresql://clearline:password@localhost:5432/clearline
REDIS_URL=redis://localhost:6379/0
GAMMA_API_URL=https://gamma-api.polymarket.com
CLOB_API_URL=https://clob.polymarket.com
DATA_API_URL=https://data-api.polymarket.com
WS_URL=wss://ws-subscriptions-clob.polymarket.com/ws/
POLYGONSCAN_API_KEY=
NEWS_API_KEY=
RESEND_API_KEY=
SECRET_KEY=
JWT_ALGORITHM=HS256
ENVIRONMENT=development
```

---

## 14. Glossary

| Term | Definition |
|------|-----------|
| Condition ID | Unique on-chain market identifier |
| CLOB | Central Limit Order Book |
| Outcome Token | ERC-1155 token paying $1 if correct, $0 if wrong |
| Proxy Wallet | Polymarket user account wallet address |
| Smart Money | Wallets with >70% accuracy on 5+ resolved markets |
| Sybil | Multiple wallets controlled by same entity |
| Credibility Score | 0-100 market price trustworthiness |
| Informed Activity Index | 0-100 insider-like trading presence |
| Expected Value | Composite signal: positive=underpriced, negative=overpriced |
| VWAP | Volume-Weighted Average Price |
| Book Imbalance | Bid vs ask liquidity ratio (-1 to +1) |
| Kelly Criterion | Optimal position sizing formula |
| PMVI | Prediction Market Volatility Index |
| Convergence Speed | Rate market approaches certainty near resolution |
| Contagion Speed | Time lag between correlated market moves |