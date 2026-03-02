export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface Market {
  id: string;
  title: string;
  category: 'presidential' | 'senate' | 'gubernatorial' | 'policy' | 'crypto' | 'economic' | 'weather' | 'sports' | 'entertainment' | 'geopolitics';
  section: 'political' | 'economics' | 'geopolitics' | 'other';
  currentOdds: number;
  previousOdds: number;
  change: number;
  volume24h: number;
  confidence: ConfidenceLevel;
  lastUpdated: Date;
  liquidity: number;
}

export interface MarketMove {
  id: string;
  marketId: string;
  marketTitle: string;
  timestamp: Date;
  oddsChange: number;
  confidence: ConfidenceLevel;
  summary: string;
  volumeProfile: {
    totalVolume: number;
    uniqueWallets: number;
    topWalletConcentration: number;
  };
  walletBreakdown: {
    walletId: string;
    percentage: number;
    accuracy: number;
    specialization: string;
  }[];
  liquidity: {
    beforeMove: number;
    duringMove: number;
    afterMove: number;
  };
  correlatedMarkets: {
    marketId: string;
    title: string;
    correlation: number;
  }[];
  externalCatalysts: {
    type: string;
    description: string;
    timestamp: Date;
  }[];
  chartData: {
    time: string;
    odds: number;
    volume: number;
  }[];
}

export interface Wallet {
  id: string;
  accuracy: number;
  totalTrades: number;
  specialization: string;
  avgLeadTime: number; // hours
  recentActivity: {
    marketTitle: string;
    position: string;
    timestamp: Date;
  }[];
  performanceHistory: {
    month: string;
    accuracy: number;
  }[];
}

export interface NewsStory {
  id: string;
  title: string;
  summary: string;
  marketId: string;
  confidence: ConfidenceLevel;
  timestamp: Date;
  author: string;
  readTime: number;
}

// Mock Markets Data
export const mockMarkets: Market[] = [
  // Political Markets
  {
    id: '1',
    title: 'Will Donald Trump win the 2028 Republican nomination?',
    category: 'presidential',
    section: 'political',
    currentOdds: 0.67,
    previousOdds: 0.51,
    change: 0.16,
    volume24h: 2450000,
    confidence: 'high',
    lastUpdated: new Date('2026-02-18T14:30:00'),
    liquidity: 8500000,
  },
  {
    id: '2',
    title: 'Michigan Senate: Democrat or Republican 2026?',
    category: 'senate',
    section: 'political',
    currentOdds: 0.48,
    previousOdds: 0.42,
    change: 0.06,
    volume24h: 890000,
    confidence: 'medium',
    lastUpdated: new Date('2026-02-18T13:15:00'),
    liquidity: 3200000,
  },
  {
    id: '3',
    title: 'California Governor 2026: Will Newsom run again?',
    category: 'gubernatorial',
    section: 'political',
    currentOdds: 0.73,
    previousOdds: 0.71,
    change: 0.02,
    volume24h: 320000,
    confidence: 'low',
    lastUpdated: new Date('2026-02-18T12:45:00'),
    liquidity: 1100000,
  },
  {
    id: '4',
    title: 'Will federal minimum wage increase pass in 2026?',
    category: 'policy',
    section: 'political',
    currentOdds: 0.34,
    previousOdds: 0.29,
    change: 0.05,
    volume24h: 560000,
    confidence: 'low',
    lastUpdated: new Date('2026-02-18T11:20:00'),
    liquidity: 1800000,
  },
  {
    id: '5',
    title: 'Pennsylvania Senate 2026: Democrat or Republican?',
    category: 'senate',
    section: 'political',
    currentOdds: 0.52,
    previousOdds: 0.44,
    change: 0.08,
    volume24h: 1200000,
    confidence: 'high',
    lastUpdated: new Date('2026-02-18T10:00:00'),
    liquidity: 4500000,
  },
  {
    id: '6',
    title: 'Texas Governor 2026: Will Abbott seek reelection?',
    category: 'gubernatorial',
    section: 'political',
    currentOdds: 0.81,
    previousOdds: 0.80,
    change: 0.01,
    volume24h: 280000,
    confidence: 'medium',
    lastUpdated: new Date('2026-02-18T09:30:00'),
    liquidity: 950000,
  },
  // Economic Markets
  {
    id: '9',
    title: 'Fed interest rate cut by June 2026?',
    category: 'economic',
    section: 'economics',
    currentOdds: 0.42,
    previousOdds: 0.53,
    change: -0.11,
    volume24h: 2100000,
    confidence: 'high',
    lastUpdated: new Date('2026-02-18T13:30:00'),
    liquidity: 7800000,
  },
  {
    id: '10',
    title: 'S&P 500 to reach 6,000 by year end?',
    category: 'economic',
    section: 'economics',
    currentOdds: 0.64,
    previousOdds: 0.61,
    change: 0.03,
    volume24h: 1500000,
    confidence: 'low',
    lastUpdated: new Date('2026-02-18T12:00:00'),
    liquidity: 4300000,
  },
  {
    id: '11',
    title: 'US inflation below 2% by Q3 2026?',
    category: 'economic',
    section: 'economics',
    currentOdds: 0.37,
    previousOdds: 0.34,
    change: 0.03,
    volume24h: 980000,
    confidence: 'medium',
    lastUpdated: new Date('2026-02-18T11:45:00'),
    liquidity: 3100000,
  },
  // Geopolitics / Current Events
  {
    id: '12',
    title: 'Will Iran reach a nuclear deal by end of 2026?',
    category: 'geopolitics',
    section: 'geopolitics',
    currentOdds: 0.22,
    previousOdds: 0.25,
    change: -0.03,
    volume24h: 890000,
    confidence: 'medium',
    lastUpdated: new Date('2026-02-18T10:30:00'),
    liquidity: 2800000,
  },
  {
    id: '13',
    title: 'Ukraine-Russia ceasefire before July 2026?',
    category: 'geopolitics',
    section: 'geopolitics',
    currentOdds: 0.15,
    previousOdds: 0.18,
    change: -0.03,
    volume24h: 1500000,
    confidence: 'medium',
    lastUpdated: new Date('2026-02-18T09:15:00'),
    liquidity: 4200000,
  },
];

// Mock Market Move Data
export const mockMarketMove: MarketMove = {
  id: 'move-1',
  marketId: '2',
  marketTitle: 'Michigan Senate: Democrat or Republican 2026?',
  timestamp: new Date('2026-02-18T13:15:00'),
  oddsChange: 0.06,
  confidence: 'medium',
  summary: '6-point shift driven by moderately diversified buying following new Emerson poll showing Republican gaining ground in suburban Detroit.',
  volumeProfile: {
    totalVolume: 340000,
    uniqueWallets: 47,
    topWalletConcentration: 0.34,
  },
  walletBreakdown: [
    { walletId: 'w-1a2b3c', percentage: 34, accuracy: 68, specialization: 'Senate races' },
    { walletId: 'w-4d5e6f', percentage: 18, accuracy: 72, specialization: 'Midwest politics' },
    { walletId: 'w-7g8h9i', percentage: 12, accuracy: 55, specialization: 'General political' },
    { walletId: 'Other (44)', percentage: 36, accuracy: 61, specialization: 'Various' },
  ],
  liquidity: {
    beforeMove: 3100000,
    duringMove: 3250000,
    afterMove: 3200000,
  },
  correlatedMarkets: [
    { marketId: '5', title: 'Pennsylvania Senate 2026', correlation: 0.73 },
    { marketId: '1', title: 'Trump 2028 GOP nomination', correlation: 0.41 },
  ],
  externalCatalysts: [
    {
      type: 'Polling Release',
      description: 'Emerson College poll shows Republican +3 in Michigan Senate race (Feb 18, 11:00 AM)',
      timestamp: new Date('2026-02-18T11:00:00'),
    },
    {
      type: 'News Event',
      description: 'Detroit Free Press publishes profile of Republican candidate (Feb 18, 9:30 AM)',
      timestamp: new Date('2026-02-18T09:30:00'),
    },
  ],
  chartData: [
    { time: '09:00', odds: 42, volume: 12000 },
    { time: '10:00', odds: 42, volume: 18000 },
    { time: '11:00', odds: 43, volume: 45000 },
    { time: '12:00', odds: 46, volume: 89000 },
    { time: '13:00', odds: 48, volume: 124000 },
    { time: '14:00', odds: 48, volume: 52000 },
  ],
};

// Mock Wallets Data
export const mockWallets: Wallet[] = [
  {
    id: 'w-4d5e6f',
    accuracy: 72,
    totalTrades: 143,
    specialization: 'Midwest politics',
    avgLeadTime: 18,
    recentActivity: [
      { marketTitle: 'Michigan Senate 2026', position: 'Republican +$58k', timestamp: new Date('2026-02-18T13:15:00') },
      { marketTitle: 'Wisconsin Governor 2026', position: 'Democrat +$32k', timestamp: new Date('2026-02-17T16:20:00') },
      { marketTitle: 'Ohio Senate 2026', position: 'Republican +$41k', timestamp: new Date('2026-02-16T10:45:00') },
    ],
    performanceHistory: [
      { month: 'Feb', accuracy: 72 },
      { month: 'Jan', accuracy: 69 },
      { month: 'Dec', accuracy: 74 },
      { month: 'Nov', accuracy: 71 },
      { month: 'Oct', accuracy: 68 },
      { month: 'Sep', accuracy: 70 },
    ],
  },
  {
    id: 'w-1a2b3c',
    accuracy: 68,
    totalTrades: 287,
    specialization: 'Senate races',
    avgLeadTime: 24,
    recentActivity: [
      { marketTitle: 'Michigan Senate 2026', position: 'Republican +$115k', timestamp: new Date('2026-02-18T13:10:00') },
      { marketTitle: 'Nevada Senate 2026', position: 'Democrat +$67k', timestamp: new Date('2026-02-18T08:30:00') },
      { marketTitle: 'Arizona Senate 2026', position: 'Republican +$89k', timestamp: new Date('2026-02-17T14:15:00') },
    ],
    performanceHistory: [
      { month: 'Feb', accuracy: 68 },
      { month: 'Jan', accuracy: 71 },
      { month: 'Dec', accuracy: 67 },
      { month: 'Nov', accuracy: 69 },
      { month: 'Oct', accuracy: 72 },
      { month: 'Sep', accuracy: 70 },
    ],
  },
  {
    id: 'w-9k8j7h',
    accuracy: 76,
    totalTrades: 94,
    specialization: 'Presidential primaries',
    avgLeadTime: 36,
    recentActivity: [
      { marketTitle: 'Trump 2028 GOP nomination', position: 'Yes +$143k', timestamp: new Date('2026-02-18T14:20:00') },
      { marketTitle: 'DeSantis 2028 GOP nomination', position: 'No +$78k', timestamp: new Date('2026-02-17T11:00:00') },
    ],
    performanceHistory: [
      { month: 'Feb', accuracy: 76 },
      { month: 'Jan', accuracy: 78 },
      { month: 'Dec', accuracy: 74 },
      { month: 'Nov', accuracy: 75 },
      { month: 'Oct', accuracy: 73 },
      { month: 'Sep', accuracy: 77 },
    ],
  },
  {
    id: 'w-3c4v5b',
    accuracy: 71,
    totalTrades: 198,
    specialization: 'Policy outcomes',
    avgLeadTime: 12,
    recentActivity: [
      { marketTitle: 'Federal minimum wage 2026', position: 'Yes +$45k', timestamp: new Date('2026-02-18T11:45:00') },
      { marketTitle: 'Student loan reform 2026', position: 'No +$52k', timestamp: new Date('2026-02-17T15:30:00') },
    ],
    performanceHistory: [
      { month: 'Feb', accuracy: 71 },
      { month: 'Jan', accuracy: 70 },
      { month: 'Dec', accuracy: 73 },
      { month: 'Nov', accuracy: 69 },
      { month: 'Oct', accuracy: 71 },
      { month: 'Sep', accuracy: 72 },
    ],
  },
  {
    id: 'w-8x9y0z',
    accuracy: 78,
    totalTrades: 156,
    specialization: 'Crypto markets',
    avgLeadTime: 8,
    recentActivity: [
      { marketTitle: 'Bitcoin above $100k', position: 'Yes +$92k', timestamp: new Date('2026-02-18T15:00:00') },
      { marketTitle: 'Ethereum ETF approval', position: 'Yes +$67k', timestamp: new Date('2026-02-18T14:30:00') },
      { marketTitle: 'Solana market cap', position: 'No +$34k', timestamp: new Date('2026-02-17T16:00:00') },
    ],
    performanceHistory: [
      { month: 'Feb', accuracy: 78 },
      { month: 'Jan', accuracy: 76 },
      { month: 'Dec', accuracy: 79 },
      { month: 'Nov', accuracy: 77 },
      { month: 'Oct', accuracy: 75 },
      { month: 'Sep', accuracy: 78 },
    ],
  },
  {
    id: 'w-5m6n7p',
    accuracy: 74,
    totalTrades: 213,
    specialization: 'Macro economics',
    avgLeadTime: 22,
    recentActivity: [
      { marketTitle: 'Fed rate cut June 2026', position: 'No +$128k', timestamp: new Date('2026-02-18T13:30:00') },
      { marketTitle: 'Inflation below 2%', position: 'No +$56k', timestamp: new Date('2026-02-18T11:00:00') },
      { marketTitle: 'S&P 500 6000', position: 'Yes +$73k', timestamp: new Date('2026-02-17T14:15:00') },
    ],
    performanceHistory: [
      { month: 'Feb', accuracy: 74 },
      { month: 'Jan', accuracy: 73 },
      { month: 'Dec', accuracy: 75 },
      { month: 'Nov', accuracy: 72 },
      { month: 'Oct', accuracy: 74 },
      { month: 'Sep', accuracy: 73 },
    ],
  },
];

// Mock News Stories
export const mockNewsStories: NewsStory[] = [
  {
    id: 'news-1',
    title: 'Michigan Senate odds shift is real — but watch for reversal',
    summary: 'The 6-point move toward Republicans came on moderate volume after an Emerson poll, but 34% concentration in one wallet suggests caution.',
    marketId: '2',
    confidence: 'medium',
    timestamp: new Date('2026-02-18T14:00:00'),
    author: 'Clearline Analysis',
    readTime: 3,
  },
  {
    id: 'news-2',
    title: 'Trump 2028 nomination surge backed by broad buying',
    summary: 'High-confidence move as 16-point odds increase came from 200+ wallets with strong track records, correlated with DeSantis decline.',
    marketId: '1',
    confidence: 'high',
    timestamp: new Date('2026-02-18T14:30:00'),
    author: 'Clearline Analysis',
    readTime: 4,
  },
  {
    id: 'news-3',
    title: 'Iran nuclear deal odds dropping — informed money selling',
    summary: 'High-confidence 3-point drop driven by geopolitics-focused wallets after IAEA report. Correlated with broader Middle East market activity.',
    marketId: '12',
    confidence: 'high',
    timestamp: new Date('2026-02-18T15:15:00'),
    author: 'Clearline Analysis',
    readTime: 4,
  },
  {
    id: 'news-4',
    title: 'Fed rate cut odds collapse — trust this signal',
    summary: 'Strong labor data drove high-confidence 11-point drop. Volume came from macro specialists with 78% accuracy. No whale manipulation detected.',
    marketId: '9',
    confidence: 'high',
    timestamp: new Date('2026-02-18T13:45:00'),
    author: 'Clearline Analysis',
    readTime: 3,
  },
  {
    id: 'news-5',
    title: 'Ignore the California governor market noise',
    summary: 'Newsom odds barely moved, but two wallets with poor accuracy drove all volume. No external catalyst. This is pure noise.',
    marketId: '3',
    confidence: 'low',
    timestamp: new Date('2026-02-18T13:00:00'),
    author: 'Clearline Analysis',
    readTime: 2,
  },
  {
    id: 'news-6',
    title: 'Pennsylvania Senate: High-accuracy traders piling in',
    summary: 'Market shift toward Republicans validated by 8 wallets averaging 73% accuracy, all specializing in Senate races. Watch this closely.',
    marketId: '5',
    confidence: 'high',
    timestamp: new Date('2026-02-18T10:30:00'),
    author: 'Clearline Analysis',
    readTime: 4,
  },
  {
    id: 'news-7',
    title: 'S&P 6000 market showing weak conviction',
    summary: 'Low-confidence move despite 3-point gain. Thin volume and no correlation with economic data releases. Likely speculative noise.',
    marketId: '10',
    confidence: 'low',
    timestamp: new Date('2026-02-18T12:15:00'),
    author: 'Clearline Analysis',
    readTime: 2,
  },
];