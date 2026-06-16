-- ABOUTME: pg_cron schedule that invokes the sync-espn Edge Function on a reliable cadence.
-- ABOUTME: Run once in the Supabase SQL editor after deploying the function. Times are UTC.

-- One-time: enable the scheduler + HTTP client extensions (no-ops if already on).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Poll every 5 minutes during the tournament's live windows (UTC), June & July
-- only. Mirrors the GitHub workflow's windows; pg_cron fires far more reliably
-- than GitHub's throttled scheduler, which is the whole point of moving here.
--   minute: */5   hours: 0-5 and 15-23   months: June(6), July(7)
select cron.schedule(
  'sync-espn-live',
  '*/5 0-5,15-23 * 6,7 *',
  $$
  select net.http_post(
    url     := 'https://stkjqyeflpscguqxkges.supabase.co/functions/v1/sync-espn',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- anon key (already public, served in the site's config.js) — only needed
      -- to satisfy the function's default JWT verification.
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN0a2pxeWVmbHBzY2d1cXhrZ2VzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMDA1ODAsImV4cCI6MjA5NDc3NjU4MH0.tgNyjRV4ES53r5yZZ3IJTuUbsB4WuEgwQYlJt-4uFTo'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Inspect:   select * from cron.job;
-- Run log:   select * from cron.job_run_details order by start_time desc limit 20;
-- Remove:    select cron.unschedule('sync-espn-live');
