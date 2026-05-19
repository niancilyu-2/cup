-- ABOUTME: Postgres schema for WC 2026 bracket pick'em on Supabase.
-- ABOUTME: Trust-based access (no auth); RLS open for anon role. Seed data lives in seed.sql.

-- =======================================================================
-- REFERENCE TABLES
-- =======================================================================

CREATE TABLE IF NOT EXISTS groups (
  code TEXT PRIMARY KEY,                 -- 'A'..'L'
  name TEXT NOT NULL                     -- 'Group A'..'Group L'
);

CREATE TABLE IF NOT EXISTS teams (
  code TEXT PRIMARY KEY,                 -- 3-letter, e.g. 'BRA', 'USA'
  name TEXT NOT NULL,                    -- 'Brazil', 'United States'
  flag_emoji TEXT NOT NULL,              -- 🇧🇷
  group_code TEXT NOT NULL REFERENCES groups(code),
  pot INT                                -- 1..4, draw pot for display
);

CREATE INDEX IF NOT EXISTS teams_group_idx ON teams(group_code);

-- =======================================================================
-- MATCHES
-- 104 rows total: 72 group + 32 knockout (R32, R16, QF, SF, 3rd, Final).
-- For group matches, team_a/team_b are pre-filled.
-- For knockout matches, slot_a/slot_b hold semantic labels
-- (e.g. '1A' = winner of Group A, 'W49' = winner of match 49),
-- and team_a/team_b are populated as results determine them.
-- =======================================================================

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,                   -- 'M1'..'M104'
  stage TEXT NOT NULL CHECK (stage IN ('group','r32','r16','qf','sf','third','final')),
  group_code TEXT REFERENCES groups(code),  -- null for knockout
  kickoff_at TIMESTAMPTZ NOT NULL,
  venue TEXT,
  slot_a TEXT NOT NULL,                  -- semantic label
  slot_b TEXT NOT NULL,
  team_a_code TEXT REFERENCES teams(code),
  team_b_code TEXT REFERENCES teams(code),
  score_a INT,
  score_b INT,
  winner_code TEXT REFERENCES teams(code), -- null if draw (group) or not played
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  result_source TEXT,                    -- 'manual' | 'espn_fetch' | null
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS matches_stage_idx ON matches(stage);
CREATE INDEX IF NOT EXISTS matches_kickoff_idx ON matches(kickoff_at);

-- =======================================================================
-- PLAYERS (self-signup, trust-based)
-- =======================================================================

CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =======================================================================
-- PICKS
-- =======================================================================

-- Group standings prediction: 1st and 2nd of each group.
-- Columns are nullable so a player can save partial progress.
CREATE TABLE IF NOT EXISTS group_picks (
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  group_code TEXT NOT NULL REFERENCES groups(code),
  first_code TEXT REFERENCES teams(code),
  second_code TEXT REFERENCES teams(code),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (player_id, group_code),
  CHECK (first_code IS NULL OR second_code IS NULL OR first_code <> second_code)
);

-- R32 draft: which team the player puts in each of the 32 R32 slots.
-- Slot index 1..32 corresponds to position in the bracket.
CREATE TABLE IF NOT EXISTS r32_draft (
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  slot_index INT NOT NULL CHECK (slot_index BETWEEN 1 AND 32),
  team_code TEXT NOT NULL REFERENCES teams(code),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (player_id, slot_index)
);

-- Bracket winner picks for every knockout match (R32 + R16 + QF + SF + 3rd + Final).
-- For R32 matches, winner_code must be one of the two teams the player drafted
-- into the relevant R32 slot pair (enforced app-side).
CREATE TABLE IF NOT EXISTS bracket_picks (
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  match_id TEXT NOT NULL REFERENCES matches(id),
  winner_code TEXT NOT NULL REFERENCES teams(code),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (player_id, match_id)
);

-- Optional exact-score predictions for any match (bonus points).
CREATE TABLE IF NOT EXISTS exact_score_picks (
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  match_id TEXT NOT NULL REFERENCES matches(id),
  score_a INT NOT NULL CHECK (score_a >= 0),
  score_b INT NOT NULL CHECK (score_b >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (player_id, match_id)
);

-- Tiebreaker: predicted total goals scored by the eventual champion.
CREATE TABLE IF NOT EXISTS tiebreaker_picks (
  player_id UUID PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  champion_total_goals INT NOT NULL CHECK (champion_total_goals >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =======================================================================
-- ROW LEVEL SECURITY (trust-based, like rngame)
-- Anyone with the publishable key can read all reference data and picks,
-- and can submit picks. Hide-until-lock is enforced in the app, not DB.
-- =======================================================================

ALTER TABLE groups            ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams             ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches           ENABLE ROW LEVEL SECURITY;
ALTER TABLE players           ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_picks       ENABLE ROW LEVEL SECURITY;
ALTER TABLE r32_draft         ENABLE ROW LEVEL SECURITY;
ALTER TABLE bracket_picks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE exact_score_picks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiebreaker_picks  ENABLE ROW LEVEL SECURITY;

-- Reference tables: read for everyone, no writes from anon.
CREATE POLICY "groups_read"  ON groups  FOR SELECT USING (true);
CREATE POLICY "teams_read"   ON teams   FOR SELECT USING (true);
CREATE POLICY "matches_read" ON matches FOR SELECT USING (true);

-- Players: read + self-signup (insert), no updates/deletes from anon.
CREATE POLICY "players_read"   ON players FOR SELECT USING (true);
CREATE POLICY "players_insert" ON players FOR INSERT WITH CHECK (true);

-- Picks: full read + write for anon (trust-based).
-- App enforces "only your own picks" and "hidden until lock".
CREATE POLICY "group_picks_all"       ON group_picks       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "r32_draft_all"         ON r32_draft         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "bracket_picks_all"     ON bracket_picks     FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "exact_score_picks_all" ON exact_score_picks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tiebreaker_picks_all"  ON tiebreaker_picks  FOR ALL USING (true) WITH CHECK (true);

-- Matches: anon may UPDATE results (admin entry is gated client-side by ADMIN_CODE).
CREATE POLICY "matches_update_results" ON matches FOR UPDATE USING (true) WITH CHECK (true);
