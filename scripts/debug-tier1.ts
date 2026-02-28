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
  // 1. How many politics/economics markets exist?
  const { count: polCount } = await db.from('markets')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)
    .in('category', ['politics', 'economics']);
  console.log('Total active politics/economics markets:', polCount);

  // 2. Default .select() limit test
  const { data: defaultQuery } = await db.from('markets')
    .select('condition_id')
    .eq('is_active', true)
    .in('category', ['politics', 'economics']);
  console.log('Rows returned WITHOUT explicit limit:', defaultQuery?.length);

  // 3. Get just 5 politics markets and check trades for each
  const { data: sample } = await db.from('markets')
    .select('condition_id')
    .eq('is_active', true)
    .eq('category', 'politics')
    .limit(5);

  console.log('\nChecking trades for 5 sample politics markets:');
  for (const m of sample || []) {
    const { count } = await db.from('trades')
      .select('*', { count: 'exact', head: true })
      .eq('market_id', m.condition_id);
    console.log(`  ${m.condition_id.slice(0, 30)}... => ${count} trades`);
  }

  // 4. Try .in() with just those 5 IDs
  const ids5 = (sample || []).map(m => m.condition_id);
  const { data: trades5, error: err5 } = await db.from('trades')
    .select('market_id, wallet_address')
    .in('market_id', ids5)
    .limit(10);
  console.log('\n.in() with 5 IDs:', trades5?.length, 'trades, error:', err5?.message);

  // 5. Try .in() with 1000 IDs (like tier1 does)
  const { data: markets1k } = await db.from('markets')
    .select('condition_id')
    .eq('is_active', true)
    .in('category', ['politics', 'economics']);

  const ids1k = (markets1k || []).map(m => m.condition_id);
  console.log('\nGot', ids1k.length, 'market IDs for .in() test');

  const { data: trades1k, error: err1k } = await db.from('trades')
    .select('market_id, wallet_address')
    .in('market_id', ids1k)
    .limit(10);
  console.log('.in() with', ids1k.length, 'IDs:', trades1k?.length, 'trades, error:', err1k?.message);
}

main().catch(console.error);
