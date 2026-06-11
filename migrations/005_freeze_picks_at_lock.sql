-- ABOUTME: Enforce the pick lock in the database, not just the app: after first
-- ABOUTME: kickoff, picks become read-only for the anon role — nothing can delete them.

-- The app already refuses to save after LOCK_DATE_ISO (2026-06-11 13:00 -06:00),
-- but the old FOR ALL policies let anyone with the anon key INSERT/UPDATE/DELETE
-- pick rows at any time. These split policies keep reads open forever and gate
-- every write on the same lock instant the app uses, so a buggy client, a
-- skewed clock, or a curious friend with devtools cannot touch picks once the
-- tournament starts. (The results sync only writes the matches table and is
-- unaffected.)

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['group_picks', 'bracket_picks', 'tiebreaker_picks'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_all', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_insert_prelock', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_update_prelock', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_delete_prelock', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (true)',
      t || '_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT WITH CHECK (now() < TIMESTAMPTZ ''2026-06-11 19:00:00+00'')',
      t || '_insert_prelock', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE USING (now() < TIMESTAMPTZ ''2026-06-11 19:00:00+00'') WITH CHECK (now() < TIMESTAMPTZ ''2026-06-11 19:00:00+00'')',
      t || '_update_prelock', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE USING (now() < TIMESTAMPTZ ''2026-06-11 19:00:00+00'')',
      t || '_delete_prelock', t);
  END LOOP;
END $$;

-- Deleting a player cascades into their picks (and FK cascades bypass RLS),
-- so player deletion gets the same gate. Post-lock cleanup of a player, if
-- ever truly needed, goes through the Supabase SQL editor (service role).
DROP POLICY IF EXISTS "players_delete" ON players;
DROP POLICY IF EXISTS "players_delete_prelock" ON players;
CREATE POLICY "players_delete_prelock" ON players
  FOR DELETE USING (now() < TIMESTAMPTZ '2026-06-11 19:00:00+00');
