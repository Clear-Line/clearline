export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface Market {
  id: string;
  title: string;
  category: 'presidential' | 'senate' | 'gubernatorial' | 'policy' | 'crypto' | 'economic' | 'weather' | 'sports' | 'entertainment' | 'geopolitics';
  section: 'political' | 'economics' | 'geopolitics' | 'crypto' | 'other';
  currentOdds: number;
  previousOdds: number;
  change: number;
  volume24h: number;
  confidence: ConfidenceLevel;
  confidenceScore: number;
  traders: number | null;
  lastUpdated: Date;
  liquidity: number;
}
