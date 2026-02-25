# Clearline — Technical Specification & System Architecture

## Document Purpose

This document is the single source of truth for the Clearline project. It defines what Clearline is, what problem it solves, how the system works end-to-end, what every component does, what data flows where, and how to build each piece. This document is written to be understood by human developers and AI coding agents alike. Any agent tasked with building, debugging, or extending Clearline should read this document first.

---

## 1. What Clearline Is

Clearline is a market intelligence platform for political prediction markets. It monitors trading activity on Polymarket, detects patterns consistent with insider trading or informed speculation, and produces reliability assessments for every significant market movement.

Clearline does NOT predict election outcomes. Clearline does NOT execute trades. Clearline does NOT identify or doxx individuals behind wallet addresses.

Clearline answers one question: **"Should I trust this prediction market price?"**

It answers that question by analyzing the on-chain behavioral patterns of the wallets that drove the price movement, assessing whether the trading activity looks like genuine collective belief or concentrated insider action, and presenting that analysis in a format that journalists, analysts, traders, and researchers can use.

---

## 2. The Problem In Detail

Prediction markets like Polymarket are increasingly treated as authoritative probability sources. Journalists cite them. Campaigns monitor them. Traders bet real money on them. But the prices are only as meaningful as the trading activity behind them.

A market showing "62% chance Republicans win Pennsylvania" could mean:
- Thousands of independent traders have collectively arrived at that probability (high signal)
- Three fresh wallets created yesterday dumped $50,000 into a thin order book and moved the price from 48% to 62% (low signal, possibly insider trading)

From the outside, these two scenarios look identical. The number is the same. But the implications are completely different.

### Documented Insider Trading Cases

These are real, documented cases that demonstrate the problem Clearline solves:

1. **Venezuelan President Maduro Capture Market (January 2026):** A trader converted approximately $32,000 into roughly $400,000 shortly before a military operation became public knowledge. The trade was placed before any public reporting of the operation.

2. **Israeli Military Strike Bets (2025–2026):** Bets placed on Polymarket regarding Israeli military strikes led to arrests and indictments in 2026. Prosecutors alleged the traders used classified intelligence information to place their bets.

3. **Super Bowl Halftime Show Props:** A single account correctly predicted nearly all major halftime show prop outcomes on Polymarket, raising widespread speculation about insider access to production details.

4. **Nobel Peace Prize Odds Spike (2025):** Polymarket odds for the Nobel Peace Prize shifted dramatically shortly before the official announcement, suggesting possible foreknowledge among traders.

These cases confirm that insider trading on prediction markets is not hypothetical — it is routine, documented, and causes real financial harm to ordinary participants.

---

## 3. System Overview

Clearline consists of six layers that operate as a pipeline:

```
Layer 1: Data Ingestion
    ↓
Layer 2: Wallet Profiling
    ↓
Layer 3: Move Detection & Diagnostics
    ↓
Layer 4: External Catalyst Matching
    ↓
Layer 5: Application Backend & API
    ↓
Layer 6: Frontend Dashboard & Distribution (Newsletter, Alerts)
```

Each layer is described in full detail below.

---

## 4. Polymarket API Ecosystem

Polymarket exposes four distinct API services. Understanding which service provides which data is critical.

### 4.1 Gamma API — Market Discovery & Metadata

- **Base URL:** `https://gamma-api.polymarket.com`
- **Authentication:** None required (fully public)
- **Rate Limits:** ~1,000 requests/hour for non-trading endpoints
- **Purpose:** Discover markets, get metadata, categories, event groupings

**Key Endpoints:**

| Endpoint | Method | Description | Use in Clearline |
|----------|--------|-------------|------------------|
| `/events` | GET | List all events with optional filters | Populate market feed, discover new markets |
| `/events/{id}` | GET | Get single event with all its markets | Drill into specific event details |
| `/markets` | GET | List all markets with filters | Get outcome prices, volumes, status |
| `/markets/{id}` | GET | Get single market details | Detailed market metadata |
| `/tags` | GET | List available market categories | Filter political markets specifically |

**Key Query Parameters for `/events` and `/markets`:**
- `active=true` — Only active (not resolved) markets
- `closed=false` — Only open markets
- `limit=100` — Results per page (max ~100)
- `offset=0` — Pagination offset
- `tag=politics` — Filter by category tag
- `order=volume24hr` — Sort by 24h volume
- `ascending=false` — Descending order

**Example Response Shape for `/markets`:**
```json
{
  "id": "0x1234...",
  "question": "Will Republicans win Pennsylvania in 2026?",
  "slug": "will-republicans-win-pennsylvania-2026",
  "outcomes": "[\"Yes\", \"No\"]",
  "outcomePrices": "[\"0.62\", \"0.38\"]",
  "volume": "1250000",
  "volume24hr": "85000",
  "liquidity": "320000",
  "startDate": "2025-06-01T00:00:00Z",
  "endDate": "2026-11-04T00:00:00Z",
  "active": true,
  "closed": false,
  "marketType": "binary",
  "enableOrderBook": true,
  "clobTokenIds": "[\"token_yes_id\", \"token_no_id\"]",
  "conditionId": "0xabcd...",
  "questionId": "0xefgh..."
}
```

**Critical Fields:**
- `outcomePrices` — This IS the current probability. Index 0 maps to outcomes[0], index 1 maps to outcomes[1]. Prices sum to ~1.0 (minus spread).
- `clobTokenIds` — These are the token IDs you pass to the CLOB API for order book data. You MUST parse this from the market response before querying the CLOB.
- `conditionId` — The unique on-chain identifier for this market. Used as the primary key for cross-referencing across APIs.
- `volume24hr` — Rolling 24-hour volume in USD. This is what you normalize position sizes against.

### 4.2 CLOB API — Order Book, Pricing & Trading

- **Base URL:** `https://clob.polymarket.com`
- **Authentication:** None required for read endpoints; API key + wallet signature required for trading endpoints
- **Rate Limits:** ~1,000 requests/hour for public endpoints
- **Purpose:** Real-time order book state, pricing, spreads, historical timeseries

**Key Read Endpoints (no auth):**

| Endpoint | Method | Description | Use in Clearline |
|----------|--------|-------------|------------------|
| `/book` | GET | Full order book for a token | Assess liquidity depth at time of move |
| `/midpoint` | GET | Midpoint price between best bid/ask | Track real-time price more accurately than last trade |
| `/price` | GET | Best available price for a side (BUY/SELL) | Current executable price |
| `/spread` | GET | Current bid-ask spread | Spread tightness feeds into credibility score |
| `/tick-size` | GET | Minimum price increment for a market | Needed for price analysis precision |
| `/last-trade-price` | GET | Last executed trade price | Alternative to midpoint for price tracking |
| `/prices-history` | GET | Historical price timeseries | Build price charts, detect move timing |
| `/books` | POST | Multiple order books in one request | Batch queries to stay under rate limits |

**Order Book Response Shape (`/book?token_id=TOKEN_ID`):**
```json
{
  "market": "0xcondition_id",
  "asset_id": "token_id_string",
  "bids": [
    { "price": "0.61", "size": "5000.00" },
    { "price": "0.60", "size": "12000.00" },
    { "price": "0.59", "size": "8500.00" }
  ],
  "asks": [
    { "price": "0.63", "size": "3200.00" },
    { "price": "0.64", "size": "7800.00" },
    { "price": "0.65", "size": "4100.00" }
  ],
  "hash": "book_hash_string",
  "timestamp": "1709251200"
}
```

**Critical Notes:**
- Each token ID corresponds to one outcome (YES or NO). To get the full picture of a binary market, you need to query the book for BOTH token IDs.
- `size` is in outcome tokens, not USD. To convert: `size * price = approximate USD value at that level`.
- The sum of sizes within N cents of the midpoint = the "depth" that determines how much capital is needed to move the price.
- Use the `/books` POST endpoint to batch-request multiple markets in a single call. This is essential for staying under rate limits.

**Historical Timeseries (`/prices-history?market=CONDITION_ID&interval=max&fidelity=60`):**
- `interval`: `1d`, `1w`, `1m`, `3m`, `1y`, `max`
- `fidelity`: seconds between data points (60 = 1 minute, 3600 = 1 hour)
- Returns array of `{ t: unix_timestamp, p: price }` objects

### 4.3 Data API — Wallet Positions, Trades & Activity

- **Base URL:** `https://data-api.polymarket.com`
- **Authentication:** None required for public data
- **Rate Limits:** Same general limits as Gamma API
- **Purpose:** Wallet-level analysis — positions, trade history, on-chain activity, holder rankings

**This is the most important API for Clearline's core functionality.**

**Key Endpoints:**

| Endpoint | Method | Description | Use in Clearline |
|----------|--------|-------------|------------------|
| `/positions` | GET | Current positions for a wallet address | See what any wallet is currently betting on |
| `/trades` | GET | Trade history filterable by user or market | Core data for wallet profiling and move analysis |
| `/activity` | GET | On-chain activity (trades, splits, merges, redeems) | Full wallet history including non-trade events |
| `/holders` | GET | Top holders of a market token (max 20) | Quick scan of who holds the largest positions |
| `/value` | GET | Portfolio value for a wallet | Assess wallet size and sophistication |

**Positions Endpoint (`/positions?user=WALLET_ADDRESS`):**

Query Parameters:
- `user` (required): Wallet address (proxyWallet format)
- `market`: Filter by conditionId
- `sizeThreshold`: Minimum position size to return (filters out dust)
- `sortBy`: `TOKENS`, `CURRENT`, `INITIAL`, `CASHPNL`, `PERCENTPNL`, `PRICE`, `RESOLVING`
- `sortDirection`: `ASC` or `DESC`

Response shape:
```json
{
  "proxyWallet": "0x6af7...",
  "asset": "65396714035...",
  "conditionId": "0xd007...",
  "size": 90548.08,
  "avgPrice": 0.020628,
  "initialValue": 1867.82,
  "currentValue": 5840.35,
  "cashPnl": 3972.52,
  "percentPnl": 212.68,
  "totalBought": 109548.07,
  "realizedPnl": -894.39,
  "curPrice": 0.0645,
  "redeemable": false,
  "title": "Market Title",
  "slug": "market-slug",
  "outcome": "Yes",
  "outcomeIndex": 0,
  "oppositeOutcome": "No"
}
```

**Critical Fields for Clearline:**
- `avgPrice` — The wallet's average entry price. Compare to `curPrice` to see if they're in profit.
- `size` — Total position in outcome tokens.
- `initialValue` — How much USD they put in.
- `totalBought` — Cumulative buying (may exceed size if they sold some).
- `cashPnl` and `percentPnl` — Realized + unrealized profit/loss.
- `proxyWallet` — This is the wallet address you use to query other endpoints for this user.

**Activity Endpoint (`/activity?user=WALLET_ADDRESS`):**

Query Parameters:
- `user` (required): Wallet address
- `market`: Filter by conditionId
- `type`: Filter by activity type — `TRADE`, `SPLIT`, `MERGE`, `REDEEM`, `REWARD`, `CONVERSION` (supports comma-separated)
- `start`: Start timestamp in seconds
- `end`: End timestamp in seconds
- `side`: `BUY` or `SELL` (only for trades)
- `sortBy`: `TIMESTAMP`, `TOKENS`, `CASH`
- `sortDirection`: `ASC` or `DESC`

Response shape:
```json
{
  "proxyWallet": "0x6af7...",
  "timestamp": 1723772457,
  "conditionId": "0x2c95...",
  "type": "TRADE",
  "size": 600,
  "usdcSize": 354,
  "transactionHash": "0x40b7...",
  "price": 0.59,
  "asset": "10783614...",
  "side": "BUY",
  "outcomeIndex": 1,
  "title": "Market Title",
  "slug": "market-slug",
  "outcome": "No",
  "name": "username",
  "pseudonym": "Display-Name"
}
```

**Critical Fields for Clearline:**
- `timestamp` — Unix timestamp in seconds. Essential for computing timing metrics.
- `type` — Distinguish trades from splits/merges/redeems. For insider detection, focus on `TRADE` type.
- `usdcSize` — The USD value of the trade. This is position size.
- `price` — The execution price. Combined with timestamp, this tells you exactly when someone entered at what price.
- `side` — `BUY` or `SELL`. For detecting conviction, track wallets that BUY during price drops.
- `transactionHash` — On-chain proof of the trade. Can be verified on Polygonscan.

**Holders Endpoint (`/holders?market=CONDITION_ID`):**

Returns top 20 holders per token. Useful for quick concentration analysis but capped — for complete holder analysis, you need to build your own from trade data.

### 4.4 WebSocket Feeds — Real-Time Streaming

- **URL:** `wss://ws-subscriptions-clob.polymarket.com/ws/`
- **Authentication:** None for public channels
- **Purpose:** Real-time trade and order book updates

**Market Channel (public):**
Subscribe to receive real-time order book updates and trade notifications for specific markets.

```json
// Subscribe message
{
  "type": "subscribe",
  "channel": "market",
  "assets_id": "TOKEN_ID"
}
```

**Events received:**
- Order book changes (new bids/asks, cancellations)
- Trade executions (price, size, timestamp)
- Price updates

**When to use WebSocket vs. polling:**
- Use WebSocket for real-time monitoring of high-priority markets
- Use polling for comprehensive periodic snapshots of all markets
- The WebSocket may miss events during reconnection; always reconcile with polling data

### 4.5 Polygon Blockchain — Direct On-Chain Data

For data the Polymarket APIs don't provide (primarily wallet creation dates), query the Polygon blockchain directly.

**Polygonscan API:**
- **Base URL:** `https://api.polygonscan.com/api`
- **Free tier:** 5 calls/second, 100,000 calls/day
- **API key:** Required (free registration)

**Get first transaction for a wallet (to determine creation date):**
```
GET https://api.polygonscan.com/api
  ?module=account
  &action=txlist
  &address=WALLET_ADDRESS
  &startblock=0
  &endblock=99999999
  &page=1
  &offset=1
  &sort=asc
  &apikey=YOUR_API_KEY
```

This returns the earliest transaction involving the wallet. The `timeStamp` field gives you the wallet creation date (or at least the date of first on-chain activity).

**Cache wallet creation dates permanently.** A wallet's creation date never changes. Look it up once, store it forever.

**Alternative: Bitquery GraphQL API**
Bitquery provides a GraphQL API for Polygon data specifically indexed for Polymarket:
- Endpoint: `https://graphql.bitquery.io`
- Can query trades, settlements, market events directly
- More structured than raw Polygonscan but requires separate API key
- Supports streaming via Kafka for ultra-low-latency applications

---

## 5. Clearline Metrics Framework — Complete Specification

### 5.1 Tier 1: Wallet Behavior Signals

These signals are computed for EVERY wallet on EVERY trade, automatically. They are the atomic building blocks of the entire detection system.

#### 5.1.1 Wallet Age Delta

**Definition:** The time elapsed between a wallet's first-ever on-chain transaction and its first trade in the flagged market.

**Data Sources:**
- Wallet creation date: Polygonscan API (first transaction timestamp)
- First trade in market: Data API `/activity?user=ADDRESS&market=CONDITION_ID&sort=asc&limit=1`

**Computation:**
```
wallet_age_delta = first_trade_in_market_timestamp - wallet_creation_timestamp
```

**Scoring:**
| Delta | Score | Interpretation |
|-------|-------|----------------|
| < 1 hour | 1.0 (maximum flag) | Almost certainly purpose-built for this trade |
| 1–24 hours | 0.85 | Very suspicious, new wallet with immediate large activity |
| 1–7 days | 0.6 | Suspicious if combined with other signals |
| 1–4 weeks | 0.3 | Mild flag, could be a new user exploring |
| > 1 month | 0.1 | Normal user behavior |
| > 6 months | 0.0 (no flag) | Established wallet, no age-based concern |

**Storage:** `wallets` table — `first_seen_chain` (from Polygonscan), `first_seen_polymarket` (from Data API). Compute delta at query time or store as `wallet_age_delta_seconds`.

**Edge Cases:**
- Some wallets are funded via smart contract deployments that predate any Polymarket activity by years. These should not be flagged. Check that the wallet has actual Polymarket history, not just any on-chain activity.
- Proxy wallets (used by Polymarket's email login system) may share creation patterns. The proxyWallet address in Data API responses is the relevant address to analyze.

#### 5.1.2 Trade Concentration

**Definition:** The percentage of a wallet's total Polymarket trading volume that is concentrated in a single market.

**Data Sources:**
- All trades for wallet: Data API `/activity?user=ADDRESS&type=TRADE`
- Group by `conditionId`, sum `usdcSize` per market

**Computation:**
```
For each market M the wallet has traded:
  market_volume[M] = sum(usdcSize for all trades in M)

total_volume = sum(all market_volume values)
concentration[M] = market_volume[M] / total_volume

trade_concentration_score = max(concentration values)
```

**Scoring:**
| Concentration | Score | Interpretation |
|---------------|-------|----------------|
| > 95% | 1.0 | Wallet exists for one market only |
| 80–95% | 0.8 | Heavily concentrated, very unusual |
| 70–80% | 0.6 | Notably concentrated, flag if other signals present |
| 50–70% | 0.3 | Somewhat concentrated but could be normal |
| < 50% | 0.0 | Diversified, normal behavior |

**Important Nuance from Whale Tracker Interview:**
Some traders legitimately buy in two correlated markets as a hedging strategy (e.g., "Eric Adams drops out" AND "Cuomo gets endorsed"). This looks like moderate concentration but is actually sophisticated informed behavior. When computing concentration, also check for CORRELATED positions across related markets — this is handled in Tier 2 Cross-Market Position Mapping.

#### 5.1.3 Position Size Relative to Market

**Definition:** The size of a wallet's trade normalized against the market's typical daily volume.

**Data Sources:**
- Trade size: `usdcSize` from the trade record
- Market daily volume: Gamma API `volume24hr` field, or compute from your own `market_snapshots` table as the rolling 7-day average

**Computation:**
```
avg_daily_volume = rolling_7day_average(market volume)
relative_size = trade_usdc_size / avg_daily_volume

// For single-trade analysis:
position_size_score = min(relative_size / 0.25, 1.0)
// Score hits 1.0 when a single trade equals 25% of average daily volume
```

**Scoring:**
| Relative Size (% of daily volume) | Score | Interpretation |
|------------------------------------|-------|----------------|
| > 25% | 1.0 | Enormous relative to market activity |
| 10–25% | 0.7 | Very large, notable |
| 5–10% | 0.4 | Large but not extreme |
| 1–5% | 0.15 | Normal range for active traders |
| < 1% | 0.0 | Small, no concern |

**Critical Context:**
Raw dollar amounts are misleading. The whale tracker interview confirms this — "$1,000 buys" are rare and notable in most markets, but in a market doing $500k daily volume, $1,000 is invisible. ALWAYS normalize against market volume.

#### 5.1.4 Conviction Behavior

**Definition:** Whether a wallet demonstrates conviction in its position by continuing to buy during adverse price movement or holding through drawdowns.

**Data Sources:**
- All trades for wallet in market: Data API `/activity?user=ADDRESS&market=CONDITION_ID&type=TRADE&sortBy=TIMESTAMP&sortDirection=ASC`
- Price history: CLOB API `/prices-history?market=CONDITION_ID`

**Computation:**

Identify three conviction patterns:

**Pattern A — Accumulation (buying the dip):**
```
For each BUY trade after the first:
  if current_market_price < wallet_avg_entry_price:
    accumulation_count += 1

accumulation_ratio = accumulation_count / (total_buy_trades - 1)
// High ratio = wallet keeps buying as price drops against them
```

**Pattern B — Scaling In (deliberate incremental entry):**
```
buy_timestamps = [sorted list of all BUY trade timestamps]
if len(buy_timestamps) >= 3:
  time_gaps = [buy_timestamps[i+1] - buy_timestamps[i] for i in range(len-1)]
  avg_gap = mean(time_gaps)
  if avg_gap > 3600 and avg_gap < 604800:  // between 1 hour and 7 days
    scaling_in = True
// Scaling in = multiple buys spread over time, not one big trade
```

**Pattern C — Hold Through Dip (no selling during drawdowns):**
```
For each price snapshot after wallet's first buy:
  if price < wallet_avg_entry_price * 0.9:  // 10%+ drawdown
    dip_periods += 1
    if wallet sold during this period:
      sold_during_dip = True

hold_through_dip = (dip_periods > 0) and (not sold_during_dip)
```

**Scoring:**
```
conviction_score = (
  (accumulation_ratio * 0.4) +
  (1.0 if scaling_in else 0.0) * 0.3 +
  (1.0 if hold_through_dip else 0.0) * 0.3
)
```

#### 5.1.5 Entry Timing

**Definition:** Whether the trade was placed at an unusual time relative to market activity and external events.

**Data Sources:**
- Trade timestamp: From trade record
- Market volume distribution by hour: Computed from `market_snapshots` table
- Catalyst database: See Section 5.3

**Computation:**

**Timing anomaly score:**
```
hour_of_trade = trade_timestamp.hour (UTC)
hourly_volume_distribution = [average volume for each hour over past 7 days]
expected_volume_at_hour = hourly_volume_distribution[hour_of_trade]
average_hourly_volume = mean(hourly_volume_distribution)

// Score is high when trading during low-volume periods
timing_anomaly = 1.0 - (expected_volume_at_hour / max(hourly_volume_distribution))
```

**Pre-catalyst score:**
```
For each catalyst event within 24 hours AFTER the trade:
  time_before_catalyst = catalyst_timestamp - trade_timestamp
  if 0 < time_before_catalyst < 86400:  // trade happened before catalyst
    pre_catalyst_score = max(pre_catalyst_score, 1.0 - (time_before_catalyst / 86400))
    // Score is highest when trade is very close before the catalyst
```

**Combined entry timing score:**
```
entry_timing_score = max(timing_anomaly * 0.4, pre_catalyst_score * 1.0)
// Pre-catalyst entries dominate when present
```

### 5.2 Tier 2: Pattern Detection Across Wallets

These signals operate at the MARKET level by aggregating Tier 1 wallet signals.

#### 5.2.1 Signal Clustering

**Definition:** The number and strength of independently flagged wallets betting the same direction in the same market within a defined time window.

**Computation:**
```
For a given market M and time window W (default: 72 hours):
  flagged_wallets = [wallets with any Tier 1 score > 0.5 that traded in M during W]
  
  same_direction_wallets = [w for w in flagged_wallets if w.side == majority_side]
  
  cluster_score = len(same_direction_wallets) * mean([w.composite_tier1_score for w in same_direction_wallets])
```

**Interpretation:**
| Cluster Score | Interpretation |
|---------------|----------------|
| > 10.0 | Extremely strong signal — multiple independent suspicious wallets |
| 5.0–10.0 | Strong signal — notable coordinated suspicious activity |
| 2.0–5.0 | Moderate signal — a few suspicious wallets, worth monitoring |
| < 2.0 | Weak/no signal |

**Reference Case:** The Eric Adams market had 6–8 independently flagged wallets over several days, all betting the same direction. This is exactly what signal clustering detects.

#### 5.2.2 Behavioral Fingerprinting

**Definition:** Identifying wallets that appear independent but exhibit behavioral patterns suggesting they are controlled by the same entity.

**Features for Clustering:**
```
For each wallet, compute a behavioral vector:
  - preferred_trading_hour: mode of trade timestamps by hour
  - avg_trade_size_usd: mean usdcSize across all trades
  - trade_frequency: trades per day
  - deposit_source_address: first funding source
  - market_entry_sequence: ordered list of markets traded (as hashed sequence)
  - time_between_deposits_and_first_trade: hours from funding to first trade
```

**Clustering Algorithm:**
Use DBSCAN or hierarchical clustering on normalized behavioral vectors. Wallets that cluster together despite having different addresses are flagged as potential Sybil groups.

**Storage:** `wallet_clusters` table with cluster_id, wallet_address, confidence_score.

#### 5.2.3 Funding Source Correlation

**Definition:** Identifying wallets funded from the same source address or through the same bridge path.

**Data Sources:**
- Polygonscan API: Query incoming transactions to the wallet address
- Focus on USDC transfers (the primary Polymarket collateral) and MATIC transfers (for gas)

**Computation:**
```
For each wallet in a flagged market:
  funding_txs = polygonscan.get_token_transfers(wallet, token="USDC", sort="asc", limit=5)
  funding_sources = [tx.from_address for tx in funding_txs]

// Group wallets by shared funding sources
funding_groups = group_wallets_by(shared_element_in(funding_sources))

// Flag groups where 2+ wallets share a funding source AND trade same direction
```

**This is the strongest Sybil detection signal** because it uses on-chain evidence, not behavioral inference.

#### 5.2.4 Cross-Market Position Mapping

**Definition:** Detecting when flagged wallets hold correlated positions across multiple related markets that suggest a coherent information narrative.

**Data Sources:**
- All positions for flagged wallets: Data API `/positions?user=ADDRESS`
- Market relationship mapping: Defined manually or inferred from shared events (markets under the same Gamma API event are related)

**Computation:**
```
For each flagged wallet:
  positions = data_api.get_positions(wallet)
  
  // Check for multi-market narratives
  // Example: "Adams drops out" YES + "Cuomo gets nomination" YES = coherent narrative
  
  related_markets = find_related_markets(positions)
  if len(positions in related_markets) >= 2:
    if positions are directionally consistent with a coherent narrative:
      cross_market_score = 0.8
    else:
      cross_market_score = 0.2
```

### 5.3 Tier 3: Market-Level Intelligence

These are the OUTPUT metrics that users interact with.

#### 5.3.1 Market Credibility Score (0–100)

**Definition:** A composite score answering "how much should you trust this market's current price?"

**Inputs and Weights:**
```
credibility_score = (
  unique_trader_score * 0.20 +        // More unique traders = more credible
  wallet_diversity_score * 0.15 +      // Low concentration among top holders
  order_book_depth_score * 0.20 +      // Deep books = harder to manipulate
  spread_score * 0.10 +               // Tight spreads = active market making
  volume_consistency_score * 0.15 +    // Steady volume vs. sporadic spikes
  inverse_informed_activity * 0.20     // Low insider-like activity = more credible
)
```

**Sub-score Computations:**

```python
def unique_trader_score(market_id, window_days=7):
    """More unique traders = higher score"""
    unique_wallets = count_distinct_wallets(market_id, last_n_days=window_days)
    # Logarithmic scaling: 10 traders = 0.3, 50 = 0.6, 200+ = 1.0
    return min(log10(unique_wallets + 1) / log10(201), 1.0)

def wallet_diversity_score(market_id):
    """Low concentration among top holders = higher score"""
    top_5_share = sum_positions(top_5_wallets) / total_market_positions
    return 1.0 - top_5_share  # Invert: low concentration = high score

def order_book_depth_score(market_id):
    """More liquidity near the midpoint = higher score"""
    book = clob_api.get_book(token_id)
    depth_within_5_cents = sum_sizes_within(book, cents=5)
    # Normalize against market's average depth
    return min(depth_within_5_cents / (avg_daily_volume * 0.5), 1.0)

def spread_score(market_id):
    """Tighter spread = higher score"""
    spread = clob_api.get_spread(token_id)
    # $0.01 spread = 1.0, $0.05 = 0.5, $0.10+ = 0.0
    return max(1.0 - (spread - 0.01) / 0.09, 0.0)

def volume_consistency_score(market_id, window_days=14):
    """Consistent daily volume = higher score (vs. one big spike)"""
    daily_volumes = get_daily_volumes(market_id, last_n_days=window_days)
    cv = std(daily_volumes) / mean(daily_volumes)  # Coefficient of variation
    return max(1.0 - cv, 0.0)
```

#### 5.3.2 Informed Activity Index (0–100)

**Definition:** How much of the current price action appears driven by wallets exhibiting insider-like behavior.

**Computation:**
```
For a market M in time window W:
  all_trades = get_trades(M, W)
  total_volume = sum(t.usdcSize for t in all_trades)
  
  flagged_volume = sum(
    t.usdcSize for t in all_trades 
    if wallet_composite_score(t.wallet) > 0.5
  )
  
  raw_informed_ratio = flagged_volume / total_volume
  
  // Weight by the strength of the flags
  weighted_informed_ratio = sum(
    t.usdcSize * wallet_composite_score(t.wallet) 
    for t in all_trades
  ) / total_volume
  
  informed_activity_index = min(weighted_informed_ratio * 200, 100)
  // Scale so that 50% flagged weighted volume = score of 100
```

#### 5.3.3 Catalyst Attribution

**Definition:** Classifying market moves as explained (matching external catalyst) or unexplained.

**External Data Sources:**

| Source | Data Type | Integration Method | Update Frequency |
|--------|-----------|-------------------|------------------|
| FiveThirtyEight / RealClearPolitics | Polling averages, new poll releases | RSS feed parsing or web scraping | Every 6 hours |
| NewsAPI.org / GNews API | Political news headlines | REST API with keyword filters | Every 30 minutes |
| Federal Reserve calendar | FOMC meetings, rate decisions | Static calendar + manual updates | Monthly |
| Congressional calendar | Scheduled votes, hearings | Congress.gov API or scraping | Weekly |
| Court dockets | Major case rulings | PACER or manual tracking | As needed |

**Matching Logic:**
```
For each flagged move:
  move_start_time = earliest trade in the move window
  
  catalysts = query_catalysts(
    time_range=(move_start_time - 6_hours, move_start_time + 1_hour),
    keywords=extract_keywords(market.question)
  )
  
  if catalysts:
    attribution = "EXPLAINED"
    catalyst_description = best_matching_catalyst.title
  else:
    attribution = "UNEXPLAINED"
    
  // UNEXPLAINED + high informed_activity_index = highest priority signal
```

#### 5.3.4 Evasion Sophistication Score

**Definition:** Quantifying how much effort a wallet or wallet group has put into disguising their activity.

**Evasion Signals:**
```
evasion_score = 0.0

// Signal 1: Camouflage trades (small random trades in unrelated markets before going big)
if wallet has 5+ small trades in different markets before one large trade:
  evasion_score += 0.3

// Signal 2: Split across multiple wallets (detected via behavioral fingerprinting)
if wallet belongs to a Sybil cluster:
  evasion_score += 0.3

// Signal 3: Gradual accumulation (many small buys instead of one large one)
if wallet has 10+ buys in the same market with avg size < market_avg / 5:
  evasion_score += 0.2

// Signal 4: Timing distribution (deliberately spacing trades across days)
if wallet trades only during high-volume periods (hiding in crowd):
  evasion_score += 0.2

evasion_score = min(evasion_score, 1.0)
```

**Key Insight:** The evasion score INCREASES confidence that the underlying information is real. Casual traders don't bother hiding. Someone going through elaborate steps to disguise their activity is telling you, through their evasion effort, that what they're trading on is valuable.

### 5.4 Tier 4: Historical Calibration

#### 5.4.1 Signal Accuracy Ledger

**Definition:** For every flagged market, track whether the flagged wallets ended up on the winning side when the market resolved.

**Storage Schema:**
```sql
CREATE TABLE signal_accuracy_ledger (
  id SERIAL PRIMARY KEY,
  market_id VARCHAR(66) NOT NULL,
  flag_timestamp TIMESTAMPTZ NOT NULL,
  flag_type VARCHAR(50) NOT NULL,
  confidence_score DECIMAL(5,2) NOT NULL,
  flagged_direction VARCHAR(5) NOT NULL,  -- 'YES' or 'NO'
  market_resolved_at TIMESTAMPTZ,
  actual_outcome VARCHAR(5),  -- 'YES' or 'NO'
  flag_was_correct BOOLEAN,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Update Logic:** Run a daily job that checks for newly resolved markets. For each resolved market that has entries in the ledger, compute `flag_was_correct = (flagged_direction == actual_outcome)`.

**Reporting:** Publish running accuracy rate, broken down by confidence level (how accurate are our high-confidence flags vs. medium vs. low?).

#### 5.4.2 Poll-Market Divergence Record

**Storage Schema:**
```sql
CREATE TABLE poll_market_divergence (
  id SERIAL PRIMARY KEY,
  market_id VARCHAR(66) NOT NULL,
  snapshot_timestamp TIMESTAMPTZ NOT NULL,
  market_probability DECIMAL(5,4) NOT NULL,
  polling_average DECIMAL(5,4),
  divergence DECIMAL(5,4),  -- market_prob - polling_avg
  market_credibility_score INTEGER,
  actual_outcome VARCHAR(5),  -- filled when market resolves
  market_was_closer BOOLEAN,  -- filled when market resolves
  poll_was_closer BOOLEAN     -- filled when market resolves
);
```

---

## 6. Database Schema

### 6.1 Core Tables

```sql
-- ============================================
-- MARKETS
-- ============================================
CREATE TABLE markets (
  condition_id VARCHAR(66) PRIMARY KEY,
  question TEXT NOT NULL,
  slug VARCHAR(255),
  event_id VARCHAR(66),
  category VARCHAR(100),
  outcomes JSONB NOT NULL,  -- ["Yes", "No"]
  clob_token_ids JSONB NOT NULL,  -- ["token_yes", "token_no"]
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  is_resolved BOOLEAN DEFAULT FALSE,
  resolved_outcome VARCHAR(50),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_markets_active ON markets(is_active);
CREATE INDEX idx_markets_category ON markets(category);
CREATE INDEX idx_markets_event ON markets(event_id);

-- ============================================
-- MARKET SNAPSHOTS (time-series)
-- ============================================
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
  book_depth_bid_5c DECIMAL(16,2),  -- total bid size within 5 cents of midpoint
  book_depth_ask_5c DECIMAL(16,2),  -- total ask size within 5 cents of midpoint
  unique_traders_24h INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_snapshots_market_time ON market_snapshots(market_id, timestamp DESC);
-- Consider TimescaleDB hypertable for this table at scale:
-- SELECT create_hypertable('market_snapshots', 'timestamp');

-- ============================================
-- TRADES
-- ============================================
CREATE TABLE trades (
  id BIGSERIAL PRIMARY KEY,
  market_id VARCHAR(66) NOT NULL REFERENCES markets(condition_id),
  wallet_address VARCHAR(42) NOT NULL,
  side VARCHAR(4) NOT NULL,  -- 'BUY' or 'SELL'
  size_tokens DECIMAL(20,6) NOT NULL,
  size_usdc DECIMAL(16,2) NOT NULL,
  price DECIMAL(8,6) NOT NULL,
  outcome VARCHAR(50) NOT NULL,
  outcome_index INTEGER NOT NULL,
  transaction_hash VARCHAR(66),
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_trades_market_time ON trades(market_id, timestamp DESC);
CREATE INDEX idx_trades_wallet ON trades(wallet_address, timestamp DESC);
CREATE INDEX idx_trades_market_wallet ON trades(market_id, wallet_address);
CREATE INDEX idx_trades_timestamp ON trades(timestamp DESC);

-- ============================================
-- WALLETS
-- ============================================
CREATE TABLE wallets (
  address VARCHAR(42) PRIMARY KEY,
  first_seen_chain TIMESTAMPTZ,  -- from Polygonscan: first-ever transaction
  first_seen_polymarket TIMESTAMPTZ,  -- first Polymarket trade
  total_markets_traded INTEGER DEFAULT 0,
  total_volume_usdc DECIMAL(16,2) DEFAULT 0,
  total_trades INTEGER DEFAULT 0,
  accuracy_score DECIMAL(5,4),  -- historical win rate on resolved markets
  accuracy_sample_size INTEGER DEFAULT 0,
  username VARCHAR(255),  -- Polymarket display name if public
  pseudonym VARCHAR(255),  -- Polymarket pseudonym if public
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_wallets_accuracy ON wallets(accuracy_score DESC) WHERE accuracy_sample_size >= 5;

-- ============================================
-- WALLET POSITIONS (current snapshot)
-- ============================================
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

CREATE INDEX idx_positions_market ON wallet_positions(market_id);
CREATE INDEX idx_positions_wallet ON wallet_positions(wallet_address);

-- ============================================
-- FLAGGED MOVES
-- ============================================
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
  wallet_concentration_top1 DECIMAL(5,4),  -- % of volume from top wallet
  wallet_concentration_top3 DECIMAL(5,4),  -- % of volume from top 3
  wallet_concentration_top5 DECIMAL(5,4),  -- % of volume from top 5
  flagged_wallet_count INTEGER DEFAULT 0,
  cluster_score DECIMAL(8,2),
  book_depth_at_start DECIMAL(16,2),
  confidence_score INTEGER NOT NULL,  -- 0-100
  informed_activity_index INTEGER NOT NULL,  -- 0-100
  catalyst_type VARCHAR(20),  -- 'EXPLAINED', 'UNEXPLAINED'
  catalyst_description TEXT,
  signal_direction VARCHAR(5),  -- 'YES' or 'NO' (which way the flagged wallets bet)
  summary_text TEXT NOT NULL,  -- plain-English diagnostic summary
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_flagged_market_time ON flagged_moves(market_id, detection_timestamp DESC);
CREATE INDEX idx_flagged_confidence ON flagged_moves(confidence_score DESC);

-- ============================================
-- CATALYSTS (external events)
-- ============================================
CREATE TABLE catalysts (
  id BIGSERIAL PRIMARY KEY,
  type VARCHAR(20) NOT NULL,  -- 'POLL', 'NEWS', 'EVENT', 'RULING', 'ANNOUNCEMENT'
  title TEXT NOT NULL,
  source VARCHAR(255),
  source_url TEXT,
  published_at TIMESTAMPTZ NOT NULL,
  keywords JSONB,
  matched_market_ids JSONB,  -- array of condition_ids this catalyst could affect
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_catalysts_time ON catalysts(published_at DESC);
CREATE INDEX idx_catalysts_type ON catalysts(type);

-- ============================================
-- WALLET CLUSTERS (Sybil detection)
-- ============================================
CREATE TABLE wallet_clusters (
  id BIGSERIAL PRIMARY KEY,
  cluster_id UUID NOT NULL,
  wallet_address VARCHAR(42) NOT NULL REFERENCES wallets(address),
  cluster_type VARCHAR(30) NOT NULL,  -- 'BEHAVIORAL', 'FUNDING_SOURCE', 'BOTH'
  confidence DECIMAL(5,4) NOT NULL,
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(cluster_id, wallet_address)
);

CREATE INDEX idx_clusters_wallet ON wallet_clusters(wallet_address);
CREATE INDEX idx_clusters_cluster ON wallet_clusters(cluster_id);

-- ============================================
-- SIGNAL ACCURACY LEDGER
-- ============================================
CREATE TABLE signal_accuracy_ledger (
  id BIGSERIAL PRIMARY KEY,
  flagged_move_id BIGINT REFERENCES flagged_moves(id),
  market_id VARCHAR(66) NOT NULL REFERENCES markets(condition_id),
  flag_timestamp TIMESTAMPTZ NOT NULL,
  confidence_score INTEGER NOT NULL,
  flagged_direction VARCHAR(5) NOT NULL,
  market_resolved_at TIMESTAMPTZ,
  actual_outcome VARCHAR(5),
  flag_was_correct BOOLEAN,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_accuracy_market ON signal_accuracy_ledger(market_id);
CREATE INDEX idx_accuracy_resolved ON signal_accuracy_ledger(flag_was_correct) WHERE market_resolved_at IS NOT NULL;

-- ============================================
-- ALERTS
-- ============================================
CREATE TABLE user_alerts (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  market_id VARCHAR(66) REFERENCES markets(condition_id),  -- NULL = all markets
  min_confidence_score INTEGER DEFAULT 70,
  alert_channel VARCHAR(20) DEFAULT 'email',  -- 'email', 'webhook'
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE alert_history (
  id BIGSERIAL PRIMARY KEY,
  alert_id BIGINT REFERENCES user_alerts(id),
  flagged_move_id BIGINT REFERENCES flagged_moves(id),
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  channel VARCHAR(20) NOT NULL,
  delivered BOOLEAN DEFAULT FALSE
);
```

---

## 7. Application Architecture

### 7.1 Tech Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| **Backend API** | Python + FastAPI | Async-native, auto-generated docs, Polymarket has official Python SDK |
| **Database** | PostgreSQL (+ TimescaleDB at scale) | Time-series + relational in one DB, mature ecosystem |
| **Cache / Queue** | Redis | Message broker for trade ingestion queue, cache for API responses |
| **Task Scheduler** | Celery (with Redis broker) or APScheduler | Periodic polling jobs, diagnostic pipeline, newsletter generation |
| **Frontend** | React + Next.js | SSR for SEO (Clearline Daily articles), real-time dashboard updates |
| **Email/Newsletter** | Resend or SendGrid | Alerting and Clearline Daily distribution |
| **Deployment** | Docker + Docker Compose (dev), AWS/GCP (prod) | Standard containerized deployment |
| **Monitoring** | Sentry (errors) + Prometheus/Grafana (metrics) | Track pipeline health, API latency, detection accuracy |

### 7.2 Service Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    INGESTION LAYER                       │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Market       │  │  Trade        │  │  Book         │  │
│  │  Poller       │  │  Monitor      │  │  Snapshotter  │  │
│  │  (5 min)      │  │  (WebSocket   │  │  (10 min)     │  │
│  │              │  │   + 2min poll) │  │              │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │                 │                  │          │
│         └────────────┬────┴──────────────────┘          │
│                      ▼                                  │
│              ┌───────────────┐                          │
│              │  Redis Queue   │                          │
│              └───────┬───────┘                          │
└──────────────────────┼──────────────────────────────────┘
                       │
┌──────────────────────┼──────────────────────────────────┐
│              ANALYSIS LAYER                              │
│                      ▼                                  │
│  ┌──────────────────────────────────┐                   │
│  │  Trade Processor Worker          │                   │
│  │  - Stores trades in PostgreSQL   │                   │
│  │  - Updates wallet profiles       │                   │
│  │  - Triggers move detection       │                   │
│  └──────────────┬───────────────────┘                   │
│                 │                                       │
│                 ▼                                       │
│  ┌──────────────────────────────────┐                   │
│  │  Diagnostic Pipeline             │                   │
│  │  - Move detection (thresholds)   │                   │
│  │  - Wallet signal computation     │                   │
│  │  - Cluster analysis              │                   │
│  │  - Catalyst matching             │                   │
│  │  - Confidence score generation   │                   │
│  │  - Summary text generation       │                   │
│  └──────────────┬───────────────────┘                   │
│                 │                                       │
│                 ▼                                       │
│  ┌──────────────────────────────────┐                   │
│  │  PostgreSQL                      │                   │
│  │  (all tables from Section 6)     │                   │
│  └──────────────┬───────────────────┘                   │
└──────────────────┼──────────────────────────────────────┘
                   │
┌──────────────────┼──────────────────────────────────────┐
│          APPLICATION LAYER                               │
│                  │                                       │
│  ┌───────────────┴───────────────────┐                  │
│  │  FastAPI Backend                  │                  │
│  │  - REST API for frontend          │                  │
│  │  - WebSocket for live updates     │                  │
│  │  - Auth & subscription management │                  │
│  └──────────────┬────────────────────┘                  │
│                 │                                       │
│    ┌────────────┼────────────┐                          │
│    ▼            ▼            ▼                          │
│  ┌──────┐  ┌──────────┐  ┌──────────┐                  │
│  │React │  │ Alert     │  │Newsletter│                  │
│  │Front │  │ Service   │  │Generator │                  │
│  │end   │  │ (email)   │  │(daily)   │                  │
│  └──────┘  └──────────┘  └──────────┘                  │
└─────────────────────────────────────────────────────────┘
```

### 7.3 API Endpoints (FastAPI Backend)

```
# Public endpoints (no auth)
GET  /api/v1/markets                    # List active markets with confidence scores
GET  /api/v1/markets/{id}               # Single market detail with full diagnostics
GET  /api/v1/markets/{id}/history       # Price and confidence score history
GET  /api/v1/markets/{id}/moves         # List of flagged moves for this market
GET  /api/v1/moves/{id}                 # Single flagged move diagnostic detail
GET  /api/v1/feed                       # Clearline Daily editorial feed

# Authenticated endpoints (free tier)
GET  /api/v1/me/alerts                  # User's alert configurations
POST /api/v1/me/alerts                  # Create new alert
PUT  /api/v1/me/alerts/{id}             # Update alert
DELETE /api/v1/me/alerts/{id}           # Delete alert
GET  /api/v1/me/followed-markets        # Markets the user follows

# Authenticated endpoints (Pro tier — paywall)
GET  /api/v1/markets/{id}/wallets       # Wallet-level breakdown for a market
GET  /api/v1/wallets/{address}          # Full wallet profile and history
GET  /api/v1/wallets/{address}/positions # Wallet's current positions
GET  /api/v1/moves/{id}/wallets         # Which wallets drove a specific move
GET  /api/v1/clusters/{id}              # Sybil cluster details
GET  /api/v1/accuracy                   # Signal accuracy ledger and statistics
```

---

## 8. Development Phases

### Phase 1: Data Foundation (Weeks 1–3)

**Goal:** Ingest and store all active political market data from Polymarket.

**Tasks:**
1. Set up PostgreSQL database with the schema from Section 6
2. Build the Market Poller service:
   - Hit Gamma API `GET /events?active=true&closed=false` every 5 minutes
   - Filter for political markets (by tag or keyword matching on `question` field)
   - Upsert into `markets` table
   - For each market, get CLOB token IDs and fetch current prices
   - Store in `market_snapshots` table
3. Build the Trade Monitor service:
   - For each active political market, poll Data API `GET /trades?market=CONDITION_ID` every 2 minutes
   - Store all trades in `trades` table
   - Deduplicate by `transaction_hash`
4. Build the Book Snapshotter service:
   - For each active political market, hit CLOB API `GET /book?token_id=TOKEN_ID` every 10 minutes
   - Store depth metrics in `market_snapshots` table

**Deliverable:** A PostgreSQL database being continuously populated with live market data, trade history, and order book snapshots.

### Phase 2: Wallet Profiling (Weeks 3–5)

**Goal:** Build wallet profiles from accumulated trade data and compute Tier 1 signals.

**Tasks:**
1. Build the Wallet Profile Builder:
   - For every unique wallet address in the `trades` table, create/update entry in `wallets` table
   - Compute `total_markets_traded`, `total_volume_usdc`, `total_trades` from trades
   - Look up `first_seen_chain` via Polygonscan API (cache permanently)
   - Look up `first_seen_polymarket` from earliest trade in `trades` table
2. Implement Tier 1 signal computations:
   - Wallet Age Delta (Section 5.1.1)
   - Trade Concentration (Section 5.1.2)
   - Position Size Relative to Market (Section 5.1.3)
   - Conviction Behavior (Section 5.1.4)
   - Entry Timing (Section 5.1.5)
3. Compute composite Tier 1 score for each wallet-market pair:
   ```
   composite_score = (
     wallet_age_delta_score * 0.25 +
     trade_concentration_score * 0.20 +
     position_size_score * 0.20 +
     conviction_score * 0.15 +
     entry_timing_score * 0.20
   )
   ```

**Deliverable:** Every wallet that trades on a political market has a profile with computed behavioral signals.

### Phase 3: Move Detection & Diagnostics (Weeks 5–7)

**Goal:** Automatically detect significant price movements and generate diagnostic reports.

**Tasks:**
1. Implement move detection:
   - Compare current snapshot prices to prices 30 minutes and 2 hours ago
   - Flag moves exceeding thresholds (start with 3pp for 30min, 5pp for 2hr)
   - Adjust thresholds dynamically based on market's historical volatility
2. For each detected move, run the diagnostic pipeline:
   - Gather all trades in the move window
   - Compute wallet concentration (top 1/3/5 share of volume)
   - Look up Tier 1 scores for all participating wallets
   - Compute Signal Clustering score (Section 5.2.1)
   - Compute Market Credibility Score (Section 5.3.1)
   - Compute Informed Activity Index (Section 5.3.2)
   - Generate plain-English summary text
3. Store results in `flagged_moves` table

**Deliverable:** Automated detection of significant moves with full diagnostic reports stored in the database.

### Phase 4: Frontend Dashboard (Weeks 7–10)

**Goal:** Build the user-facing web application.

**Tasks:**
1. Build FastAPI backend with endpoints from Section 7.3
2. Build React/Next.js frontend:
   - Market Feed page (list of markets with confidence badges)
   - Market Detail page (price chart, confidence score history, flagged moves list)
   - Move Diagnostic page (full breakdown: wallet concentration, timing, catalyst, summary)
   - Alert configuration page
   - User auth (email/password, free tier vs Pro)
3. Implement real-time updates via WebSocket or SSE
4. Implement paywall for Pro-tier endpoints

**Deliverable:** Working web application where users can browse markets, see confidence scores, read diagnostics, and configure alerts.

### Phase 5: Alerting & Newsletter (Weeks 10–12)

**Goal:** Proactive delivery of intelligence via email.

**Tasks:**
1. Build alert service:
   - When a new flagged move is created, check all user alerts for matching criteria
   - Send email via Resend/SendGrid with move summary and link to full diagnostic
2. Build Clearline Daily newsletter:
   - Daily cron job at 8am ET
   - Query the most interesting flagged moves from the past 24 hours
   - Generate newsletter content (templated summaries initially)
   - Send via newsletter service

**Deliverable:** Users receive timely alerts for moves matching their criteria, and all subscribers receive a daily newsletter.

### Phase 6: Advanced Analytics (Weeks 12+)

**Goal:** Add Tier 2 pattern detection and Tier 4 calibration.

**Tasks:**
1. Behavioral Fingerprinting (Section 5.2.2)
2. Funding Source Correlation (Section 5.2.3)
3. Cross-Market Position Mapping (Section 5.2.4)
4. Evasion Sophistication Score (Section 5.3.4)
5. External Catalyst Matching (Section 5.3.3)
6. Signal Accuracy Ledger (Section 5.4.1)
7. Poll-Market Divergence tracking (Section 5.4.2)

---

## 9. Python SDK Reference

Polymarket provides official Python and TypeScript SDKs.

### 9.1 py-clob-client (CLOB API)

```bash
pip install py-clob-client
```

**Read-only usage (no auth needed):**
```python
from py_clob_client.client import ClobClient
from py_clob_client.clob_types import BookParams

client = ClobClient("https://clob.polymarket.com")

# Get midpoint price
mid = client.get_midpoint("TOKEN_ID")

# Get best executable price
price = client.get_price("TOKEN_ID", side="BUY")

# Get full order book
book = client.get_order_book("TOKEN_ID")

# Batch order books (RECOMMENDED to reduce API calls)
books = client.get_order_books([
    BookParams(token_id="TOKEN_ID_1"),
    BookParams(token_id="TOKEN_ID_2"),
])

# Get last trade price
last = client.get_last_trade_price("TOKEN_ID")

# Get spread
spread = client.get_spread("TOKEN_ID")
```

### 9.2 Data API (direct HTTP)

No SDK — use `httpx` or `requests`:

```python
import httpx

DATA_API = "https://data-api.polymarket.com"
GAMMA_API = "https://gamma-api.polymarket.com"

async def get_wallet_positions(wallet_address: str):
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{DATA_API}/positions", params={
            "user": wallet_address,
            "sortBy": "CURRENT",
            "sortDirection": "DESC"
        })
        return resp.json()

async def get_wallet_activity(wallet_address: str, market_id: str = None):
    params = {
        "user": wallet_address,
        "type": "TRADE",
        "sortBy": "TIMESTAMP",
        "sortDirection": "ASC"
    }
    if market_id:
        params["market"] = market_id
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{DATA_API}/activity", params=params)
        return resp.json()

async def get_market_trades(market_id: str):
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{DATA_API}/trades", params={
            "market": market_id,
            "sortBy": "TIMESTAMP",
            "sortDirection": "DESC"
        })
        return resp.json()

async def get_market_holders(condition_id: str):
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{DATA_API}/holders", params={
            "market": condition_id
        })
        return resp.json()

async def get_active_political_markets():
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{GAMMA_API}/events", params={
            "active": "true",
            "closed": "false",
            "tag": "politics",
            "limit": 100
        })
        return resp.json()
```

### 9.3 Polygonscan API

```python
import httpx

POLYGONSCAN_API = "https://api.polygonscan.com/api"
POLYGONSCAN_KEY = "YOUR_API_KEY"

async def get_wallet_creation_date(wallet_address: str) -> int:
    """Returns unix timestamp of first-ever transaction for this wallet."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(POLYGONSCAN_API, params={
            "module": "account",
            "action": "txlist",
            "address": wallet_address,
            "startblock": 0,
            "endblock": 99999999,
            "page": 1,
            "offset": 1,
            "sort": "asc",
            "apikey": POLYGONSCAN_KEY
        })
        data = resp.json()
        if data["status"] == "1" and data["result"]:
            return int(data["result"][0]["timeStamp"])
        return None
```

---

## 10. Key Configuration Constants

These are the tunable parameters that control the system's sensitivity. Start with these defaults and adjust based on observed accuracy.

```python
# Move Detection
MOVE_THRESHOLD_30MIN_PP = 3.0      # percentage point change to flag in 30min window
MOVE_THRESHOLD_2HR_PP = 5.0        # percentage point change to flag in 2hr window
MOVE_MIN_VOLUME_USD = 500          # minimum volume during move to bother analyzing

# Wallet Flagging
WALLET_AGE_DELTA_HIGH_HOURS = 1    # wallet created < 1hr before trade = max flag
WALLET_AGE_DELTA_MED_DAYS = 7     # wallet created < 7 days before trade = moderate flag
TRADE_CONCENTRATION_HIGH = 0.70    # 70%+ in one market = high concentration
POSITION_SIZE_RELATIVE_HIGH = 0.25 # trade size > 25% of daily volume = max flag

# Clustering
CLUSTER_TIME_WINDOW_HOURS = 72     # look for flagged wallets within 72hr window
CLUSTER_MIN_WALLETS = 3            # need at least 3 flagged wallets for a cluster
COMPOSITE_SCORE_FLAG_THRESHOLD = 0.5  # Tier 1 composite > 0.5 = wallet is flagged

# Confidence Score
CREDIBILITY_SCORE_GREEN = 70       # >= 70 = green badge (trustworthy)
CREDIBILITY_SCORE_YELLOW = 40      # 40-69 = yellow badge (uncertain)
# < 40 = red badge (low confidence)

# Polling Intervals
MARKET_POLL_INTERVAL_SECONDS = 300  # 5 minutes
TRADE_POLL_INTERVAL_SECONDS = 120   # 2 minutes
BOOK_POLL_INTERVAL_SECONDS = 600    # 10 minutes
CATALYST_POLL_INTERVAL_SECONDS = 1800  # 30 minutes

# Rate Limit Safety
POLYMARKET_MAX_REQUESTS_PER_HOUR = 900  # stay under 1000 limit with buffer
POLYGONSCAN_MAX_REQUESTS_PER_SECOND = 4 # stay under 5/sec limit with buffer
```

---

## 11. File Structure

```
clearline/
├── README.md
├── CLEARLINE_SPEC.md              # This document
├── docker-compose.yml
├── .env.example
│
├── backend/
│   ├── requirements.txt
│   ├── alembic/                   # Database migrations
│   │   └── versions/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py               # FastAPI app entry point
│   │   ├── config.py             # Configuration constants (Section 10)
│   │   ├── database.py           # PostgreSQL connection + session
│   │   │
│   │   ├── models/               # SQLAlchemy models (Section 6)
│   │   │   ├── __init__.py
│   │   │   ├── market.py
│   │   │   ├── trade.py
│   │   │   ├── wallet.py
│   │   │   ├── flagged_move.py
│   │   │   ├── catalyst.py
│   │   │   ├── wallet_cluster.py
│   │   │   ├── alert.py
│   │   │   └── accuracy.py
│   │   │
│   │   ├── ingestion/            # Layer 1: Data ingestion services
│   │   │   ├── __init__.py
│   │   │   ├── market_poller.py      # Gamma API polling
│   │   │   ├── trade_monitor.py      # Data API trade polling + WebSocket
│   │   │   ├── book_snapshotter.py   # CLOB API order book polling
│   │   │   └── catalyst_fetcher.py   # News/polls external data
│   │   │
│   │   ├── analysis/             # Layers 2-3: Analytics engine
│   │   │   ├── __init__.py
│   │   │   ├── wallet_profiler.py    # Tier 1 signal computation
│   │   │   ├── move_detector.py      # Detect significant price moves
│   │   │   ├── diagnostic.py         # Full diagnostic pipeline
│   │   │   ├── clustering.py         # Tier 2 pattern detection
│   │   │   ├── credibility.py        # Market Credibility Score
│   │   │   ├── informed_activity.py  # Informed Activity Index
│   │   │   ├── catalyst_matcher.py   # Catalyst attribution
│   │   │   └── accuracy_tracker.py   # Signal Accuracy Ledger
│   │   │
│   │   ├── api/                  # Layer 5: FastAPI routes
│   │   │   ├── __init__.py
│   │   │   ├── markets.py
│   │   │   ├── moves.py
│   │   │   ├── wallets.py
│   │   │   ├── alerts.py
│   │   │   ├── feed.py
│   │   │   └── auth.py
│   │   │
│   │   ├── services/             # Layer 6: Distribution
│   │   │   ├── __init__.py
│   │   │   ├── alerting.py           # Email alert service
│   │   │   └── newsletter.py         # Clearline Daily generation
│   │   │
│   │   └── clients/              # External API clients
│   │       ├── __init__.py
│   │       ├── polymarket.py         # Wrapper for all Polymarket APIs
│   │       ├── polygonscan.py        # Polygonscan API client
│   │       └── news.py              # News API client
│   │
│   └── tests/
│       ├── test_wallet_profiler.py
│       ├── test_move_detector.py
│       ├── test_diagnostic.py
│       └── test_api.py
│
├── frontend/
│   ├── package.json
│   ├── next.config.js
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx              # Market feed (home)
│   │   │   ├── markets/
│   │   │   │   └── [id]/page.tsx     # Market detail
│   │   │   ├── moves/
│   │   │   │   └── [id]/page.tsx     # Move diagnostic
│   │   │   ├── alerts/page.tsx       # Alert management
│   │   │   └── feed/page.tsx         # Clearline Daily
│   │   ├── components/
│   │   │   ├── MarketCard.tsx
│   │   │   ├── ConfidenceBadge.tsx
│   │   │   ├── DiagnosticPanel.tsx
│   │   │   ├── PriceChart.tsx
│   │   │   └── AlertConfig.tsx
│   │   └── lib/
│   │       ├── api.ts                # Backend API client
│   │       └── types.ts              # TypeScript types
│   └── public/
│
└── scripts/
    ├── seed_markets.py               # Initial market data load
    ├── backfill_trades.py            # Backfill historical trades
    └── run_diagnostics.py            # Manual diagnostic trigger
```

---

## 12. Environment Variables

```bash
# Database
DATABASE_URL=postgresql://clearline:password@localhost:5432/clearline

# Redis
REDIS_URL=redis://localhost:6379/0

# Polymarket APIs (no auth needed for read)
GAMMA_API_URL=https://gamma-api.polymarket.com
CLOB_API_URL=https://clob.polymarket.com
DATA_API_URL=https://data-api.polymarket.com
WS_URL=wss://ws-subscriptions-clob.polymarket.com/ws/

# External APIs
POLYGONSCAN_API_KEY=your_key_here
NEWS_API_KEY=your_key_here              # NewsAPI.org

# Email
RESEND_API_KEY=your_key_here
ALERT_FROM_EMAIL=alerts@clearline.io
NEWSLETTER_FROM_EMAIL=daily@clearline.io

# App
SECRET_KEY=your_secret_key
JWT_ALGORITHM=HS256
ENVIRONMENT=development                 # development | staging | production
```

---

## 13. Glossary

| Term | Definition |
|------|-----------|
| **Condition ID** | Unique on-chain identifier for a Polymarket market. Used as primary key across APIs. |
| **CLOB** | Central Limit Order Book — Polymarket's hybrid-decentralized order matching system. |
| **CTF** | Conditional Token Framework — The smart contract standard for creating outcome tokens. |
| **Outcome Token** | An ERC-1155 token representing one outcome (YES or NO). Pays $1 if correct, $0 if wrong. |
| **Proxy Wallet** | The wallet address associated with a Polymarket user account (especially email login users). |
| **Midpoint** | The price halfway between the best bid and best ask — more accurate than last trade price. |
| **Gamma API** | Polymarket's market metadata and discovery API. |
| **Data API** | Polymarket's user/wallet data API (positions, trades, activity). |
| **Whale** | A trader with outsized position sizes relative to a market. |
| **Sybil** | Multiple wallet addresses controlled by the same entity to disguise concentration. |
| **Catalyst** | An external event (poll, news, ruling) that explains a market price movement. |
| **Flagged Move** | A significant price change that Clearline has analyzed and diagnosed. |
| **Confidence Score** | Clearline's 0-100 rating of how trustworthy a market's current price is. |
| **Informed Activity Index** | Clearline's 0-100 rating of how much trading appears driven by insider-like wallets. |