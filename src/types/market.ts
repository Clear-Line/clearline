export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface Market {
  id: string;
  title: string;
  category: string;
  section: string;
  currentOdds: number;
  previousOdds: number;
  change: number;
  volume24h: number;
  confidence: ConfidenceLevel;
  confidenceScore: number;
  traders: number | null;
  lastUpdated: Date;
  liquidity: number;
  spread: number | null;
  // Smart money signal
  signal: 'BUY' | 'SELL' | 'NEUTRAL';
  signalConfidence: number;
  smartBuyVolume: number;
  smartSellVolume: number;
  smartWalletCount: number;
  topSmartWallets: { address: string; accuracy: number; side: string; volume: number }[];
}
