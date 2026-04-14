export interface MarketWalletApiRow {
  wallet_address: string;
  buy_volume: number;
  sell_volume: number;
  outcome: 'YES' | 'NO' | null;
  accuracy_score: number | null;
  total_markets_traded: number | null;
  username: string | null;
}

export interface MarketWallet {
  address: string;
  addressShort: string;
  side: 'BUY' | 'SELL';
  outcome: 'YES' | 'NO' | null;
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

function normalizeOutcome(raw: unknown): 'YES' | 'NO' | null {
  if (raw === 'YES' || raw === 'NO') return raw;
  return null;
}

export function toWalletRow(row: MarketWalletApiRow): MarketWallet {
  return {
    address: row.wallet_address,
    addressShort: shortenAddress(row.wallet_address),
    side: deriveSide(row),
    outcome: normalizeOutcome(row.outcome),
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

// Side-aware bubble color. YES outcome = green ramp, NO = red ramp.
// When outcome is null we fall back to side (BUY→YES, SELL→NO) so older
// rows without the `outcome` column still render coherently.
export const YES_DIM = '#064E3B';
export const YES_BRIGHT = '#10B981';
export const NO_DIM = '#7F1D1D';
export const NO_BRIGHT = '#EF4444';

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

export function walletBubbleColor(input: {
  side: 'BUY' | 'SELL';
  outcome: 'YES' | 'NO' | null;
  accuracyScore: number | null;
}): string {
  const yes =
    input.outcome === 'YES' ||
    (input.outcome === null && input.side === 'BUY');
  const [dim, bright] = yes ? [YES_DIM, YES_BRIGHT] : [NO_DIM, NO_BRIGHT];
  const raw = input.accuracyScore;
  const t = raw == null ? 0 : Math.max(0, Math.min(1, raw));
  return lerpHex(dim, bright, t);
}

export function formatVolume2dp(v: number): string {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(2)}K`;
  return `$${v.toFixed(2)}`;
}
