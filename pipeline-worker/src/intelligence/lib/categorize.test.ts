import { describe, it, expect } from 'vitest';
import {
  categorizeMarket,
  extractCryptoUnderlying,
  buildSameUnderlyingPairs,
} from './categorize.js';

describe('categorizeMarket — sports-first precedence', () => {
  it('tags "Trump at Super Bowl" as sports despite trump keyword', () => {
    expect(categorizeMarket('Will Trump attend the Super Bowl?')).toBe('sports');
  });
  it('tags "Russia World Cup host" as sports despite russia keyword', () => {
    expect(categorizeMarket('Will Russia host the next World Cup?')).toBe('sports');
  });
  it('tags "NBA accept Bitcoin" as sports despite bitcoin keyword', () => {
    expect(categorizeMarket('Will NBA accept Bitcoin?')).toBe('sports');
  });
  it('tags "Fed chair throw NFL opening pitch" as sports despite fed keyword', () => {
    expect(categorizeMarket('Will Fed chair throw NFL opening pitch?')).toBe('sports');
  });
});

describe('categorizeMarket — Polymarket tags[] priority', () => {
  it('honors sports tag over any regex', () => {
    expect(categorizeMarket('Random title', ['sports'])).toBe('sports');
  });
  it('honors crypto tag', () => {
    expect(categorizeMarket('Random title', ['crypto'])).toBe('crypto');
  });
  it('honors politics tag', () => {
    expect(categorizeMarket('Random title', ['politics'])).toBe('politics');
  });
  it('sports tag wins even when title matches politics regex', () => {
    expect(categorizeMarket('Trump speech', ['sports'])).toBe('sports');
  });
});

describe('categorizeMarket — expanded sports regex', () => {
  it('tennis: Djokovic Wimbledon', () => {
    expect(categorizeMarket('Will Djokovic win Wimbledon?')).toBe('sports');
  });
  it('golf: Tiger Masters', () => {
    expect(categorizeMarket('Will Tiger Woods win the Masters?')).toBe('sports');
  });
  it('UFC championship bout', () => {
    expect(categorizeMarket('Who wins the UFC championship bout?')).toBe('sports');
  });
  it('F1 Grand Prix', () => {
    expect(categorizeMarket('Will Verstappen win the Monaco Grand Prix?')).toBe('sports');
  });
  it('Olympics gold', () => {
    expect(categorizeMarket('Will USA win gold at the 2028 Olympics?')).toBe('sports');
  });
  it('Premier League', () => {
    expect(categorizeMarket('Man City to win Premier League?')).toBe('sports');
  });
  it('Champions League', () => {
    expect(categorizeMarket('Real Madrid to win Champions League?')).toBe('sports');
  });
});

describe('categorizeMarket — happy-path regression', () => {
  it('politics election', () => {
    expect(categorizeMarket('Will Trump win the 2028 election?')).toBe('politics');
  });
  it('geopolitics Iran nuclear', () => {
    expect(categorizeMarket('Will Iran reach a nuclear deal?')).toBe('geopolitics');
  });
  it('economics Fed rates', () => {
    expect(categorizeMarket('Will the Fed cut interest rates?')).toBe('economics');
  });
  it('crypto BTC price', () => {
    expect(categorizeMarket('Will BTC reach $200K?')).toBe('crypto');
  });
  it('weather hurricane', () => {
    expect(categorizeMarket('Will there be a hurricane in Florida?')).toBe('weather');
  });
  it('other for unmatched', () => {
    expect(categorizeMarket('Will Taylor Swift announce a new album?')).toBe('other');
  });
});

describe('categorizeMarket — edge cases', () => {
  it('empty string returns other', () => {
    expect(categorizeMarket('')).toBe('other');
  });
  it('whitespace only returns other', () => {
    expect(categorizeMarket('   ')).toBe('other');
  });
  it('case insensitive crypto', () => {
    expect(categorizeMarket('WILL BTC REACH $200K?')).toBe('crypto');
  });
  it('undefined tags does not throw', () => {
    expect(categorizeMarket('BTC up?', undefined)).toBe('crypto');
  });
  it('empty tags array falls through to regex', () => {
    expect(categorizeMarket('BTC up?', [])).toBe('crypto');
  });
});

describe('extractCryptoUnderlying', () => {
  it('extracts btc from bitcoin mentions', () => {
    expect(extractCryptoUnderlying('Will Bitcoin hit $200K?')).toBe('btc');
    expect(extractCryptoUnderlying('Will BTC be above $150K in Dec?')).toBe('btc');
  });
  it('extracts eth from ethereum mentions', () => {
    expect(extractCryptoUnderlying('Will ETH reach $10K?')).toBe('eth');
    expect(extractCryptoUnderlying('Ethereum above $8K by June?')).toBe('eth');
  });
  it('extracts sol', () => {
    expect(extractCryptoUnderlying('Solana to hit $500?')).toBe('sol');
  });
  it('extracts doge', () => {
    expect(extractCryptoUnderlying('Dogecoin price by March?')).toBe('doge');
  });
  it('extracts xrp', () => {
    expect(extractCryptoUnderlying('XRP ruling this quarter?')).toBe('xrp');
  });
  it('extracts ada', () => {
    expect(extractCryptoUnderlying('Cardano ADA above $5?')).toBe('ada');
  });
  it('extracts bnb', () => {
    expect(extractCryptoUnderlying('BNB above $700?')).toBe('bnb');
  });
  it('returns null for non-crypto titles', () => {
    expect(extractCryptoUnderlying('Will Trump win?')).toBeNull();
    expect(extractCryptoUnderlying('Super Bowl LX winner?')).toBeNull();
  });
  it('prefers bitcoin over ethereum in ambiguous titles (deterministic ordering)', () => {
    expect(extractCryptoUnderlying('BTC vs ETH — which rises first?')).toBe('btc');
  });
  it('returns null for empty string', () => {
    expect(extractCryptoUnderlying('')).toBeNull();
  });
});

describe('buildSameUnderlyingPairs', () => {
  it('pairs all same-underlying markets', () => {
    const markets = [
      { id: 'a', question: 'BTC above $150K?' },
      { id: 'b', question: 'BTC above $200K?' },
      { id: 'c', question: 'ETH above $10K?' },
    ];
    const pairs = buildSameUnderlyingPairs(markets);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toEqual({ market_a: 'a', market_b: 'b', underlying: 'btc' });
  });

  it('enforces market_a < market_b lexicographically', () => {
    const markets = [
      { id: 'zzz', question: 'BTC above $X?' },
      { id: 'aaa', question: 'BTC above $Y?' },
    ];
    const pairs = buildSameUnderlyingPairs(markets);
    expect(pairs[0].market_a).toBe('aaa');
    expect(pairs[0].market_b).toBe('zzz');
  });

  it('creates C(n,2) pairs per underlying', () => {
    const markets = [
      { id: 'a', question: 'BTC 1' },
      { id: 'b', question: 'BTC 2' },
      { id: 'c', question: 'BTC 3' },
      { id: 'd', question: 'ETH 1' },
      { id: 'e', question: 'ETH 2' },
    ];
    const pairs = buildSameUnderlyingPairs(markets);
    // C(3,2) = 3 BTC pairs, C(2,2) = 1 ETH pair
    expect(pairs).toHaveLength(4);
    const btcPairs = pairs.filter((p) => p.underlying === 'btc');
    const ethPairs = pairs.filter((p) => p.underlying === 'eth');
    expect(btcPairs).toHaveLength(3);
    expect(ethPairs).toHaveLength(1);
  });

  it('skips markets with no extractable underlying', () => {
    const markets = [
      { id: 'a', question: 'BTC up' },
      { id: 'b', question: 'Random political thing' },
    ];
    expect(buildSameUnderlyingPairs(markets)).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    expect(buildSameUnderlyingPairs([])).toEqual([]);
  });

  it('returns empty array when only one market per underlying', () => {
    const markets = [
      { id: 'a', question: 'BTC up' },
      { id: 'b', question: 'ETH up' },
    ];
    expect(buildSameUnderlyingPairs(markets)).toHaveLength(0);
  });
});
