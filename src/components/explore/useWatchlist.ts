'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface WatchlistApiResponse {
  marketIds: string[];
}

interface UseWatchlistResult {
  watchlistedSet: Set<string>;
  loading: boolean;
  /** Toggle a market in the watchlist. Optimistic; reverts on error. */
  toggle: (marketId: string) => Promise<void>;
  refetch: () => Promise<void>;
}

/**
 * Fetches the signed-in user's starred markets and exposes an optimistic toggle.
 *
 * Returns an empty set for signed-out / 401 / 403 responses so the map component
 * can render without errors when no subscription is present.
 */
export function useWatchlist(): UseWatchlistResult {
  const [watchlistedSet, setWatchlistedSet] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const refetch = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/user/markets/watchlist', {
        signal: controller.signal,
        cache: 'no-store',
      });

      if (!res.ok) {
        setWatchlistedSet(new Set());
        return;
      }

      const data: WatchlistApiResponse = await res.json();
      setWatchlistedSet(new Set(data.marketIds ?? []));
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setWatchlistedSet(new Set());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
    return () => {
      abortRef.current?.abort();
    };
  }, [refetch]);

  const toggle = useCallback(async (marketId: string) => {
    const isCurrentlyWatched = watchlistedSet.has(marketId);

    // Optimistic update
    setWatchlistedSet((prev) => {
      const next = new Set(prev);
      if (isCurrentlyWatched) next.delete(marketId);
      else next.add(marketId);
      return next;
    });

    try {
      const res = isCurrentlyWatched
        ? await fetch(`/api/user/markets/watchlist/${encodeURIComponent(marketId)}`, {
            method: 'DELETE',
          })
        : await fetch('/api/user/markets/watchlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ marketId }),
          });

      if (!res.ok) throw new Error(`Request failed (${res.status})`);
    } catch {
      // Revert
      setWatchlistedSet((prev) => {
        const next = new Set(prev);
        if (isCurrentlyWatched) next.add(marketId);
        else next.delete(marketId);
        return next;
      });
    }
  }, [watchlistedSet]);

  return { watchlistedSet, loading, toggle, refetch };
}
