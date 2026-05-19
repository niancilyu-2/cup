-- ABOUTME: Seed data for WC 2026 bracket pick'em — 12 groups, 48 teams, 104 matches.
-- ABOUTME: Apply AFTER schema.sql. Sources: Wikipedia 2026 FIFA World Cup group pages.

-- =======================================================================
-- GROUPS
-- =======================================================================

INSERT INTO groups (code, name) VALUES
  ('A', 'Group A'), ('B', 'Group B'), ('C', 'Group C'), ('D', 'Group D'),
  ('E', 'Group E'), ('F', 'Group F'), ('G', 'Group G'), ('H', 'Group H'),
  ('I', 'Group I'), ('J', 'Group J'), ('K', 'Group K'), ('L', 'Group L')
ON CONFLICT (code) DO NOTHING;

-- =======================================================================
-- TEAMS (48)
-- =======================================================================

INSERT INTO teams (code, name, flag_emoji, group_code, pot) VALUES
  -- Group A
  ('MEX', 'Mexico',                 '🇲🇽', 'A', 1),
  ('RSA', 'South Africa',           '🇿🇦', 'A', 3),
  ('KOR', 'South Korea',            '🇰🇷', 'A', 2),
  ('CZE', 'Czech Republic',         '🇨🇿', 'A', 4),
  -- Group B
  ('CAN', 'Canada',                 '🇨🇦', 'B', 1),
  ('BIH', 'Bosnia and Herzegovina', '🇧🇦', 'B', 4),
  ('QAT', 'Qatar',                  '🇶🇦', 'B', 3),
  ('SUI', 'Switzerland',            '🇨🇭', 'B', 2),
  -- Group C
  ('BRA', 'Brazil',                 '🇧🇷', 'C', 1),
  ('MAR', 'Morocco',                '🇲🇦', 'C', 2),
  ('HAI', 'Haiti',                  '🇭🇹', 'C', 4),
  ('SCO', 'Scotland',               '🏴󠁧󠁢󠁳󠁣󠁴󠁿', 'C', 3),
  -- Group D
  ('USA', 'United States',          '🇺🇸', 'D', 1),
  ('PAR', 'Paraguay',               '🇵🇾', 'D', 3),
  ('AUS', 'Australia',              '🇦🇺', 'D', 2),
  ('TUR', 'Turkey',                 '🇹🇷', 'D', 4),
  -- Group E
  ('GER', 'Germany',                '🇩🇪', 'E', 1),
  ('CUW', 'Curaçao',                '🇨🇼', 'E', 4),
  ('CIV', 'Ivory Coast',            '🇨🇮', 'E', 3),
  ('ECU', 'Ecuador',                '🇪🇨', 'E', 2),
  -- Group F
  ('NED', 'Netherlands',            '🇳🇱', 'F', 1),
  ('JPN', 'Japan',                  '🇯🇵', 'F', 2),
  ('SWE', 'Sweden',                 '🇸🇪', 'F', 4),
  ('TUN', 'Tunisia',                '🇹🇳', 'F', 3),
  -- Group G
  ('BEL', 'Belgium',                '🇧🇪', 'G', 1),
  ('EGY', 'Egypt',                  '🇪🇬', 'G', 3),
  ('IRN', 'Iran',                   '🇮🇷', 'G', 2),
  ('NZL', 'New Zealand',            '🇳🇿', 'G', 4),
  -- Group H
  ('ESP', 'Spain',                  '🇪🇸', 'H', 1),
  ('CPV', 'Cape Verde',             '🇨🇻', 'H', 4),
  ('KSA', 'Saudi Arabia',           '🇸🇦', 'H', 3),
  ('URU', 'Uruguay',                '🇺🇾', 'H', 2),
  -- Group I
  ('FRA', 'France',                 '🇫🇷', 'I', 1),
  ('SEN', 'Senegal',                '🇸🇳', 'I', 2),
  ('IRQ', 'Iraq',                   '🇮🇶', 'I', 4),
  ('NOR', 'Norway',                 '🇳🇴', 'I', 3),
  -- Group J
  ('ARG', 'Argentina',              '🇦🇷', 'J', 1),
  ('ALG', 'Algeria',                '🇩🇿', 'J', 3),
  ('AUT', 'Austria',                '🇦🇹', 'J', 2),
  ('JOR', 'Jordan',                 '🇯🇴', 'J', 4),
  -- Group K
  ('POR', 'Portugal',               '🇵🇹', 'K', 1),
  ('COD', 'DR Congo',               '🇨🇩', 'K', 4),
  ('UZB', 'Uzbekistan',             '🇺🇿', 'K', 3),
  ('COL', 'Colombia',               '🇨🇴', 'K', 2),
  -- Group L
  ('ENG', 'England',                '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 'L', 1),
  ('CRO', 'Croatia',                '🇭🇷', 'L', 2),
  ('GHA', 'Ghana',                  '🇬🇭', 'L', 4),
  ('PAN', 'Panama',                 '🇵🇦', 'L', 3)
ON CONFLICT (code) DO NOTHING;

-- =======================================================================
-- GROUP STAGE MATCHES (M1..M72) — chronological by kickoff
-- Kickoffs stored as TIMESTAMPTZ in local kickoff offset for clarity.
-- =======================================================================

INSERT INTO matches (id, stage, group_code, kickoff_at, venue, slot_a, slot_b, team_a_code, team_b_code) VALUES
  -- June 11
  ('M1',  'group', 'A', '2026-06-11 13:00:00-06', 'Estadio Azteca, Mexico City',  'MEX', 'RSA', 'MEX', 'RSA'),
  ('M2',  'group', 'A', '2026-06-11 20:00:00-06', 'Estadio Akron, Zapopan',       'KOR', 'CZE', 'KOR', 'CZE'),
  -- June 12
  ('M3',  'group', 'B', '2026-06-12 15:00:00-04', 'BMO Field, Toronto',           'CAN', 'BIH', 'CAN', 'BIH'),
  ('M4',  'group', 'D', '2026-06-12 18:00:00-07', 'SoFi Stadium, Inglewood',      'USA', 'PAR', 'USA', 'PAR'),
  -- June 13
  ('M5',  'group', 'B', '2026-06-13 12:00:00-07', 'Levi''s Stadium, Santa Clara', 'QAT', 'SUI', 'QAT', 'SUI'),
  ('M6',  'group', 'C', '2026-06-13 18:00:00-04', 'MetLife Stadium, East Rutherford', 'BRA', 'MAR', 'BRA', 'MAR'),
  ('M7',  'group', 'C', '2026-06-13 21:00:00-04', 'Gillette Stadium, Foxborough', 'HAI', 'SCO', 'HAI', 'SCO'),
  ('M8',  'group', 'D', '2026-06-13 21:00:00-07', 'BC Place, Vancouver',          'AUS', 'TUR', 'AUS', 'TUR'),
  -- June 14
  ('M9',  'group', 'E', '2026-06-14 12:00:00-05', 'NRG Stadium, Houston',         'GER', 'CUW', 'GER', 'CUW'),
  ('M10', 'group', 'F', '2026-06-14 15:00:00-05', 'AT&T Stadium, Arlington',      'NED', 'JPN', 'NED', 'JPN'),
  ('M11', 'group', 'E', '2026-06-14 19:00:00-04', 'Lincoln Financial Field, Philadelphia', 'CIV', 'ECU', 'CIV', 'ECU'),
  ('M12', 'group', 'F', '2026-06-14 20:00:00-06', 'Estadio BBVA, Guadalupe',      'SWE', 'TUN', 'SWE', 'TUN'),
  -- June 15
  ('M13', 'group', 'G', '2026-06-15 12:00:00-07', 'Lumen Field, Seattle',         'BEL', 'EGY', 'BEL', 'EGY'),
  ('M14', 'group', 'H', '2026-06-15 12:00:00-04', 'Mercedes-Benz Stadium, Atlanta', 'ESP', 'CPV', 'ESP', 'CPV'),
  ('M15', 'group', 'H', '2026-06-15 18:00:00-04', 'Hard Rock Stadium, Miami Gardens', 'KSA', 'URU', 'KSA', 'URU'),
  ('M16', 'group', 'G', '2026-06-15 18:00:00-07', 'SoFi Stadium, Inglewood',      'IRN', 'NZL', 'IRN', 'NZL'),
  -- June 16
  ('M17', 'group', 'I', '2026-06-16 15:00:00-04', 'MetLife Stadium, East Rutherford', 'FRA', 'SEN', 'FRA', 'SEN'),
  ('M18', 'group', 'I', '2026-06-16 18:00:00-04', 'Gillette Stadium, Foxborough', 'IRQ', 'NOR', 'IRQ', 'NOR'),
  ('M19', 'group', 'J', '2026-06-16 20:00:00-05', 'Arrowhead Stadium, Kansas City', 'ARG', 'ALG', 'ARG', 'ALG'),
  ('M20', 'group', 'J', '2026-06-16 21:00:00-07', 'Levi''s Stadium, Santa Clara', 'AUT', 'JOR', 'AUT', 'JOR'),
  -- June 17
  ('M21', 'group', 'K', '2026-06-17 12:00:00-05', 'NRG Stadium, Houston',         'POR', 'COD', 'POR', 'COD'),
  ('M22', 'group', 'L', '2026-06-17 15:00:00-05', 'AT&T Stadium, Arlington',      'ENG', 'CRO', 'ENG', 'CRO'),
  ('M23', 'group', 'L', '2026-06-17 19:00:00-04', 'BMO Field, Toronto',           'GHA', 'PAN', 'GHA', 'PAN'),
  ('M24', 'group', 'K', '2026-06-17 20:00:00-06', 'Estadio Azteca, Mexico City',  'UZB', 'COL', 'UZB', 'COL'),
  -- June 18
  ('M25', 'group', 'A', '2026-06-18 12:00:00-04', 'Mercedes-Benz Stadium, Atlanta', 'CZE', 'RSA', 'CZE', 'RSA'),
  ('M26', 'group', 'B', '2026-06-18 12:00:00-07', 'SoFi Stadium, Inglewood',      'SUI', 'BIH', 'SUI', 'BIH'),
  ('M27', 'group', 'A', '2026-06-18 19:00:00-06', 'Estadio Akron, Zapopan',       'MEX', 'KOR', 'MEX', 'KOR'),
  ('M28', 'group', 'B', '2026-06-18 15:00:00-07', 'BC Place, Vancouver',          'CAN', 'QAT', 'CAN', 'QAT'),
  -- June 19
  ('M29', 'group', 'D', '2026-06-19 12:00:00-07', 'Lumen Field, Seattle',         'USA', 'AUS', 'USA', 'AUS'),
  ('M30', 'group', 'C', '2026-06-19 18:00:00-04', 'Gillette Stadium, Foxborough', 'SCO', 'MAR', 'SCO', 'MAR'),
  ('M31', 'group', 'D', '2026-06-19 20:00:00-07', 'Levi''s Stadium, Santa Clara', 'TUR', 'PAR', 'TUR', 'PAR'),
  ('M32', 'group', 'C', '2026-06-19 20:30:00-04', 'Lincoln Financial Field, Philadelphia', 'BRA', 'HAI', 'BRA', 'HAI'),
  -- June 20
  ('M33', 'group', 'E', '2026-06-20 16:00:00-04', 'BMO Field, Toronto',           'GER', 'CIV', 'GER', 'CIV'),
  ('M34', 'group', 'F', '2026-06-20 12:00:00-05', 'NRG Stadium, Houston',         'NED', 'SWE', 'NED', 'SWE'),
  ('M35', 'group', 'E', '2026-06-20 19:00:00-05', 'Arrowhead Stadium, Kansas City', 'ECU', 'CUW', 'ECU', 'CUW'),
  ('M36', 'group', 'F', '2026-06-20 22:00:00-06', 'Estadio BBVA, Guadalupe',      'TUN', 'JPN', 'TUN', 'JPN'),
  -- June 21
  ('M37', 'group', 'G', '2026-06-21 12:00:00-07', 'SoFi Stadium, Inglewood',      'BEL', 'IRN', 'BEL', 'IRN'),
  ('M38', 'group', 'H', '2026-06-21 12:00:00-04', 'Mercedes-Benz Stadium, Atlanta', 'ESP', 'KSA', 'ESP', 'KSA'),
  ('M39', 'group', 'H', '2026-06-21 18:00:00-04', 'Hard Rock Stadium, Miami Gardens', 'URU', 'CPV', 'URU', 'CPV'),
  ('M40', 'group', 'G', '2026-06-21 18:00:00-07', 'BC Place, Vancouver',          'NZL', 'EGY', 'NZL', 'EGY'),
  -- June 22
  ('M41', 'group', 'I', '2026-06-22 17:00:00-04', 'Lincoln Financial Field, Philadelphia', 'FRA', 'IRQ', 'FRA', 'IRQ'),
  ('M42', 'group', 'J', '2026-06-22 12:00:00-05', 'AT&T Stadium, Arlington',      'ARG', 'AUT', 'ARG', 'AUT'),
  ('M43', 'group', 'I', '2026-06-22 20:00:00-04', 'MetLife Stadium, East Rutherford', 'NOR', 'SEN', 'NOR', 'SEN'),
  ('M44', 'group', 'J', '2026-06-22 20:00:00-07', 'Levi''s Stadium, Santa Clara', 'JOR', 'ALG', 'JOR', 'ALG'),
  -- June 23
  ('M45', 'group', 'K', '2026-06-23 12:00:00-05', 'NRG Stadium, Houston',         'POR', 'UZB', 'POR', 'UZB'),
  ('M46', 'group', 'L', '2026-06-23 16:00:00-04', 'Gillette Stadium, Foxborough', 'ENG', 'GHA', 'ENG', 'GHA'),
  ('M47', 'group', 'L', '2026-06-23 19:00:00-04', 'BMO Field, Toronto',           'PAN', 'CRO', 'PAN', 'CRO'),
  ('M48', 'group', 'K', '2026-06-23 20:00:00-06', 'Estadio Akron, Zapopan',       'COL', 'COD', 'COL', 'COD'),
  -- June 24
  ('M49', 'group', 'A', '2026-06-24 19:00:00-06', 'Estadio Azteca, Mexico City',  'CZE', 'MEX', 'CZE', 'MEX'),
  ('M50', 'group', 'A', '2026-06-24 19:00:00-06', 'Estadio BBVA, Guadalupe',      'RSA', 'KOR', 'RSA', 'KOR'),
  ('M51', 'group', 'B', '2026-06-24 12:00:00-07', 'BC Place, Vancouver',          'SUI', 'CAN', 'SUI', 'CAN'),
  ('M52', 'group', 'B', '2026-06-24 12:00:00-07', 'Lumen Field, Seattle',         'BIH', 'QAT', 'BIH', 'QAT'),
  ('M53', 'group', 'C', '2026-06-24 18:00:00-04', 'Hard Rock Stadium, Miami Gardens', 'SCO', 'BRA', 'SCO', 'BRA'),
  ('M54', 'group', 'C', '2026-06-24 18:00:00-04', 'Mercedes-Benz Stadium, Atlanta', 'MAR', 'HAI', 'MAR', 'HAI'),
  -- June 25
  ('M55', 'group', 'D', '2026-06-25 19:00:00-07', 'SoFi Stadium, Inglewood',      'TUR', 'USA', 'TUR', 'USA'),
  ('M56', 'group', 'D', '2026-06-25 19:00:00-07', 'Levi''s Stadium, Santa Clara', 'PAR', 'AUS', 'PAR', 'AUS'),
  ('M57', 'group', 'E', '2026-06-25 16:00:00-04', 'MetLife Stadium, East Rutherford', 'ECU', 'GER', 'ECU', 'GER'),
  ('M58', 'group', 'E', '2026-06-25 16:00:00-04', 'Lincoln Financial Field, Philadelphia', 'CUW', 'CIV', 'CUW', 'CIV'),
  ('M59', 'group', 'F', '2026-06-25 18:00:00-05', 'AT&T Stadium, Arlington',      'JPN', 'SWE', 'JPN', 'SWE'),
  ('M60', 'group', 'F', '2026-06-25 18:00:00-05', 'Arrowhead Stadium, Kansas City', 'TUN', 'NED', 'TUN', 'NED'),
  -- June 26
  ('M61', 'group', 'G', '2026-06-26 20:00:00-07', 'BC Place, Vancouver',          'NZL', 'BEL', 'NZL', 'BEL'),
  ('M62', 'group', 'G', '2026-06-26 20:00:00-07', 'Lumen Field, Seattle',         'EGY', 'IRN', 'EGY', 'IRN'),
  ('M63', 'group', 'H', '2026-06-26 18:00:00-06', 'Estadio Akron, Zapopan',       'URU', 'ESP', 'URU', 'ESP'),
  ('M64', 'group', 'H', '2026-06-26 19:00:00-05', 'NRG Stadium, Houston',         'CPV', 'KSA', 'CPV', 'KSA'),
  ('M65', 'group', 'I', '2026-06-26 15:00:00-04', 'Gillette Stadium, Foxborough', 'NOR', 'FRA', 'NOR', 'FRA'),
  ('M66', 'group', 'I', '2026-06-26 15:00:00-04', 'BMO Field, Toronto',           'SEN', 'IRQ', 'SEN', 'IRQ'),
  -- June 27
  ('M67', 'group', 'L', '2026-06-27 17:00:00-04', 'MetLife Stadium, East Rutherford', 'PAN', 'ENG', 'PAN', 'ENG'),
  ('M68', 'group', 'L', '2026-06-27 17:00:00-04', 'Lincoln Financial Field, Philadelphia', 'CRO', 'GHA', 'CRO', 'GHA'),
  ('M69', 'group', 'K', '2026-06-27 19:30:00-04', 'Hard Rock Stadium, Miami Gardens', 'COL', 'POR', 'COL', 'POR'),
  ('M70', 'group', 'K', '2026-06-27 19:30:00-04', 'Mercedes-Benz Stadium, Atlanta', 'COD', 'UZB', 'COD', 'UZB'),
  ('M71', 'group', 'J', '2026-06-27 21:00:00-05', 'AT&T Stadium, Arlington',      'JOR', 'ARG', 'JOR', 'ARG'),
  ('M72', 'group', 'J', '2026-06-27 21:00:00-05', 'Arrowhead Stadium, Kansas City', 'ALG', 'AUT', 'ALG', 'AUT')
ON CONFLICT (id) DO NOTHING;

-- =======================================================================
-- KNOCKOUT MATCHES (M73..M104)
-- slot_a/slot_b carry the FIFA semantic labels until results resolve them.
-- Kickoffs use date with placeholder local-noon ET; will refine if needed.
-- =======================================================================

INSERT INTO matches (id, stage, kickoff_at, venue, slot_a, slot_b) VALUES
  -- R32 (M73..M88)
  ('M73', 'r32', '2026-06-28 15:00:00-07', 'SoFi Stadium, Inglewood',                '2A',          '2B'),
  ('M74', 'r32', '2026-06-29 15:00:00-04', 'Gillette Stadium, Foxborough',           '1E',          '3A/B/C/D/F'),
  ('M75', 'r32', '2026-06-29 15:00:00-06', 'Estadio BBVA, Guadalupe',                '1F',          '2C'),
  ('M76', 'r32', '2026-06-29 15:00:00-05', 'NRG Stadium, Houston',                   '1C',          '2F'),
  ('M77', 'r32', '2026-06-30 15:00:00-04', 'MetLife Stadium, East Rutherford',       '1I',          '3C/D/F/G/H'),
  ('M78', 'r32', '2026-06-30 15:00:00-05', 'AT&T Stadium, Arlington',                '2E',          '2I'),
  ('M79', 'r32', '2026-06-30 15:00:00-06', 'Estadio Azteca, Mexico City',            '1A',          '3C/E/F/H/I'),
  ('M80', 'r32', '2026-07-01 15:00:00-04', 'Mercedes-Benz Stadium, Atlanta',         '1L',          '3E/H/I/J/K'),
  ('M81', 'r32', '2026-07-01 15:00:00-07', 'Levi''s Stadium, Santa Clara',           '1D',          '3B/E/F/I/J'),
  ('M82', 'r32', '2026-07-01 15:00:00-07', 'Lumen Field, Seattle',                   '1G',          '3A/E/H/I/J'),
  ('M83', 'r32', '2026-07-02 15:00:00-04', 'BMO Field, Toronto',                     '2K',          '2L'),
  ('M84', 'r32', '2026-07-02 15:00:00-07', 'SoFi Stadium, Inglewood',                '1H',          '2J'),
  ('M85', 'r32', '2026-07-02 15:00:00-07', 'BC Place, Vancouver',                    '1B',          '3E/F/G/I/J'),
  ('M86', 'r32', '2026-07-03 15:00:00-04', 'Hard Rock Stadium, Miami Gardens',       '1J',          '2H'),
  ('M87', 'r32', '2026-07-03 15:00:00-05', 'Arrowhead Stadium, Kansas City',         '1K',          '3D/E/I/J/L'),
  ('M88', 'r32', '2026-07-03 15:00:00-05', 'AT&T Stadium, Arlington',                '2D',          '2G'),
  -- R16 (M89..M96)
  ('M89', 'r16', '2026-07-04 15:00:00-04', 'Lincoln Financial Field, Philadelphia',  'W74',         'W77'),
  ('M90', 'r16', '2026-07-04 15:00:00-05', 'NRG Stadium, Houston',                   'W73',         'W75'),
  ('M91', 'r16', '2026-07-05 15:00:00-04', 'MetLife Stadium, East Rutherford',       'W76',         'W78'),
  ('M92', 'r16', '2026-07-05 15:00:00-06', 'Estadio Azteca, Mexico City',            'W79',         'W80'),
  ('M93', 'r16', '2026-07-06 15:00:00-05', 'AT&T Stadium, Arlington',                'W83',         'W84'),
  ('M94', 'r16', '2026-07-06 15:00:00-07', 'Lumen Field, Seattle',                   'W81',         'W82'),
  ('M95', 'r16', '2026-07-07 15:00:00-04', 'Mercedes-Benz Stadium, Atlanta',         'W86',         'W88'),
  ('M96', 'r16', '2026-07-07 15:00:00-07', 'BC Place, Vancouver',                    'W85',         'W87'),
  -- QF (M97..M100)
  ('M97',  'qf', '2026-07-09 15:00:00-04', 'Gillette Stadium, Foxborough',           'W89',         'W90'),
  ('M98',  'qf', '2026-07-10 15:00:00-07', 'SoFi Stadium, Inglewood',                'W93',         'W94'),
  ('M99',  'qf', '2026-07-11 15:00:00-04', 'Hard Rock Stadium, Miami Gardens',       'W91',         'W92'),
  ('M100', 'qf', '2026-07-11 15:00:00-05', 'Arrowhead Stadium, Kansas City',         'W95',         'W96'),
  -- SF (M101..M102)
  ('M101', 'sf', '2026-07-14 15:00:00-05', 'AT&T Stadium, Arlington',                'W97',         'W98'),
  ('M102', 'sf', '2026-07-15 15:00:00-04', 'Mercedes-Benz Stadium, Atlanta',         'W99',         'W100'),
  -- 3rd place + Final
  ('M103', 'third', '2026-07-18 15:00:00-04', 'Hard Rock Stadium, Miami Gardens',    'L101',        'L102'),
  ('M104', 'final', '2026-07-19 15:00:00-04', 'MetLife Stadium, East Rutherford',    'W101',        'W102')
ON CONFLICT (id) DO NOTHING;
