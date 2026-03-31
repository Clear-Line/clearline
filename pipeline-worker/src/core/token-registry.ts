/**
 * Token Registry — maps on-chain ERC1155 token IDs to Polymarket market metadata.
 *
 * Polymarket's CLOB assigns each market outcome a unique token ID (large uint256).
 * This registry loads all active markets from BigQuery, parses their `clob_token_ids`,
 * and provides O(1) lookups so the chain listener can map events → markets.
 *
 * Includes category info so the listener can filter at the event level.
 */

import { bq } from './bigquery.js';

// ─── Types ───

export interface TokenMapping {
  conditionId: string;
  outcomeIndex: number;
  outcomeName: string;
  category: string;
}

// ─── Registry State ───

const registry = new Map<string, TokenMapping>();

// ─── Public API ───

/**
 * Load/refresh the token registry from the BigQuery `markets` table.
 * Should be called on startup and after each market-discovery run.
 */
export async function loadTokenRegistry(): Promise<number> {
  const { data, error } = await bq
    .from('markets')
    .select('condition_id, clob_token_ids, outcomes, category')
    .eq('is_active', true);

  if (error || !data) {
    console.error('[TokenRegistry] Failed to load:', error?.message);
    return registry.size;
  }

  let added = 0;

  for (const row of data) {
    const conditionId = row.condition_id;
    const category = row.category || 'other';

    // Parse JSON string fields
    let tokenIds: string[];
    let outcomes: string[];
    try {
      tokenIds = typeof row.clob_token_ids === 'string'
        ? JSON.parse(row.clob_token_ids)
        : row.clob_token_ids ?? [];
      outcomes = typeof row.outcomes === 'string'
        ? JSON.parse(row.outcomes)
        : row.outcomes ?? [];
    } catch {
      continue; // malformed JSON, skip
    }

    if (!Array.isArray(tokenIds) || tokenIds.length === 0) continue;

    // Map each token ID to its outcome
    for (let i = 0; i < tokenIds.length; i++) {
      const tokenId = tokenIds[i];
      if (!tokenId) continue;

      registry.set(tokenId, {
        conditionId,
        outcomeIndex: i,
        outcomeName: outcomes[i] || (i === 0 ? 'Yes' : 'No'),
        category,
      });
      added++;
    }
  }

  console.log(`[TokenRegistry] Loaded ${registry.size} token mappings from ${data.length} markets`);
  return registry.size;
}

/**
 * Look up a token ID → market mapping. Returns undefined for unknown tokens.
 * Token IDs from on-chain events are bigint; convert to string for lookup.
 */
export function lookupToken(tokenId: string): TokenMapping | undefined {
  return registry.get(tokenId);
}

/** Current registry size (for telemetry). */
export function getRegistrySize(): number {
  return registry.size;
}
