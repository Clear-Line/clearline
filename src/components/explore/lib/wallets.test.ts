import { describe, it, expect } from 'vitest';
import {
  deriveSide,
  toWalletRow,
  sortWalletRows,
  formatAccuracy,
  formatMarketsTraded,
  shortenAddress,
  walletBubbleRadius,
  walletBubbleColor,
  formatVolume2dp,
  ORBIT,
  YES_DIM,
  YES_BRIGHT,
  NO_DIM,
  NO_BRIGHT,
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
    outcome: 'YES' as const,
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

  it('passes through YES outcome', () => {
    expect(toWalletRow({ ...apiRow, outcome: 'YES' }).outcome).toBe('YES');
  });

  it('passes through NO outcome', () => {
    expect(toWalletRow({ ...apiRow, outcome: 'NO' }).outcome).toBe('NO');
  });

  it('normalizes null outcome to null', () => {
    expect(toWalletRow({ ...apiRow, outcome: null }).outcome).toBeNull();
  });

  it('normalizes unknown outcome strings to null', () => {
    // Guard against stray DB values (empty string, lowercase, etc.) leaking into the UI.
    expect(
      toWalletRow({
        ...apiRow,
        outcome: 'yes' as unknown as 'YES',
      }).outcome,
    ).toBeNull();
  });
});

describe('sortWalletRows', () => {
  const make = (address: string, volume: number) => ({
    address,
    addressShort: address,
    side: 'BUY' as const,
    outcome: null,
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
  it('returns YES_BRIGHT at accuracy 1 when outcome is YES', () => {
    expect(
      walletBubbleColor({ side: 'BUY', outcome: 'YES', accuracyScore: 1 }),
    ).toBe(YES_BRIGHT);
  });

  it('returns NO_BRIGHT at accuracy 1 when outcome is NO', () => {
    expect(
      walletBubbleColor({ side: 'SELL', outcome: 'NO', accuracyScore: 1 }),
    ).toBe(NO_BRIGHT);
  });

  it('outcome overrides side — BUY with NO outcome paints red', () => {
    // A BUY trade into NO shares is structurally a NO position. The wallet is
    // betting against, regardless of which side the API surface calls BUY.
    expect(
      walletBubbleColor({ side: 'BUY', outcome: 'NO', accuracyScore: 1 }),
    ).toBe(NO_BRIGHT);
  });

  it('outcome overrides side — SELL with YES outcome paints green', () => {
    expect(
      walletBubbleColor({ side: 'SELL', outcome: 'YES', accuracyScore: 1 }),
    ).toBe(YES_BRIGHT);
  });

  it('falls back to side when outcome is null — BUY → green ramp', () => {
    expect(
      walletBubbleColor({ side: 'BUY', outcome: null, accuracyScore: 1 }),
    ).toBe(YES_BRIGHT);
  });

  it('falls back to side when outcome is null — SELL → red ramp', () => {
    expect(
      walletBubbleColor({ side: 'SELL', outcome: null, accuracyScore: 1 }),
    ).toBe(NO_BRIGHT);
  });

  it('returns YES_DIM when accuracy is null on a YES bubble', () => {
    expect(
      walletBubbleColor({ side: 'BUY', outcome: 'YES', accuracyScore: null }),
    ).toBe(YES_DIM);
  });

  it('returns YES_DIM when accuracy is 0 on a YES bubble', () => {
    expect(
      walletBubbleColor({ side: 'BUY', outcome: 'YES', accuracyScore: 0 }),
    ).toBe(YES_DIM);
  });

  it('returns NO_DIM when accuracy is null on a NO bubble', () => {
    expect(
      walletBubbleColor({ side: 'SELL', outcome: 'NO', accuracyScore: null }),
    ).toBe(NO_DIM);
  });

  it('is monotonic — higher accuracy means component-wise brighter hex on the YES ramp', () => {
    const parse = (hex: string): [number, number, number] => {
      const h = hex.replace('#', '');
      return [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
      ];
    };
    const low = parse(walletBubbleColor({ side: 'BUY', outcome: 'YES', accuracyScore: 0.2 }));
    const high = parse(walletBubbleColor({ side: 'BUY', outcome: 'YES', accuracyScore: 0.8 }));
    expect(high[0]).toBeGreaterThanOrEqual(low[0]);
    expect(high[1]).toBeGreaterThanOrEqual(low[1]);
    expect(high[2]).toBeGreaterThanOrEqual(low[2]);
  });

  it('clamps accuracy > 1 to bright', () => {
    expect(
      walletBubbleColor({ side: 'BUY', outcome: 'YES', accuracyScore: 1.5 }),
    ).toBe(YES_BRIGHT);
  });

  it('clamps accuracy < 0 to dim', () => {
    expect(
      walletBubbleColor({ side: 'BUY', outcome: 'YES', accuracyScore: -0.4 }),
    ).toBe(YES_DIM);
  });

  it('returns a 6-digit hex for mid-range values', () => {
    const c = walletBubbleColor({
      side: 'BUY',
      outcome: 'YES',
      accuracyScore: 0.5,
    });
    expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});

describe('formatVolume2dp', () => {
  it('formats millions with 2 decimals', () => {
    expect(formatVolume2dp(1_234_567)).toBe('$1.23M');
  });

  it('formats thousands with 2 decimals', () => {
    expect(formatVolume2dp(12_345)).toBe('$12.35K');
  });

  it('formats sub-thousand values with 2 decimals', () => {
    expect(formatVolume2dp(42)).toBe('$42.00');
    expect(formatVolume2dp(0)).toBe('$0.00');
  });

  it('uses K boundary at 1000', () => {
    expect(formatVolume2dp(999)).toBe('$999.00');
    expect(formatVolume2dp(1000)).toBe('$1.00K');
  });

  it('uses M boundary at 1_000_000', () => {
    expect(formatVolume2dp(999_999)).toBe('$1000.00K');
    expect(formatVolume2dp(1_000_000)).toBe('$1.00M');
  });
});
