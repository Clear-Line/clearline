export type Category =
  | 'politics'
  | 'crypto'
  | 'economics'
  | 'geopolitics'
  | 'culture'
  | 'sports'
  | 'weather'
  | 'other';

// Sports tested FIRST so "Trump at Super Bowl" doesn't get labeled politics.
// Covers every major league/tour/event we've seen leak through: NA majors,
// soccer leagues, tennis/golf majors, motorsports, combat sports, Olympics.
const SPORTS_REGEX =
  /\b(nba|nfl|mlb|nhl|mls|super bowl|world cup|world series|stanley cup|nba finals|championship|playoff|olympics?|premier league|la liga|bundesliga|champions league|ligue 1|serie a|uefa|fifa|tennis|wimbledon|us open|french open|australian open|atp|wta|golf|pga|masters|ryder cup|boxing|knockout|ufc|mma|formula 1|f1|grand prix|nascar|cricket|rugby|quarterback|touchdown|bout|versus|tournament)\b|\bvs\.?\b/i;

const POLITICS_REGEX =
  /\b(president|gop|democrat|republican|election|senate|governor|congress|vote|primary|caucus|ballot|trump|biden|harris)\b/i;

const GEOPOLITICS_REGEX =
  /\b(iran|israel|gaza|ukraine|russia|china|taiwan|war|conflict|sanctions|military|nato|ceasefire|invasion|missile|nuclear|north korea|houthi|hezbollah|syria|yemen|coup|terror)\b/i;

const ECONOMICS_REGEX =
  /\b(fed|interest rate|inflation|gdp|s&p|nasdaq|recession|unemployment|tariff|trade war|oil price|treasury|debt ceiling|stock market|dow jones)\b/i;

const CRYPTO_REGEX =
  /\b(bitcoin|btc|ethereum|eth|crypto|token|defi|solana|sol|dogecoin|doge|xrp|ripple|cardano|ada|bnb|binance)\b/i;

const WEATHER_REGEX = /\b(hurricane|tornado|temperature|weather|climate)\b/i;

export function categorizeMarket(question: string, tags?: string[]): Category {
  // Polymarket's own tags are more reliable than regex — trust them first.
  if (tags?.includes('sports')) return 'sports';
  if (tags?.includes('crypto')) return 'crypto';
  if (tags?.includes('politics')) return 'politics';

  const q = question ?? '';
  if (SPORTS_REGEX.test(q)) return 'sports';
  if (POLITICS_REGEX.test(q)) return 'politics';
  if (GEOPOLITICS_REGEX.test(q)) return 'geopolitics';
  if (ECONOMICS_REGEX.test(q)) return 'economics';
  if (CRYPTO_REGEX.test(q)) return 'crypto';
  if (WEATHER_REGEX.test(q)) return 'weather';
  return 'other';
}

// Deterministic ordering — check most-common first so ambiguous "BTC vs ETH"
// titles get a predictable answer that keeps pair-grouping stable across runs.
const UNDERLYING_PATTERNS: Array<[string, RegExp]> = [
  ['btc', /\b(bitcoin|btc)\b/i],
  ['eth', /\b(ethereum|eth)\b/i],
  ['sol', /\b(solana|sol)\b/i],
  ['doge', /\b(dogecoin|doge)\b/i],
  ['xrp', /\b(xrp|ripple)\b/i],
  ['ada', /\b(cardano|ada)\b/i],
  ['bnb', /\b(bnb|binance coin)\b/i],
];

export function extractCryptoUnderlying(question: string): string | null {
  const q = question ?? '';
  for (const [name, regex] of UNDERLYING_PATTERNS) {
    if (regex.test(q)) return name;
  }
  return null;
}

export interface SameUnderlyingPair {
  market_a: string;
  market_b: string;
  underlying: string;
}

export function buildSameUnderlyingPairs(
  markets: { id: string; question: string }[],
): SameUnderlyingPair[] {
  const byUnderlying = new Map<string, string[]>();
  for (const m of markets) {
    const u = extractCryptoUnderlying(m.question);
    if (!u) continue;
    const list = byUnderlying.get(u) ?? [];
    list.push(m.id);
    byUnderlying.set(u, list);
  }

  const pairs: SameUnderlyingPair[] = [];
  for (const [underlying, ids] of byUnderlying) {
    const sorted = [...ids].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        pairs.push({ market_a: sorted[i], market_b: sorted[j], underlying });
      }
    }
  }
  return pairs;
}
