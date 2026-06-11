// ABOUTME: Shared browser-page helpers — flags, avatars, HTML escaping, pick bucketing.
// ABOUTME: Used by leaderboard.js and pool-stats.js; pure, no DOM or network.

// FIFA 3-letter code → ISO 3166-1 alpha-2 (used by lipis/flag-icons).
export const FIFA_TO_ISO = {
  MEX: 'mx', RSA: 'za', KOR: 'kr', CZE: 'cz',
  CAN: 'ca', BIH: 'ba', QAT: 'qa', SUI: 'ch',
  BRA: 'br', MAR: 'ma', HAI: 'ht', SCO: 'gb-sct',
  USA: 'us', PAR: 'py', AUS: 'au', TUR: 'tr',
  GER: 'de', CUW: 'cw', CIV: 'ci', ECU: 'ec',
  NED: 'nl', JPN: 'jp', SWE: 'se', TUN: 'tn',
  BEL: 'be', EGY: 'eg', IRN: 'ir', NZL: 'nz',
  ESP: 'es', CPV: 'cv', KSA: 'sa', URU: 'uy',
  FRA: 'fr', SEN: 'sn', IRQ: 'iq', NOR: 'no',
  ARG: 'ar', ALG: 'dz', AUT: 'at', JOR: 'jo',
  POR: 'pt', COD: 'cd', UZB: 'uz', COL: 'co',
  ENG: 'gb-eng', CRO: 'hr', GHA: 'gh', PAN: 'pa',
};

export function flagCode(teamCode) {
  return FIFA_TO_ISO[teamCode] || String(teamCode || '').toLowerCase();
}

// Deterministic auto-avatar from the player id (stable across renames).
export function avatarUrl(id) {
  return `https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(id)}`;
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function emptyPicks() {
  return { groups: {}, bracket: {}, tiebreaker: null };
}

// Bucket raw pick rows into Map<playerId, {groups, bracket, tiebreaker}>.
export function bucketPicks(groupRows, brktRows, tbRows) {
  const out = new Map();
  const get = (pid) => {
    let p = out.get(pid);
    if (!p) { p = emptyPicks(); out.set(pid, p); }
    return p;
  };
  for (const row of groupRows) {
    get(row.player_id).groups[row.group_code] = {
      first: row.first_code,
      second: row.second_code,
      third: row.third_code,
      advances: !!row.third_advances,
    };
  }
  for (const row of brktRows) {
    get(row.player_id).bracket[row.match_id] = row.winner_code;
  }
  for (const row of tbRows) {
    get(row.player_id).tiebreaker = row.champion_avg_goals == null ? null : Number(row.champion_avg_goals);
  }
  return out;
}
