'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UserPosition, PortfolioTotals } from './mapTypes';

interface PositionsApiResponse {
  wallets: string[];
  positions: UserPosition[];
  totals: PortfolioTotals;
}

const REVALIDATE_MS = 60_000;

interface UseOwnedPositionsResult {
  wallets: string[];
  positions: UserPosition[];
  heldMap: Map<string, UserPosition>;
  heldSet: Set<string>;
  totals: PortfolioTotals;
  loading: boolean;
  refetch: () => Promise<void>;
}

/**
 * Fetches the signed-in user's aggregated held positions from `/api/user/positions`.
 *
 * Returns an empty map for signed-out / 401 / 403 responses so the map component
 * can render the same way with or without a linked wallet — the overlay just
 * doesn't appear.
 */
export function useOwnedPositions(): UseOwnedPositionsResult {
  const [wallets, setWallets] = useState<string[]>([]);
  const [positions, setPositions] = useState<UserPosition[]>([]);
  const [totals, setTotals] = useState<PortfolioTotals>({ exposure: 0, unrealizedPnl: 0, held: 0 });
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const refetch = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/user/positions', {
        signal: controller.signal,
        cache: 'no-store',
      });

      if (!res.ok) {
        // 401 / 403 / 500 — treat as "nothing to show"
        setWallets([]);
        setPositions([]);
        setTotals({ exposure: 0, unrealizedPnl: 0, held: 0 });
        return;
      }

      const data: PositionsApiResponse = await res.json();
      setWallets(data.wallets ?? []);
      setPositions(data.positions ?? []);
      setTotals(data.totals ?? { exposure: 0, unrealizedPnl: 0, held: 0 });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setWallets([]);
      setPositions([]);
      setTotals({ exposure: 0, unrealizedPnl: 0, held: 0 });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
    const interval = setInterval(refetch, REVALIDATE_MS);
    return () => {
      clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [refetch]);

  const heldMap = useMemo(() => {
    const map = new Map<string, UserPosition>();
    for (const p of positions) map.set(p.marketId, p);
    return map;
  }, [positions]);

  const heldSet = useMemo(() => new Set(heldMap.keys()), [heldMap]);

  return { wallets, positions, heldMap, heldSet, totals, loading, refetch };
}
