-- ABOUTME: Migration 001 — allow partial group picks (NULL first or second).
-- ABOUTME: Apply via Supabase SQL editor; idempotent.

ALTER TABLE group_picks ALTER COLUMN first_code DROP NOT NULL;
ALTER TABLE group_picks ALTER COLUMN second_code DROP NOT NULL;

ALTER TABLE group_picks DROP CONSTRAINT IF EXISTS group_picks_check;
ALTER TABLE group_picks ADD CONSTRAINT group_picks_check
  CHECK (first_code IS NULL OR second_code IS NULL OR first_code <> second_code);
