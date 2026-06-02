// ABOUTME: Renders the leaderboard from Supabase picks scored against real match results.
// ABOUTME: Each row links to a read-only view of that player's picks on the picks page.

import { scorePlayer, PERFECT_TOTAL, STAGE_POINTS } from './src/scoring.js';
import { buildTournamentResults } from './src/results.js';
import { buildReachability, isOutOfContention, maxPossible } from './src/projection.js';

const STORAGE_KEY_PLAYER = 'wcbracket.player';
const FINAL_MATCH_ID = 'M104';

// FIFA 3-letter code → ISO 3166-1 alpha-2 (used by lipis/flag-icons).
// Deterministic auto-avatar from the player id (stable across renames).
function avatarUrl(id) {
  return `https://api.dicebear.com/9.x/adventurer/svg?seed=${encodeURIComponent(id)}`;
}

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

// One row per scoring stage. The hover popover shows the per-stage calculation
// (correct picks × points each = subtotal).
const BREAKDOWN_ROWS = [
  { key: 'groups',    label: 'Group standings' },
  { key: 'wildcards', label: 'Wildcards' },
  { key: 'r32',       label: 'R32 winners' },
  { key: 'r16',       label: 'R16 winners' },
  { key: 'qf',        label: 'Quarterfinals' },
  { key: 'sf',        label: 'Semifinals' },
  { key: 'final',     label: 'Final' },
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
      supabase.from('matches').select('id, stage, group_code, slot_a, slot_b, team_a_code, team_b_code, score_a, score_b, winner_code, completed'),
      supabase.from('group_picks').select('player_id, group_code, first_code, second_code, third_code, third_advances'),
      supabase.from('bracket_picks').select('player_id, match_id, winner_code'),
      supabase.from('tiebreaker_picks').select('player_id, champion_avg_goals'),
    ]);

    for (const r of [playersRes, teamsRes, matchesRes, groupRes, brktRes, tbRes]) {
      if (r.error) throw r.error;
    }

    const teamsByCode = Object.fromEntries(teamsRes.data.map((t) => [t.code, t]));
    const results = buildResults(matchesRes.data);
    const hasResults = matchesRes.data.some((m) => m.completed);
    const reach = buildReachability(matchesRes.data, results);

    const picksByPlayer = bucketPicks(groupRes.data, brktRes.data, tbRes.data);
    const rows = playersRes.data
      .map((p) => buildRow(p, picksByPlayer.get(p.id) || emptyPicks(), results, reach, matchesRes.data, teamsByCode))
      .filter((r) => r.hasAnyPicks);

    rows.sort((a, b) => b.points - a.points);
    rows.forEach((r, i) => { r.rank = i + 1; });

    render(rows, myName, hasResults);
  } catch (err) {
    root.innerHTML = `<div class="lb-error">Couldn't load leaderboard. ${escapeHtml(err.message || String(err))}</div>`;
  }
}

// ---------- Results assembly ----------

// Scoring results are derived from raw match rows by the shared results module.
const buildResults = buildTournamentResults;

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

function buildRow(player, picks, results, reach, matches, teamsByCode) {
  const score = scorePlayer(picks, results);
  const champCode = picks.bracket[FINAL_MATCH_ID] || null;
  const champion = champCode
    ? {
        code: champCode,
        name: teamsByCode[champCode]?.name || champCode,
        eliminated: isOutOfContention(reach, champCode),
      }
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
    accuracy: computeAccuracy(score, results),
    maxPossible: maxPossible({ breakdown: score, picks, results, matches, reach }),
  };
}

function correctCount(breakdown) {
  let total = 0;
  for (const key of Object.keys(STAGE_POINTS)) {
    const pts = STAGE_POINTS[key];
    if (!pts) continue;
    total += Math.round((breakdown[key] || 0) / pts);
  }
  return total;
}

function decidedPicksCount(results) {
  const decidedGroups = Object.keys(results.groupOutcomes).length;
  const groupSlots = decidedGroups * 2;
  const wildcards = decidedGroups === 12 ? 8 : 0;
  const ko = Object.values(results.matchResults).filter((r) => r.played).length;
  return groupSlots + wildcards + ko;
}

function computeAccuracy(breakdown, results) {
  const decided = decidedPicksCount(results);
  if (!decided) return null;
  return Math.round((correctCount(breakdown) / decided) * 100);
}

// ---------- Rendering ----------

function render(rows, myNameLower, hasResults) {
  if (!rows.length) {
    root.innerHTML = `
      <div class="lb-empty">No players have entered picks yet. Once anyone saves picks on the home page, they'll appear here.</div>
    `;
    return;
  }

  if (!hasResults) {
    root.innerHTML = `
      <div class="lb-empty">The leaderboard goes live when the first match kicks off on June&nbsp;11. Check back once results start coming in.</div>
    `;
    return;
  }

  root.innerHTML = `
    <div class="lb-legend">
      <span class="lb-legend-item lb-legend-item--primary">
        <span class="lb-legend-key"><span class="lb-pts-star" aria-hidden="true">★</span> Pts</span>
        <span class="lb-legend-desc">Official tournament score &mdash; this is what wins.</span>
      </span>
      <span class="lb-legend-item">
        <span class="lb-legend-key">Champion</span>
        <span class="lb-legend-desc">Picked final winner. <span class="lb-legend-x">&times;</span> = eliminated.</span>
      </span>
      <span class="lb-legend-item">
        <span class="lb-legend-key">Acc</span>
        <span class="lb-legend-desc">% of decided picks correct so far.</span>
      </span>
      <span class="lb-legend-item">
        <span class="lb-legend-key">Max</span>
        <span class="lb-legend-desc">Highest score still mathematically reachable.</span>
      </span>
      <span class="lb-legend-item">
        <span class="lb-legend-key">Tiebreaker</span>
        <span class="lb-legend-desc">Predicted avg goals/game for the champion.</span>
      </span>
    </div>
    <table class="lb-table">
      <thead>
        <tr>
          <th class="lb-col-rank">#</th>
          <th class="lb-col-name">Player</th>
          <th class="lb-col-pts"><span class="lb-pts-star" aria-hidden="true">★</span> Pts</th>
          <th class="lb-col-acc" title="Correct picks / decided picks so far">Acc</th>
          <th class="lb-col-max" title="Most points still mathematically reachable (current + viable picks)">Max</th>
          <th class="lb-col-champ">Champion</th>
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
  const viewHref = `./?view=${encodeURIComponent(p.id)}`;
  const champOut = !!(p.champion && p.champion.eliminated);
  const champHTML = p.champion
    ? `<span class="fi fi-${flagCode(p.champion.code)} lb-flag${champOut ? ' is-out' : ''}" aria-hidden="true"></span>
       <span class="lb-champ-name${champOut ? ' is-out' : ''}">${escapeHtml(p.champion.name)}</span>
       ${champOut ? '<span class="lb-champ-out" title="Champion eliminated">×</span>' : ''}`
    : '<span class="lb-champ-empty">—</span>';
  const accHTML = p.accuracy == null
    ? '<span class="lb-acc-empty">—</span>'
    : `${p.accuracy}<span class="lb-acc-unit">%</span>`;
  const maxHTML = `${p.maxPossible}<span class="lb-max-suffix"> / ${PERFECT_TOTAL}</span>`;
  const tbHTML = p.tiebreaker == null
    ? '<span class="lb-tb-empty">—</span>'
    : `${p.tiebreaker.toFixed(2)} <span class="lb-tb-unit">g/g</span>`;

  return `
    <tr class="${classes.join(' ')}">
      <td class="lb-col-rank">${rankCellHTML(p.rank)}</td>
      <td class="lb-col-name">
        <img class="lb-avatar" src="${avatarUrl(p.id)}" alt="" />
        <a class="lb-name-link" href="${viewHref}">${escapeHtml(p.name)}</a>${isMe ? ' <span class="lb-you-pill">you</span>' : ''}
      </td>
      <td class="lb-col-pts" tabindex="0" aria-label="${p.points} points — hover or focus for breakdown">
        <span class="lb-pts-total">${p.points}</span>
        ${breakdownHTML(p)}
      </td>
      <td class="lb-col-acc">${accHTML}</td>
      <td class="lb-col-max">${maxHTML}</td>
      <td class="lb-col-champ">${champHTML}</td>
      <td class="lb-col-tb">${tbHTML}</td>
    </tr>
  `;
}

const MEDAL_BY_RANK = { 1: 'gold', 2: 'silver', 3: 'bronze' };
const MEDAL_LABEL = { gold: '1st place', silver: '2nd place', bronze: '3rd place' };
const TROPHY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 4h10v3a5 5 0 0 1-10 0V4Z"/><path d="M5 5H3v2a3 3 0 0 0 3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M19 5h2v2a3 3 0 0 1-3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M10 13h4l-.5 3h-3L10 13Z"/><rect x="8" y="17" width="8" height="2" rx="0.5"/></svg>';

function rankCellHTML(rank) {
  const medal = MEDAL_BY_RANK[rank];
  if (medal) {
    return `<span class="lb-rank-medal lb-rank-medal--${medal}" title="${MEDAL_LABEL[medal]}" aria-label="${MEDAL_LABEL[medal]}">${TROPHY_SVG}</span>`;
  }
  return `<span class="lb-rank-num">${rank}</span>`;
}

function breakdownHTML(p) {
  const b = p.breakdown;
  if (!b) return '';
  const rows = BREAKDOWN_ROWS.map((r) => {
    const pts = STAGE_POINTS[r.key];
    const subtotal = b[r.key] || 0;
    const correct = pts ? Math.round(subtotal / pts) : 0;
    return `
      <div class="lb-bd-row">
        <span class="lb-bd-label">${r.label}</span>
        <span class="lb-bd-calc">
          <span class="lb-bd-count">${correct}</span>
          <span class="lb-bd-op">×</span>
          <span class="lb-bd-each">${pts}</span>
          <span class="lb-bd-op">=</span>
          <span class="lb-bd-sub">${subtotal}</span>
        </span>
      </div>`;
  }).join('');
  return `
    <div class="lb-breakdown" role="tooltip">
      <div class="lb-bd-title">Score breakdown</div>
      <div class="lb-bd-head">
        <span></span>
        <span class="lb-bd-head-calc">correct &times; pts = total</span>
      </div>
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
