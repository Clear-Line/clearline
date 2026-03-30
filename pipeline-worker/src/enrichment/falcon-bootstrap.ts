/**
 * Falcon Bootstrap — seeds the wallets table with externally validated data
 * from the Heisenberg Falcon leaderboard.
 *
 * Runs once on startup, then weekly to refresh scores.
 * Only overwrites a wallet row if Falcon has a larger sample size.
 */

import { bq } from '../core/bigquery.js';
import { getFalconLeaderboard, FalconWallet } from '../core/heisenberg-client.js';

export async function bootstrapFromFalcon(): Promise<{
  seeded: number;
  skipped: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let seeded = 0;
  let skipped = 0;

  // Fetch top wallets from Falcon leaderboard
  const falconWallets = await getFalconLeaderboard(200);

  if (!falconWallets || falconWallets.length === 0) {
    return { seeded: 0, skipped: 0, errors: ['Falcon leaderboard returned no data (API key missing or service down)'] };
  }

  console.log(`[FalconBootstrap] Got ${falconWallets.length} wallets from Falcon`);

  // Fetch existing wallets to check sample sizes
  const addresses = falconWallets.map((fw) => fw.wallet_address);
  const existingMap = new Map<string, number>();

  const ADDR_BATCH = 200;
  for (let i = 0; i < addresses.length; i += ADDR_BATCH) {
    const batch = addresses.slice(i, i + ADDR_BATCH);
    const { data } = await bq
      .from('wallets')
      .select('address, accuracy_sample_size')
      .in('address', batch);

    if (data) {
      for (const row of data) {
        existingMap.set(row.address, row.accuracy_sample_size ?? 0);
      }
    }
  }

  // Build upsert rows — only if Falcon has more data
  const upsertRows = [];

  for (const fw of falconWallets) {
    const existingSample = existingMap.get(fw.wallet_address) ?? 0;
    const falconSample = fw.total_trades ?? 0;

    if (falconSample <= existingSample) {
      skipped++;
      continue;
    }

    const wins = Math.round((fw.win_rate ?? 0) * falconSample);
    const losses = falconSample - wins;

    upsertRows.push({
      address: fw.wallet_address,
      accuracy_score: fw.win_rate ?? 0,
      accuracy_sample_size: falconSample,
      wins,
      losses,
      total_trades: falconSample,
      total_volume_usdc: Math.round((fw.avg_position_size ?? 0) * falconSample),
      total_markets_traded: fw.markets_traded ?? 0,
      total_pnl_usdc: Math.round((fw.pnl_usdc ?? 0) * 100) / 100,
      falcon_score: fw.falcon_score ?? 0,
      data_source: 'falcon',
    });
  }

  if (upsertRows.length === 0) {
    return { seeded: 0, skipped, errors };
  }

  // Batch upsert
  const BATCH = 200;
  for (let i = 0; i < upsertRows.length; i += BATCH) {
    const chunk = upsertRows.slice(i, i + BATCH);
    const { error } = await bq
      .from('wallets')
      .upsert(chunk, { onConflict: 'address' });

    if (error) {
      errors.push(`Falcon upsert batch ${i}: ${error.message}`);
    } else {
      seeded += chunk.length;
    }
  }

  console.log(`[FalconBootstrap] Seeded ${seeded} wallets, skipped ${skipped} (already had better data)`);
  return { seeded, skipped, errors };
}
