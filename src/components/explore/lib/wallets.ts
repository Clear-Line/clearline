export interface MarketWalletApiRow {
  wallet_address: string;
  buy_volume: number;
  sell_volume: number;
  accuracy_score: number | null;
  total_markets_traded: number | null;
  username: string | null;
}

export interface MarketWallet {
  address: string;
  addressShort: string;
  side: 'BUY' | 'SELL';
  volume: number;
  accuracyScore: number | null;
  totalMarketsTraded: number | null;
  username: string | null;
}

export function deriveSide(input: { buy_volume: number; sell_volume: number }): 'BUY' | 'SELL' {
  return input.sell_volume > input.buy_volume ? 'SELL' : 'BUY';
}

export function shortenAddress(address: string): string {
  if (address.length < 11) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function toWalletRow(row: MarketWalletApiRow): MarketWallet {
  return {
    address: row.wallet_address,
    addressShort: shortenAddress(row.wallet_address),
    side: deriveSide(row),
    volume: Math.max(row.buy_volume, row.sell_volume),
    accuracyScore: row.accuracy_score,
    totalMarketsTraded: row.total_markets_traded,
    username: row.username,
  };
}

export function sortWalletRows(rows: MarketWallet[]): MarketWallet[] {
  return [...rows].sort((a, b) => {
    if (b.volume !== a.volume) return b.volume - a.volume;
    return a.address.localeCompare(b.address);
  });
}

export function formatAccuracy(score: number | null): string {
  if (score === null) return '—';
  return `${Math.round(score * 100)}%`;
}

export function formatMarketsTraded(count: number | null): string {
  if (count === null) return '—';
  return count === 1 ? '1 market' : `${count} markets`;
}

export const ORBIT = {
  minBubbleR: 4,
  maxBubbleR: 18,
  orbitGap: 10,
} as const;

export const COLOR_DIM = '#3B3F4A';
export const COLOR_NEUTRAL = '#94A3B8';
export const COLOR_STRONG = '#10B981';

export function partitionBySide(
  wallets: MarketWallet[],
): { buys: MarketWallet[]; sells: MarketWallet[] } {
  const buys: MarketWallet[] = [];
  const sells: MarketWallet[] = [];
  for (const w of wallets) {
    if (w.side === 'BUY') buys.push(w);
    else sells.push(w);
  }
  return { buys, sells };
}

export function walletBubbleRadius(input: { volume: number; volumeMax: number }): number {
  const { volume, volumeMax } = input;
  if (volumeMax <= 0 || volume <= 0) return ORBIT.minBubbleR;
  const frac = Math.sqrt(Math.max(0, Math.min(1, volume / volumeMax)));
  return ORBIT.minBubbleR + frac * (ORBIT.maxBubbleR - ORBIT.minBubbleR);
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function toHex(n: number): string {
  return Math.round(n).toString(16).padStart(2, '0');
}

function lerpHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  const r = ar + (br - ar) * t;
  const g = ag + (bg - ag) * t;
  const bl = ab + (bb - ab) * t;
  return `#${toHex(r)}${toHex(g)}${toHex(bl)}`.toUpperCase();
}

export function walletBubbleColor(score: number | null): string {
  if (score === null) return COLOR_DIM;
  if (score <= 0) return COLOR_DIM;
  if (score >= 1) return COLOR_STRONG;
  if (score === 0.5) return COLOR_NEUTRAL;
  if (score < 0.5) return lerpHex(COLOR_DIM, COLOR_NEUTRAL, score / 0.5);
  return lerpHex(COLOR_NEUTRAL, COLOR_STRONG, (score - 0.5) / 0.5);
}

export interface OrbitBubble {
  address: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  side: 'BUY' | 'SELL';
}

export function layoutWalletOrbits(input: {
  parent: { x: number; y: number };
  parentRadius: number;
  wallets: MarketWallet[];
}): OrbitBubble[] {
  const { parent, parentRadius, wallets } = input;
  if (wallets.length === 0) return [];

  const { buys, sells } = partitionBySide(sortWalletRows(wallets));
  const volumeMax = Math.max(1, ...wallets.map((w) => w.volume));

  const maxChildRadius = ORBIT.maxBubbleR;
  const orbitR = parentRadius + maxChildRadius + ORBIT.orbitGap;

  const place = (
    list: MarketWallet[],
    angleStart: number,
  ): OrbitBubble[] => {
    const n = list.length;
    if (n === 0) return [];
    const span = Math.PI;
    return list.map((w, i) => {
      const theta = angleStart + ((i + 1) * span) / (n + 1);
      return {
        address: w.address,
        x: parent.x + orbitR * Math.cos(theta),
        y: parent.y + orbitR * Math.sin(theta),
        radius: walletBubbleRadius({ volume: w.volume, volumeMax }),
        color: walletBubbleColor(w.accuracyScore),
        side: w.side,
      };
    });
  };

  return [...place(buys, -Math.PI), ...place(sells, 0)];
}
