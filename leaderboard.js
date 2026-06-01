// ABOUTME: Renders the leaderboard from Supabase picks scored against MOCK_TOURNAMENT (preview) or real match results.
// ABOUTME: Each row links to a read-only view of that player's picks on the picks page.

import { scorePlayer, PERFECT_TOTAL, STAGE_POINTS } from './src/scoring.js';
import { lookupAssignment, WILDCARD_SLOTS, ALL_GROUPS } from './src/wildcards.js';

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
      supabase.from('matches').select('id, stage, group_code, slot_a, slot_b, winner_code, completed'),
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
    const eliminated = buildEliminatedSet(matchesRes.data, results);

    const picksByPlayer = bucketPicks(groupRes.data, brktRes.data, tbRes.data);
    const rows = playersRes.data
      .map((p) => buildRow(p, picksByPlayer.get(p.id) || emptyPicks(), results, eliminated, matchesRes.data, teamsByCode))
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

// ---------- Bracket cascade (for "team still alive" / Max possible) ----------

// Walk the actual cascade of completed KO matches and return the set of teams
// who've been eliminated (played a completed KO match and didn't win it).
function buildEliminatedSet(matches, results) {
  const matchById = Object.fromEntries(matches.map((m) => [m.id, m]));
  const participantCache = {};

  // Wildcard slot assignment requires all 12 groups decided; otherwise leave it
  // empty and treat 3rd-place R32 slots as unresolved (their participants stay
  // unknown until the group stage is complete).
  let wildcardSlotForGroup = {};
  const allGroupsDecided = Object.keys(results.groupOutcomes).length === 12;
  if (allGroupsDecided) {
    const advancing = ALL_GROUPS.filter((g) => results.groupOutcomes[g]?.third_advances).sort();
    if (advancing.length === 8) {
      const assignment = lookupAssignment(advancing);
      if (assignment) {
        for (const [matchId, group] of Object.entries(assignment)) {
          wildcardSlotForGroup[group] = matchId;
        }
      }
    }
  }

  function resolveSlot(matchId, label) {
    if (!label) return null;
    if (/^[12][A-L]$/.test(label)) {
      const place = label[0] === '1' ? 'first' : 'second';
      return results.groupOutcomes[label[1]]?.[place] || null;
    }
    if (label.startsWith('3')) {
      const slot = WILDCARD_SLOTS.find((s) => s.matchId === matchId);
      if (!slot) return null;
      for (const group of slot.eligible) {
        if (wildcardSlotForGroup[group] === matchId) {
          return results.groupOutcomes[group]?.third || null;
        }
      }
      return null;
    }
    if (label.startsWith('W')) {
      const priorId = `M${label.slice(1)}`;
      return results.matchResults[priorId]?.winner || null;
    }
    if (label.startsWith('L')) {
      const priorId = `M${label.slice(1)}`;
      const winner = results.matchResults[priorId]?.winner;
      if (!winner) return null;
      const p = participantsFor(priorId);
      if (!p) return null;
      if (winner === p[0]) return p[1];
      if (winner === p[1]) return p[0];
      return null;
    }
    return null;
  }

  function participantsFor(matchId) {
    if (matchId in participantCache) return participantCache[matchId];
    const m = matchById[matchId];
    if (!m || m.stage === 'group') {
      participantCache[matchId] = null;
      return null;
    }
    const a = resolveSlot(matchId, m.slot_a);
    const b = resolveSlot(matchId, m.slot_b);
    const out = (a && b) ? [a, b] : null;
    participantCache[matchId] = out;
    return out;
  }

  const eliminated = new Set();
  for (const m of matches) {
    if (m.stage === 'group') continue;
    const r = results.matchResults[m.id];
    if (!r || !r.played) continue;
    const p = participantsFor(m.id);
    if (!p) continue;
    for (const team of p) {
      if (team && team !== r.winner) eliminated.add(team);
    }
  }
  return eliminated;
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

function buildRow(player, picks, results, eliminated, matches, teamsByCode) {
  const score = scorePlayer(picks, results);
  const champCode = picks.bracket[FINAL_MATCH_ID] || null;
  const champion = champCode
    ? {
        code: champCode,
        name: teamsByCode[champCode]?.name || champCode,
        eliminated: eliminated.has(champCode),
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
    maxPossible: computeMaxPossible(score, picks, results, eliminated, matches),
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

// Current points already in the bag + max points still earnable on undecided
// items where the player's pick is still viable. A player only gets max-credit
// for slots they actually picked — empty picks can't earn points.
function computeMaxPossible(breakdown, picks, results, eliminated, matches) {
  let max = breakdown.total;

  // Groups: undecided groups can still award 1 pt for each of 1st/2nd slot the
  // player filled in.
  const decidedGroups = new Set(Object.keys(results.groupOutcomes));
  for (const g of ALL_GROUPS) {
    if (decidedGroups.has(g)) continue;
    const gp = picks.groups[g];
    if (!gp) continue;
    if (gp.first) max += 1;
    if (gp.second) max += 1;
  }

  // Wildcards: only realized once all 12 groups decided. While groups are still
  // open, the player can still earn up to (groups flagged as advancing, capped
  // at 8) wildcard points.
  if (decidedGroups.size < 12) {
    const flagged = Object.values(picks.groups).filter((g) => g.advances).length;
    max += Math.min(8, flagged) - (breakdown.wildcards || 0);
  }

  // Knockouts: for each match not yet played, add stage points if the player
  // has a pick AND that pick hasn't been eliminated in an earlier round.
  for (const m of matches) {
    if (m.stage === 'group') continue;
    const r = results.matchResults[m.id];
    if (r && r.played) continue;
    const pick = picks.bracket[m.id];
    if (!pick) continue;
    if (eliminated.has(pick)) continue;
    max += STAGE_POINTS[m.stage] || 0;
  }
  return max;
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
  const viewHref = `index.html?view=${encodeURIComponent(p.id)}`;
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
        <span class="lb-bd-head-calc">
          <span>correct</span>
          <span></span>
          <span>pts</span>
          <span></span>
          <span>total</span>
        </span>
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
