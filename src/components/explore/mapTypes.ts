export type Category =
  | 'politics'
  | 'crypto'
  | 'economics'
  | 'geopolitics'
  | 'culture';

export interface MapNode {
  id: string;
  label: string;
  fullLabel: string;
  category: Category;
  probability: number;
  volume24h: number;
  totalVolume: number;
  liquidity: number;
  change24h: number;
  smartWalletCount: number;
  insiderCount: number;
  signal: 'BUY' | 'SELL' | 'NEUTRAL';
  endDate: string | null;
  // d3-force mutable
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  // computed
  radius: number;
}

export interface MapEdge {
  source: string;
  target: string;
  weight: number;
  type: 'same-category' | 'shared-wallet' | 'correlated';
}

export interface MapGraph {
  nodes: MapNode[];
  edges: MapEdge[];
}

export interface MapViewState {
  offsetX: number;
  offsetY: number;
  scale: number;
}

export interface HoveredNode {
  node: MapNode;
  screenX: number;
  screenY: number;
}

export interface SidebarWallet {
  address: string;
  side: 'BUY' | 'SELL';
  volume: number;
  accuracy: number;
}

export interface ConnectedMarket {
  id: string;
  label: string;
  category: Category;
  probability: number;
  overlapStrength: number;
}

/** A single user's aggregated position across all their linked wallets for one market. */
export interface UserPosition {
  marketId: string;
  title: string;
  category: string;
  side: 'BUY' | 'SELL';
  invested: number;
  avgPrice: number;
  currentPrice: number;
  currentValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  trades: number;
  wallets: string[];
}

export interface PortfolioTotals {
  exposure: number;
  unrealizedPnl: number;
  held: number;
}
