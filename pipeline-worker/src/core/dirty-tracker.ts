/**
 * Dirty Tracker — tracks which markets have new data and need recomputation.
 *
 * Ingestion layer marks markets dirty when new data arrives.
 * Enrichment layer flushes dirty markets and recomputes only those.
 * Intelligence layer re-scores markets that were just enriched.
 */

export class DirtyTracker {
  private dirty = new Map<string, number>(); // market_id -> timestamp marked dirty

  mark(marketId: string): void {
    this.dirty.set(marketId, Date.now());
  }

  markMany(ids: string[]): void {
    const now = Date.now();
    for (const id of ids) this.dirty.set(id, now);
  }

  /** Get all dirty market IDs and clear the set. */
  flush(): string[] {
    const ids = [...this.dirty.keys()];
    this.dirty.clear();
    return ids;
  }

  /** Get count of currently dirty markets. */
  get size(): number {
    return this.dirty.size;
  }

  /** Check if a specific market is dirty. */
  has(marketId: string): boolean {
    return this.dirty.has(marketId);
  }

  /** Get dirty markets older than maxAgeMs (for stale detection). */
  stale(maxAgeMs: number): string[] {
    const cutoff = Date.now() - maxAgeMs;
    return [...this.dirty.entries()]
      .filter(([, ts]) => ts < cutoff)
      .map(([id]) => id);
  }
}

// Singleton instance shared across the worker process
export const dirtyTracker = new DirtyTracker();
