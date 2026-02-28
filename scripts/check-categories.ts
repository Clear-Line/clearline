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
  // Category distribution
  const { data } = await db.from('markets').select('category').eq('is_active', true);
  const cats: Record<string, number> = {};
  for (const m of data || []) {
    cats[m.category || 'NULL'] = (cats[m.category || 'NULL'] || 0) + 1;
  }
  console.log('Category distribution (active markets):', cats);

  // Check if volume_24hr column exists and has data
  const { data: sample } = await db.from('markets')
    .select('condition_id, category, volume_24hr')
    .eq('is_active', true)
    .in('category', ['politics', 'economics'])
    .limit(5);
  console.log('\nSample politics/economics markets:', sample);

  // Check what categories the 59 existing wallet_signals belong to
  const { data: signals } = await db.from('wallet_signals')
    .select('market_id')
    .limit(10);
  if (signals && signals.length > 0) {
    const marketIds = signals.map(s => s.market_id);
    const { data: mktData } = await db.from('markets')
      .select('condition_id, category, is_active')
      .in('condition_id', marketIds);
    console.log('\nMarkets from existing wallet_signals:', mktData);
  }
}

main().catch(console.error);
