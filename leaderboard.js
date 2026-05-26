// ABOUTME: Renders the leaderboard from Supabase picks scored against MOCK_TOURNAMENT (preview) or real match results.
// ABOUTME: Each row links to a read-only view of that player's picks on the picks page.

import { scorePlayer, PERFECT_TOTAL } from './src/scoring.js';

const STORAGE_KEY_PLAYER = 'wcbracket.player';
const FINAL_MATCH_ID = 'M104';

// FIFA 3-letter code → ISO 3166-1 alpha-2 (used by lipis/flag-icons).
const FIFA_TO_ISO = {
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

// One row per scoring stage. `max` is the perfect-bracket subtotal for that
// stage, so users can read "19 / 24" as a fraction in the hover popover.
const BREAKDOWN_ROWS = [
  { key: 'groups',    label: 'Group standings', max: 24 },
  { key: 'wildcards', label: 'Wildcards',       max: 8  },
  { key: 'r32',       label: 'R32 winners',     max: 32 },
  { key: 'r16',       label: 'R16 winners',     max: 32 },
  { key: 'qf',        label: 'Quarterfinals',   max: 20 },
  { key: 'sf',        label: 'Semifinals',      max: 16 },
  { key: 'final',     label: 'Final',           max: 10 },
];

const root = document.getElementById('leaderboard');
if (root) init();

async function init() {
  let myName = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PLAYER);
    if (raw) myName = (JSON.parse(raw).name || '').toLowerCase();
  } catch {}

  const supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

  try {
    const [playersRes, teamsRes, matchesRes, groupRes, brktRes, tbRes] = await Promise.all([
      supabase.from('players').select('id, name'),
      supabase.from('teams').select('code, name'),
      supabase.from('matches').select('id, stage, group_code, winner_code, completed'),
      supabase.from('group_picks').select('player_id, group_code, first_code, second_code, third_code, third_advances'),
      supabase.from('bracket_picks').select('player_id, match_id, winner_code'),
      supabase.from('tiebreaker_picks').select('player_id, champion_avg_goals'),
    ]);

    for (const r of [playersRes, teamsRes, matchesRes, groupRes, brktRes, tbRes]) {
      if (r.error) throw r.error;
    }

    const teamsByCode = Object.fromEntries(teamsRes.data.map((t) => [t.code, t]));
    const results = buildResults(matchesRes.data);
    const usingMock = isUsingMock(results, matchesRes.data);

    const picksByPlayer = bucketPicks(groupRes.data, brktRes.data, tbRes.data);
    const rows = playersRes.data
      .map((p) => buildRow(p, picksByPlayer.get(p.id) || emptyPicks(), results, teamsByCode))
      .filter((r) => r.hasAnyPicks);

    rows.sort((a, b) => b.points - a.points);
    rows.forEach((r, i) => { r.rank = i + 1; });

    render(rows, myName, usingMock);
  } catch (err) {
    root.innerHTML = `<div class="lb-error">Couldn't load leaderboard. ${escapeHtml(err.message || String(err))}</div>`;
  }
}

// ---------- Results assembly ----------

// Build the `results` shape scorePlayer expects. Prefer real match data when
// any match is marked completed; otherwise fall back to MOCK_TOURNAMENT so the
// preview shows a meaningful ranking before Phase 4 wires in live results.
function buildResults(matches) {
  const realCompleted = matches.some((m) => m.completed);
  if (realCompleted) return buildResultsFromMatches(matches);
  const mock = window.MOCK_TOURNAMENT;
  if (mock && mock.status && mock.status !== 'not_started') return mockToResults(mock);
  return { groupOutcomes: {}, matchResults: {} };
}

function isUsingMock(results, matches) {
  if (matches.some((m) => m.completed)) return false;
  return Object.keys(results.matchResults).length > 0 || Object.keys(results.groupOutcomes).length > 0;
}

function buildResultsFromMatches(matches) {
  // Phase 4 will populate this from real DB data. For now it's empty unless an
  // admin has marked at least one match completed.
  const groupOutcomes = {};
  const matchResults = {};
  // Group standings can't be derived from individual match rows alone (need
  // standings calc). Leave empty until Phase 4 builds a real standings view.
  for (const m of matches) {
    if (m.stage === 'group') continue;
    if (m.completed) {
      matchResults[m.id] = { winner: m.winner_code, played: true };
    }
  }
  return { groupOutcomes, matchResults };
}

function mockToResults(mock) {
  const groupOutcomes = {};
  for (const [code, o] of Object.entries(mock.groupOutcomes || {})) {
    groupOutcomes[code] = {
      first: o.first,
      second: o.second,
      third: o.third,
      third_advances: !!o.third_advances,
    };
  }
  const matchResults = {};
  for (const [id, r] of Object.entries(mock.matchResults || {})) {
    if (r && r.played && r.winner) {
      matchResults[id] = { winner: r.winner, played: true };
    }
  }
  return { groupOutcomes, matchResults };
}

// ---------- Pick assembly ----------

function emptyPicks() {
  return { groups: {}, bracket: {}, tiebreaker: null };
}

function bucketPicks(groupRows, brktRows, tbRows) {
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

function buildRow(player, picks, results, teamsByCode) {
  const score = scorePlayer(picks, results);
  const champCode = picks.bracket[FINAL_MATCH_ID] || null;
  const champion = champCode
    ? { code: champCode, name: teamsByCode[champCode]?.name || champCode }
    : null;
  const hasAnyPicks =
    Object.keys(picks.groups).length > 0 ||
    Object.keys(picks.bracket).length > 0 ||
    picks.tiebreaker != null;
  return {
    id: player.id,
    name: player.name,
    champion,
    points: score.total,
    breakdown: score,
    tiebreaker: picks.tiebreaker,
    hasAnyPicks,
  };
}

// ---------- Rendering ----------

function render(rows, myNameLower, usingMock) {
  const badge = usingMock
    ? '<div class="lb-preview-badge">Preview · scored against demo results</div>'
    : '';

  if (!rows.length) {
    root.innerHTML = `
      ${badge}
      <div class="lb-empty">No players have entered picks yet. Once anyone saves picks on the home page, they'll appear here.</div>
    `;
    return;
  }

  root.innerHTML = `
    ${badge}
    <table class="lb-table">
      <thead>
        <tr>
          <th class="lb-col-rank">#</th>
          <th class="lb-col-name">Player</th>
          <th class="lb-col-champ">Champion pick</th>
          <th class="lb-col-pts">Pts</th>
          <th class="lb-col-tb">Tiebreaker</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((p) => rowHTML(p, myNameLower)).join('')}
      </tbody>
    </table>
  `;
}

function rowHTML(p, myNameLower) {
  const isLeader = p.rank === 1;
  const isMe = myNameLower && p.name.toLowerCase() === myNameLower;
  const classes = ['lb-row'];
  if (isLeader) classes.push('lb-leader');
  if (isMe) classes.push('lb-me');
  const viewHref = `index.html?view=${encodeURIComponent(p.id)}`;
  const champHTML = p.champion
    ? `<span class="fi fi-${flagCode(p.champion.code)} lb-flag" aria-hidden="true"></span>
       <span class="lb-champ-name">${escapeHtml(p.champion.name)}</span>`
    : '<span class="lb-champ-empty">—</span>';
  const tbHTML = p.tiebreaker == null
    ? '<span class="lb-tb-empty">—</span>'
    : `${p.tiebreaker.toFixed(2)} <span class="lb-tb-unit">g/g</span>`;

  return `
    <tr class="${classes.join(' ')}">
      <td class="lb-col-rank"><span class="lb-rank-num">${p.rank}</span></td>
      <td class="lb-col-name">
        <a class="lb-name-link" href="${viewHref}">${escapeHtml(p.name)}</a>${isMe ? ' <span class="lb-you-pill">you</span>' : ''}
      </td>
      <td class="lb-col-champ">${champHTML}</td>
      <td class="lb-col-pts" tabindex="0" aria-label="${p.points} points — hover or focus for breakdown">
        <span class="lb-pts-total">${p.points}</span>
        ${breakdownHTML(p)}
      </td>
      <td class="lb-col-tb">${tbHTML}</td>
    </tr>
  `;
}

function breakdownHTML(p) {
  const b = p.breakdown;
  if (!b) return '';
  const rows = BREAKDOWN_ROWS.map((r) => `
    <div class="lb-bd-row">
      <span class="lb-bd-label">${r.label}</span>
      <span class="lb-bd-val">${b[r.key]} <span class="lb-bd-max">/ ${r.max}</span></span>
    </div>
  `).join('');
  return `
    <div class="lb-breakdown" role="tooltip">
      <div class="lb-bd-title">Score breakdown</div>
      ${rows}
      <div class="lb-bd-total">
        <span>Total</span>
        <span>${p.points} <span class="lb-bd-max">/ ${PERFECT_TOTAL}</span></span>
      </div>
    </div>`;
}

function flagCode(teamCode) {
  return FIFA_TO_ISO[teamCode] || String(teamCode || '').toLowerCase();
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
