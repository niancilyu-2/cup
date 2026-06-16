# sync-espn Edge Function

Polls the ESPN scoreboard and writes match scores + bracket cascade to Supabase,
driven by **pg_cron** instead of GitHub Actions.

## Why this exists

GitHub's scheduled workflows are best-effort and heavily throttled: the
`sync-results.yml` cron requests a run every 5 minutes during live windows but
GitHub actually fires it roughly once an hour, so live scores lag 60–90 minutes.
`pg_cron` honors its schedule reliably, removing the lag. The GitHub workflow can
stay on as an off-window fallback.

This function is a Deno port of `scripts/sync-espn.js`. The score-mapping,
standings, cascade, and wildcard logic are **imported from `src/`** so there is a
single source of truth shared with the Node script and the vitest suite.

## Cost

Free tier. ~5 min cadence across the two tournament windows is ≈180 invocations/day
(~7k total), well under the Free plan's 500k Edge Function invocations/month.
Note: a Free project pauses after 7 days of inactivity — the cron keeps it awake
during the tournament, but in the gap between the June and July windows add a
keepalive or just unpause before July.

## Deploy

```bash
# from repo root, with the Supabase CLI logged in (supabase login)
supabase functions deploy sync-espn --project-ref stkjqyeflpscguqxkges
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are auto-injected into Edge Functions, so
no secrets to set. Writes use the anon key against the same open RLS policy the
GitHub script already uses.

Smoke test:

```bash
curl -s -X POST https://stkjqyeflpscguqxkges.supabase.co/functions/v1/sync-espn \
  -H "Authorization: Bearer <anon-key>" | jq
# => {"ok":true,"events":104,"final":0,"live":0,...}
```

## Schedule

Run [`cron.sql`](./cron.sql) once in the Supabase SQL editor (Dashboard →
SQL editor). It enables `pg_cron`/`pg_net` and registers the `sync-espn-live`
job (every 5 min, UTC hours 0–5 and 15–23, June & July). Manage it with:

```sql
select * from cron.job;                                    -- list
select * from cron.job_run_details order by start_time desc limit 20;  -- history
select cron.unschedule('sync-espn-live');                  -- remove
```

## Note on shared imports

`index.ts` imports business logic from `../../../src/*.js`. The Supabase CLI's
Deno bundler follows the full local import graph, so these are embedded at deploy
time. If a CLI version ever rejects out-of-directory imports, copy the four
modules (`espn-map.js`, `standings.js`, `cascade.js`, `wildcards.js` and its
`wildcards-table.js`) into a local `_shared/` folder and update the import paths.
