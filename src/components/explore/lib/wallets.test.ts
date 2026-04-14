import { describe, it, expect } from 'vitest';
import {
  deriveSide,
  toWalletRow,
  sortWalletRows,
  formatAccuracy,
  formatMarketsTraded,
  shortenAddress,
  partitionBySide,
  walletBubbleRadius,
  walletBubbleColor,
  layoutWalletOrbits,
  ORBIT,
  COLOR_DIM,
  COLOR_NEUTRAL,
  COLOR_STRONG,
  type MarketWallet,
} from './wallets';

describe('deriveSide', () => {
  it('returns BUY when buy_volume exceeds sell_volume', () => {
    expect(deriveSide({ buy_volume: 1000, sell_volume: 100 })).toBe('BUY');
  });

  it('returns SELL when sell_volume exceeds buy_volume', () => {
    expect(deriveSide({ buy_volume: 100, sell_volume: 1000 })).toBe('SELL');
  });

  it('tie-breaks to BUY when volumes are equal', () => {
    expect(deriveSide({ buy_volume: 500, sell_volume: 500 })).toBe('BUY');
  });

  it('returns BUY defensively when both volumes are zero', () => {
    expect(deriveSide({ buy_volume: 0, sell_volume: 0 })).toBe('BUY');
  });
});

describe('shortenAddress', () => {
  it('shortens a 42-char hex address to 0xFIRST…LAST', () => {
    expect(shortenAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe(
      '0x1234…5678',
    );
  });

  it('returns the input unchanged when shorter than 11 chars', () => {
    expect(shortenAddress('0xabc')).toBe('0xabc');
  });

  it('handles empty strings', () => {
    expect(shortenAddress('')).toBe('');
  });
});

describe('toWalletRow', () => {
  const apiRow = {
    wallet_address: '0x1234567890abcdef1234567890abcdef12345678',
    buy_volume: 2500,
    sell_volume: 400,
    accuracy_score: 0.82,
    total_markets_traded: 14,
    username: 'alice',
  };

  it('maps API shape to MarketWallet with shortened address', () => {
    const row = toWalletRow(apiRow);
    expect(row.address).toBe(apiRow.wallet_address);
    expect(row.addressShort).toBe('0x1234…5678');
  });

  it('picks the larger of buy/sell as volume', () => {
    expect(toWalletRow(apiRow).volume).toBe(2500);
    expect(
      toWalletRow({ ...apiRow, buy_volume: 100, sell_volume: 900 }).volume,
    ).toBe(900);
  });

  it('passes through accuracy_score and total_markets_traded', () => {
    const row = toWalletRow(apiRow);
    expect(row.accuracyScore).toBe(0.82);
    expect(row.totalMarketsTraded).toBe(14);
  });

  it('derives BUY/SELL correctly', () => {
    expect(toWalletRow(apiRow).side).toBe('BUY');
    expect(
      toWalletRow({ ...apiRow, buy_volume: 100, sell_volume: 900 }).side,
    ).toBe('SELL');
  });

  it('handles null accuracy and total_markets_traded', () => {
    const row = toWalletRow({
      ...apiRow,
      accuracy_score: null,
      total_markets_traded: null,
    });
    expect(row.accuracyScore).toBeNull();
    expect(row.totalMarketsTraded).toBeNull();
  });

  it('handles missing username as null', () => {
    const row = toWalletRow({ ...apiRow, username: null });
    expect(row.username).toBeNull();
  });
});

describe('sortWalletRows', () => {
  const make = (address: string, volume: number) => ({
    address,
    addressShort: address,
    side: 'BUY' as const,
    volume,
    accuracyScore: null,
    totalMarketsTraded: null,
    username: null,
  });

  it('sorts descending by volume', () => {
    const sorted = sortWalletRows([
      make('0xa', 100),
      make('0xb', 500),
      make('0xc', 200),
    ]);
    expect(sorted.map((r) => r.volume)).toEqual([500, 200, 100]);
  });

  it('breaks ties by address ascending (stable ordering)', () => {
    const sorted = sortWalletRows([
      make('0xc', 100),
      make('0xa', 100),
      make('0xb', 100),
    ]);
    expect(sorted.map((r) => r.address)).toEqual(['0xa', '0xb', '0xc']);
  });

  it('returns an empty array for empty input', () => {
    expect(sortWalletRows([])).toEqual([]);
  });
});

describe('formatAccuracy', () => {
  it('returns em-dash for null', () => {
    expect(formatAccuracy(null)).toBe('—');
  });

  it('formats a fraction as a rounded percentage', () => {
    expect(formatAccuracy(0.8234)).toBe('82%');
    expect(formatAccuracy(0.5)).toBe('50%');
    expect(formatAccuracy(0)).toBe('0%');
    expect(formatAccuracy(1)).toBe('100%');
  });
});

describe('formatMarketsTraded', () => {
  it('returns em-dash for null', () => {
    expect(formatMarketsTraded(null)).toBe('—');
  });

  it('uses singular for 1', () => {
    expect(formatMarketsTraded(1)).toBe('1 market');
  });

  it('uses plural for everything else', () => {
    expect(formatMarketsTraded(0)).toBe('0 markets');
    expect(formatMarketsTraded(14)).toBe('14 markets');
    expect(formatMarketsTraded(100)).toBe('100 markets');
  });
});

const mkWallet = (overrides: Partial<MarketWallet> = {}): MarketWallet => ({
  address: overrides.address ?? '0x' + '0'.repeat(40),
  addressShort: '0x0000…0000',
  side: 'BUY',
  volume: 1000,
  accuracyScore: null,
  totalMarketsTraded: null,
  username: null,
  ...overrides,
});

describe('partitionBySide', () => {
  it('splits wallets into buys and sells', () => {
    const buys = [mkWallet({ address: '0xA', side: 'BUY' }), mkWallet({ address: '0xB', side: 'BUY' })];
    const sells = [mkWallet({ address: '0xC', side: 'SELL' })];
    const result = partitionBySide([...buys, ...sells]);
    expect(result.buys.map((w) => w.address)).toEqual(['0xA', '0xB']);
    expect(result.sells.map((w) => w.address)).toEqual(['0xC']);
  });

  it('returns empty arrays for empty input', () => {
    expect(partitionBySide([])).toEqual({ buys: [], sells: [] });
  });

  it('preserves input order within each side', () => {
    const input = [
      mkWallet({ address: '0x1', side: 'SELL' }),
      mkWallet({ address: '0x2', side: 'BUY' }),
      mkWallet({ address: '0x3', side: 'SELL' }),
      mkWallet({ address: '0x4', side: 'BUY' }),
    ];
    const { buys, sells } = partitionBySide(input);
    expect(buys.map((w) => w.address)).toEqual(['0x2', '0x4']);
    expect(sells.map((w) => w.address)).toEqual(['0x1', '0x3']);
  });
});

describe('walletBubbleRadius', () => {
  it('returns max radius at full volume', () => {
    expect(walletBubbleRadius({ volume: 10000, volumeMax: 10000 })).toBe(ORBIT.maxBubbleR);
  });

  it('returns min radius (floor, never zero) at zero volume', () => {
    expect(walletBubbleRadius({ volume: 0, volumeMax: 10000 })).toBe(ORBIT.minBubbleR);
  });

  it('uses sqrt scaling — 4x volume = 2x normalized radius delta', () => {
    const r1 = walletBubbleRadius({ volume: 2500, volumeMax: 10000 });
    const r4 = walletBubbleRadius({ volume: 10000, volumeMax: 10000 });
    const span = ORBIT.maxBubbleR - ORBIT.minBubbleR;
    const frac1 = (r1 - ORBIT.minBubbleR) / span;
    const frac4 = (r4 - ORBIT.minBubbleR) / span;
    expect(frac4 / frac1).toBeCloseTo(2, 5);
  });

  it('floors to min when volumeMax is 0', () => {
    expect(walletBubbleRadius({ volume: 0, volumeMax: 0 })).toBe(ORBIT.minBubbleR);
  });
});

describe('walletBubbleColor', () => {
  it('returns DIM for null', () => {
    expect(walletBubbleColor(null)).toBe(COLOR_DIM);
  });

  it('returns STRONG at 1.0', () => {
    expect(walletBubbleColor(1)).toBe(COLOR_STRONG);
  });

  it('returns DIM at 0', () => {
    expect(walletBubbleColor(0)).toBe(COLOR_DIM);
  });

  it('returns NEUTRAL at 0.5', () => {
    expect(walletBubbleColor(0.5)).toBe(COLOR_NEUTRAL);
  });

  it('clamps values > 1 to STRONG', () => {
    expect(walletBubbleColor(1.5)).toBe(COLOR_STRONG);
  });

  it('clamps values < 0 to DIM', () => {
    expect(walletBubbleColor(-0.2)).toBe(COLOR_DIM);
  });

  it('returns a hex string for mid-range values', () => {
    const c = walletBubbleColor(0.75);
    expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});

describe('layoutWalletOrbits', () => {
  const parent = { x: 100, y: 200 };
  const parentRadius = 20;

  it('returns an empty array when no wallets', () => {
    expect(
      layoutWalletOrbits({ parent, parentRadius, wallets: [] }),
    ).toEqual([]);
  });

  it('emits one bubble per wallet', () => {
    const wallets = [
      mkWallet({ address: '0xA', side: 'BUY', volume: 1000 }),
      mkWallet({ address: '0xB', side: 'SELL', volume: 800 }),
      mkWallet({ address: '0xC', side: 'BUY', volume: 600 }),
    ];
    const bubbles = layoutWalletOrbits({ parent, parentRadius, wallets });
    expect(bubbles).toHaveLength(3);
    expect(bubbles.map((b) => b.address).sort()).toEqual(['0xA', '0xB', '0xC']);
  });

  it('places BUYs in the top half (y < parent.y) and SELLs in the bottom half (y > parent.y)', () => {
    const wallets = [
      mkWallet({ address: '0xA', side: 'BUY', volume: 1000 }),
      mkWallet({ address: '0xB', side: 'BUY', volume: 800 }),
      mkWallet({ address: '0xC', side: 'SELL', volume: 600 }),
      mkWallet({ address: '0xD', side: 'SELL', volume: 400 }),
    ];
    const bubbles = layoutWalletOrbits({ parent, parentRadius, wallets });
    for (const b of bubbles) {
      if (b.side === 'BUY') expect(b.y).toBeLessThan(parent.y);
      if (b.side === 'SELL') expect(b.y).toBeGreaterThan(parent.y);
    }
  });

  it('places a single BUY at top center (x = parent.x)', () => {
    const wallets = [mkWallet({ address: '0xA', side: 'BUY', volume: 1000 })];
    const [bubble] = layoutWalletOrbits({ parent, parentRadius, wallets });
    expect(bubble.x).toBeCloseTo(parent.x, 5);
    expect(bubble.y).toBeLessThan(parent.y);
  });

  it('places a single SELL at bottom center (x = parent.x)', () => {
    const wallets = [mkWallet({ address: '0xA', side: 'SELL', volume: 1000 })];
    const [bubble] = layoutWalletOrbits({ parent, parentRadius, wallets });
    expect(bubble.x).toBeCloseTo(parent.x, 5);
    expect(bubble.y).toBeGreaterThan(parent.y);
  });

  it('keeps every bubble outside parentRadius + childRadius (no overlap with parent)', () => {
    const wallets = [
      mkWallet({ address: '0xA', side: 'BUY', volume: 10000 }),
      mkWallet({ address: '0xB', side: 'SELL', volume: 10000 }),
    ];
    const bubbles = layoutWalletOrbits({ parent, parentRadius, wallets });
    for (const b of bubbles) {
      const dist = Math.hypot(b.x - parent.x, b.y - parent.y);
      expect(dist).toBeGreaterThanOrEqual(parentRadius + b.radius);
    }
  });

  it('is deterministic — same input yields same output', () => {
    const wallets = [
      mkWallet({ address: '0xA', side: 'BUY', volume: 1000 }),
      mkWallet({ address: '0xB', side: 'SELL', volume: 900 }),
      mkWallet({ address: '0xC', side: 'BUY', volume: 500 }),
    ];
    const a = layoutWalletOrbits({ parent, parentRadius, wallets });
    const b = layoutWalletOrbits({ parent, parentRadius, wallets });
    expect(a).toEqual(b);
  });

  it('assigns a color from walletBubbleColor', () => {
    const wallets = [
      mkWallet({ address: '0xA', side: 'BUY', volume: 1000, accuracyScore: 1 }),
      mkWallet({ address: '0xB', side: 'SELL', volume: 900, accuracyScore: null }),
    ];
    const bubbles = layoutWalletOrbits({ parent, parentRadius, wallets });
    const byAddr = Object.fromEntries(bubbles.map((b) => [b.address, b]));
    expect(byAddr['0xA'].color).toBe(COLOR_STRONG);
    expect(byAddr['0xB'].color).toBe(COLOR_DIM);
  });
});
