export type SignalLevel = "high" | "medium" | "low";

export type Category =
  | "presidential"
  | "senate"
  | "gubernatorial"
  | "policy"
  | "crypto"
  | "economic"
  | "weather"
  | "sports";

export interface Market {
  id: number;
  title: string;
  category: Category;
  updatedAt: string;
  signal: SignalLevel;
  probability: number; // 0–100
  change: number;      // percentage point change (positive = up)
  volume: number;      // raw dollars
}

const POLITICAL_CATEGORIES: Category[] = [
  "presidential",
  "senate",
  "gubernatorial",
  "policy",
];

export function getMarketTab(category: Category): "political" | "other" {
  return POLITICAL_CATEGORIES.includes(category) ? "political" : "other";
}

export function formatVolume(volume: number): string {
  if (volume >= 1_000_000) return `${(volume / 1_000_000).toFixed(2)}M`;
  if (volume >= 1_000) return `${(volume / 1_000).toFixed(1)}K`;
  return `${volume}`;
}

export const MARKETS: Market[] = [
  {
    id: 1,
    title: "Will Donald Trump win the 2028 Republican nomination?",
    category: "presidential",
    updatedAt: "about 23 hours ago",
    signal: "high",
    probability: 67,
    change: 16.0,
    volume: 2_450_000,
  },
  {
    id: 7,
    title: "Bitcoin above $100,000 by end of 2026?",
    category: "crypto",
    updatedAt: "about 22 hours ago",
    signal: "high",
    probability: 58,
    change: 13.0,
    volume: 3_200_000,
  },
  {
    id: 9,
    title: "Fed interest rate cut by June 2026?",
    category: "economic",
    updatedAt: "about 24 hours ago",
    signal: "high",
    probability: 42,
    change: -11.0,
    volume: 2_100_000,
  },
  {
    id: 5,
    title: "Pennsylvania Senate 2026: Democrat or Republican?",
    category: "senate",
    updatedAt: "1 day ago",
    signal: "high",
    probability: 52,
    change: 8.0,
    volume: 1_200_000,
  },
  {
    id: 2,
    title: "Michigan Senate: Democrat or Republican 2026?",
    category: "senate",
    updatedAt: "about 24 hours ago",
    signal: "medium",
    probability: 48,
    change: 6.0,
    volume: 890_000,
  },
  {
    id: 4,
    title: "Will federal minimum wage increase pass in 2026?",
    category: "policy",
    updatedAt: "1 day ago",
    signal: "low",
    probability: 34,
    change: 5.0,
    volume: 560_000,
  },
  {
    id: 13,
    title: "Lakers to win NBA Championship 2026?",
    category: "sports",
    updatedAt: "1 day ago",
    signal: "medium",
    probability: 18,
    change: -4.0,
    volume: 1_100_000,
  },
  {
    id: 8,
    title: "Ethereum ETF approval in Q1 2026?",
    category: "crypto",
    updatedAt: "about 22 hours ago",
    signal: "medium",
    probability: 71,
    change: 3.0,
    volume: 1_800_000,
  },
  {
    id: 10,
    title: "S&P 500 to reach 6,000 by year end?",
    category: "economic",
    updatedAt: "1 day ago",
    signal: "low",
    probability: 64,
    change: 3.0,
    volume: 1_500_000,
  },
  {
    id: 11,
    title: "US inflation below 2% by Q3 2026?",
    category: "economic",
    updatedAt: "1 day ago",
    signal: "medium",
    probability: 37,
    change: 3.0,
    volume: 980_000,
  },
  {
    id: 12,
    title: "2026 Atlantic hurricane season: Above average activity?",
    category: "weather",
    updatedAt: "1 day ago",
    signal: "low",
    probability: 55,
    change: 3.0,
    volume: 420_000,
  },
  {
    id: 3,
    title: "California Governor 2026: Will Newsom run again?",
    category: "gubernatorial",
    updatedAt: "1 day ago",
    signal: "low",
    probability: 73,
    change: 2.0,
    volume: 320_000,
  },
  {
    id: 6,
    title: "Texas Governor 2026: Will Abbott seek reelection?",
    category: "gubernatorial",
    updatedAt: "1 day ago",
    signal: "medium",
    probability: 81,
    change: 1.0,
    volume: 280_000,
  },
];
