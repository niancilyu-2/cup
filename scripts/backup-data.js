// ABOUTME: Dumps every picks/players/matches row to JSON files for backup.
// ABOUTME: Run by .github/workflows/backup-data.yml; reads via PostgREST (anon key).

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;

// Stable ordering per table so pages can't skip or duplicate rows.
const TABLES = {
  players: 'id',
  group_picks: 'player_id,group_code',
  bracket_picks: 'player_id,match_id',
  tiebreaker_picks: 'player_id',
  matches: 'id',
};

const PAGE = 1000; // PostgREST default max-rows; page past it explicitly.

async function fetchAll(table, orderBy) {
  if (!URL || !KEY) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set');
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${URL}/rest/v1/${table}?select=*&order=${orderBy}`, {
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        'Range-Unit': 'items',
        Range: `${from}-${from + PAGE - 1}`,
      },
    });
    if (!res.ok) throw new Error(`${table} fetch failed: ${res.status} ${await res.text()}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

async function main() {
  const outDir = process.argv[2] || 'backup';
  await mkdir(outDir, { recursive: true });
  const manifest = { taken_at: new Date().toISOString(), counts: {} };
  for (const [table, orderBy] of Object.entries(TABLES)) {
    const rows = await fetchAll(table, orderBy);
    await writeFile(join(outDir, `${table}.json`), JSON.stringify(rows, null, 2));
    manifest.counts[table] = rows.length;
    console.log(`${table}: ${rows.length} rows`);
  }
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`Backup written to ${outDir}/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
