import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

const envPath = resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
  const t = line.trim();
  if (t.length === 0 || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq === -1) continue;
  const k = t.slice(0, eq).trim();
  let v = t.slice(eq + 1).trim();
  if ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'")) v = v.slice(1, -1);
  if (process.env[k] === undefined) process.env[k] = v;
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  // Sample trade market_ids
  const { data: trades } = await db.from('trades')
    .select('market_id')
    .limit(10);
  console.log('Sample trade market_ids:', trades?.map(t => t.market_id.slice(0, 20)));

  // Check if any of those market_ids exist in markets table with politics/economics
  if (trades && trades.length > 0) {
    const ids = [...new Set(trades.map(t => t.market_id))];
    const { data: mkt } = await db.from('markets')
      .select('condition_id, category')
      .in('condition_id', ids);
    console.log('\nThose markets in markets table:', mkt);
  }

  // Get sample politics markets and check if they have trades
  const { data: polMarkets } = await db.from('markets')
    .select('condition_id')
    .eq('category', 'politics')
    .eq('is_active', true)
    .limit(5);
  console.log('\nSample politics market IDs:', polMarkets?.map(m => m.condition_id.slice(0, 20)));

  if (polMarkets && polMarkets.length > 0) {
    const { count } = await db.from('trades')
      .select('*', { count: 'exact', head: true })
      .in('market_id', polMarkets.map(m => m.condition_id));
    console.log('Trades matching those politics markets:', count);
  }

  // Check distinct market_ids in trades
  const { data: distinctMarkets } = await db.from('trades')
    .select('market_id')
    .limit(1000);
  const unique = new Set(distinctMarkets?.map(t => t.market_id));
  console.log('\nDistinct market_ids in trades (from first 1000 rows):', unique.size);

  // Cross-reference: how many of those are politics/economics?
  const uniqueArr = [...unique];
  const { data: catCheck } = await db.from('markets')
    .select('condition_id, category')
    .in('condition_id', uniqueArr.slice(0, 200));

  const catDist: Record<string, number> = {};
  for (const m of catCheck || []) {
    catDist[m.category || 'NULL'] = (catDist[m.category || 'NULL'] || 0) + 1;
  }
  console.log('Category of markets that have trades:', catDist);
}

main().catch(console.error);
