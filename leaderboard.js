// ABOUTME: Renders the leaderboard from Supabase picks scored against real match results.
// ABOUTME: Each row links to a read-only view of that player's picks on the picks page.

import { scorePlayer, PERFECT_TOTAL, STAGE_POINTS } from './src/scoring.js';
import { buildTournamentResults } from './src/results.js';
import { buildReachability, isOutOfContention, maxPossible } from './src/projection.js';
import { flagCode, avatarUrl, escapeHtml, bucketPicks, emptyPicks } from './src/page-utils.js';

const STORAGE_KEY_PLAYER = 'wcbracket.player';
const FINAL_MATCH_ID = 'M104';
const THIRD_PLACE_MATCH_ID = 'M103'; // played but never scored — see scoring.js
// Same instant as app.js's lock and the DB RLS freeze (2026-06-11 19:00 UTC).
// The board reveals champion picks + tiebreakers, so it must stay hidden
// until the lock — but from lock onward it shows even before any result.
const LOCK_DATE_ISO = '2026-06-11T13:00:00-06:00';

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
      supabase.from('matches').select('id, stage, group_code, slot_a, slot_b, team_a_code, team_b_code, score_a, score_b, winner_code, completed, updated_at'),
      supabase.from('group_picks').select('player_id, group_code, first_code, second_code, third_code, third_advances'),
      supabase.from('bracket_picks').select('player_id, match_id, winner_code'),
      supabase.from('tiebreaker_picks').select('player_id, champion_avg_goals'),
    ]);

    for (const r of [playersRes, teamsRes, matchesRes, groupRes, brktRes, tbRes]) {
      if (r.error) throw r.error;
      // Supabase silently caps un-ranged queries at 1000 rows; mis-scoring
      // players whose rows fell past the cap would be invisible. Fail loudly.
      if (r.data && r.data.length >= 1000) {
        throw new Error('Pick data exceeds a single query — leaderboard needs pagination.');
      }
    }

    const teamsByCode = Object.fromEntries(teamsRes.data.map((t) => [t.code, t]));
    const results = buildResults(matchesRes.data);
    const hasResults = matchesRes.data.some((m) => m.completed);
    const reach = buildReachability(matchesRes.data, results);

    const picksByPlayer = bucketPicks(groupRes.data, brktRes.data, tbRes.data);
    const rows = playersRes.data
      .map((p) => buildRow(p, picksByPlayer.get(p.id) || emptyPicks(), results, reach, matchesRes.data, teamsByCode))
      .filter((r) => r.hasAnyPicks);

    // Tiebreaker: once the Final is decided, ties on points break by whose
    // predicted avg is closest to the actual champion's avg goals per game.
    const champStats = actualChampionStats(matchesRes.data);
    const tbDist = (r) => (champStats && r.tiebreaker != null)
      ? Math.abs(r.tiebreaker - champStats.avg)
      : null;
    rows.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.maxPossible !== a.maxPossible) return b.maxPossible - a.maxPossible;
      const da = tbDist(a);
      const db = tbDist(b);
      if (da != null || db != null) {
        if (da == null) return 1; // no tiebreaker entered sorts below
        if (db == null) return -1;
        if (da !== db) return da - db;
      }
      return a.name.localeCompare(b.name);
    });
    // Standard competition ranking: genuinely tied rows share a rank (1,2,2,4)
    // instead of getting arbitrary distinct ranks from the sort order.
    rows.forEach((r, i) => {
      const prev = rows[i - 1];
      const tiedWithPrev = prev && r.points === prev.points &&
        r.maxPossible === prev.maxPossible &&
        (tbDist(r) ?? Infinity) === (tbDist(prev) ?? Infinity);
      r.rank = tiedWithPrev ? prev.rank : i + 1;
    });

    render(rows, myName, hasResults, champStats, matchesRes.data);
  } catch (err) {
    root.innerHTML = `<div class="lb-error">Couldn't load leaderboard. ${escapeHtml(err.message || String(err))}</div>`;
  }
}

// ---------- Results assembly ----------

// Scoring results are derived from raw match rows by the shared results module.
const buildResults = buildTournamentResults;

// The real champion's average goals per game (their own goals, regulation +
// extra time — shootout kicks are not in score_a/b). Null until the Final is
// decided, so the tiebreaker only kicks in when it can be computed.
function actualChampionStats(matches) {
  const final = matches.find((m) => m.id === FINAL_MATCH_ID);
  if (!final?.completed || !final.winner_code) return null;
  const code = final.winner_code;
  const played = matches.filter((m) =>
    m.completed && m.score_a != null && m.score_b != null &&
    (m.team_a_code === code || m.team_b_code === code));
  if (!played.length) return null;
  const goals = played.reduce(
    (sum, m) => sum + (m.team_a_code === code ? m.score_a : m.score_b), 0);
  return { code, avg: goals / played.length };
}

// ---------- Pick assembly ----------
// (bucketPicks / emptyPicks live in src/page-utils.js, shared with pool-stats.js)

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
  // M103 is played but never scored, so it must not inflate the denominator.
  const ko = Object.entries(results.matchResults)
    .filter(([id, r]) => r.played && id !== THIRD_PLACE_MATCH_ID).length;
  return groupSlots + wildcards + ko;
}

function computeAccuracy(breakdown, results) {
  const decided = decidedPicksCount(results);
  if (!decided) return null;
  return Math.round((correctCount(breakdown) / decided) * 100);
}

// ---------- Rendering ----------

function heroHTML(liveStripHTML) {
  return `
    <section class="lb-hero">
      <div>
        <div class="lb-kicker"><span class="lb-live-light" aria-hidden="true"></span> Live</div>
        <h2>Leaderboard</h2>
      </div>
      ${liveStripHTML}
    </section>`;
}

// "Last update" = the freshest updated_at among matches with result activity
// (the sync bumps it on score writes); seed timestamps don't count.
function latestUpdateLabel(matches) {
  let max = null;
  for (const m of matches) {
    if (!m.completed && m.score_a == null && m.score_b == null) continue;
    if (m.updated_at && (!max || m.updated_at > max)) max = m.updated_at;
  }
  if (!max) return '&mdash;';
  return new Date(max).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
  }) + ' ET';
}

function liveStripHTML(matches) {
  const total = matches.length || 104;
  const completed = matches.filter((m) => m.completed).length;
  const fillPct = Math.round((completed / total) * 1000) / 10;
  return `
    <div class="lb-live-strip" aria-label="Leaderboard live summary">
      <div class="lb-live-stat">
        <span>Matches completed</span>
        <strong>${completed} / ${total}</strong>
        <div class="lb-progress-track" aria-hidden="true"><span style="width: ${fillPct}%"></span></div>
      </div>
      <div class="lb-live-stat">
        <span>Last update</span>
        <strong>${latestUpdateLabel(matches)}</strong>
      </div>
      <div class="lb-live-stat lb-live-stat--prize">
        <span>Total pool prize</span>
        <strong>$200</strong>
        <small>Winner takes all</small>
      </div>
    </div>`;
}

const PODIUM_VARIANT = { 1: 'gold', 2: 'silver', 3: 'bronze' };
const PODIUM_LABEL = { 1: 'Current leader', 2: 'Chasing', 3: 'On the podium' };

// Top three table rows. Variant/label key off each row's (possibly shared)
// rank, never the array index — a points+tiebreaker tie can mean two golds.
function podiumHTML(rows, hasResults) {
  const cards = rows.slice(0, 3).map((p) => {
    const variant = PODIUM_VARIANT[p.rank] || 'bronze';
    const label = hasResults ? (PODIUM_LABEL[p.rank] || 'On the podium') : 'Tied at kickoff';
    return `
      <article class="lb-podium-card lb-podium-card--${variant}">
        <span class="lb-podium-rank lb-podium-rank--${variant}">${hasResults ? p.rank : '–'}</span>
        <span class="lb-podium-label">${label}</span>
        <div class="lb-podium-player">
          <img class="lb-podium-avatar" src="${avatarUrl(p.id)}" alt="" />
          <span class="lb-podium-name">${escapeHtml(p.name)}</span>
        </div>
        <div class="lb-podium-score">${p.points} pts</div>
      </article>`;
  });
  return `<section class="lb-podium" aria-label="Top three players">${cards.join('')}</section>`;
}

function legendHTML(champStats) {
  return `
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
        <span class="lb-legend-desc">Predicted avg goals/game for the champion.${
          champStats ? ` Actual: <strong>${champStats.avg.toFixed(2)}</strong>.` : ''
        }</span>
      </span>
    </div>`;
}

function render(rows, myNameLower, hasResults, champStats, matches) {
  if (!rows.length) {
    root.innerHTML = `
      ${heroHTML('')}
      <div class="lb-empty">No players have entered picks yet. Once anyone saves picks on the home page, they'll appear here.</div>
    `;
    return;
  }

  // Pre-lock the board stays hidden — it reveals champion picks and
  // tiebreakers, which are private until first kickoff. From lock onward the
  // full design renders even before any result lands (zeros + dashes).
  if (new Date() < new Date(LOCK_DATE_ISO)) {
    root.innerHTML = `
      ${heroHTML('')}
      <div class="lb-empty">The leaderboard goes live when the first match kicks off on June&nbsp;11. Check back once results start coming in.</div>
    `;
    return;
  }

  // Stage chips: every stage always shows (0×w=0 until it scores); the
  // per-stage max marks the leader chip(s) — ties all get the highlight,
  // nobody is highlighted while the max is still 0.
  const visibleStages = BREAKDOWN_ROWS.map((r) => r.key);
  const leadersByStage = {};
  for (const key of visibleStages) {
    leadersByStage[key] = Math.max(...rows.map((p) => p.breakdown[key] || 0));
  }

  root.innerHTML = `
    ${heroHTML(liveStripHTML(matches))}
    ${podiumHTML(rows, hasResults)}
    <section class="lb-board">
      <div class="lb-board-head">
        <h3>Full table</h3>
      </div>
      <div class="lb-table-wrap">
        <table class="lb-table">
          <thead>
            <tr>
              <th class="lb-col-rank">#</th>
              <th class="lb-col-name">Player</th>
              <th class="lb-col-chips">Stage points</th>
              <th class="lb-col-pts"><span class="lb-pts-star" aria-hidden="true">★</span> Pts</th>
              <th class="lb-col-acc" title="Correct picks / decided picks so far">Acc</th>
              <th class="lb-col-max" title="Most points still mathematically reachable (current + viable picks)">Max possible</th>
              <th class="lb-col-champ">Champion</th>
              <th class="lb-col-tb">Tiebreaker</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((p) => rowHTML(p, myNameLower, visibleStages, leadersByStage, hasResults)).join('')}
          </tbody>
        </table>
      </div>
      <div class="lb-board-foot">${legendHTML(champStats)}</div>
    </section>
  `;
}

const STAGE_CHIP_LABEL = {
  groups: 'G', wildcards: 'WC', r32: 'R32', r16: 'R16', qf: 'QF', sf: 'SF', final: 'F',
};

function stageChipsHTML(p, visibleStages, leadersByStage) {
  const chips = visibleStages.map((key) => {
    const pts = STAGE_POINTS[key];
    const subtotal = p.breakdown[key] || 0;
    const correct = pts ? Math.round(subtotal / pts) : 0;
    const isLeader = subtotal > 0 && subtotal === leadersByStage[key];
    return `<span class="lb-stage-chip${isLeader ? ' is-stage-leader' : ''}"${
      isLeader ? ` title="Stage leader: ${STAGE_CHIP_LABEL[key]}"` : ''
    }>${STAGE_CHIP_LABEL[key]} <strong>${correct}&times;${pts}=${subtotal}</strong></span>`;
  });
  return `<div class="lb-stage-chips">${chips.join('')}</div>`;
}

function rowHTML(p, myNameLower, visibleStages, leadersByStage, hasResults) {
  // Before any result, every row is rank 1 — no leader tint, no gold badges.
  const isLeader = hasResults && p.rank === 1;
  const isMe = myNameLower && p.name.toLowerCase() === myNameLower;
  const classes = ['lb-row'];
  if (isLeader) classes.push('lb-leader');
  if (isMe) classes.push('lb-me');
  const viewHref = `./?view=${encodeURIComponent(p.id)}`;
  const champOut = !!(p.champion && p.champion.eliminated);
  const champHTML = p.champion
    ? `<span class="fi fi-${flagCode(p.champion.code)} lb-flag${champOut ? ' is-out' : ''}" aria-hidden="true"></span>
       <span class="lb-champ-name${champOut ? ' is-out' : ''}" title="${escapeHtml(p.champion.name)}">${escapeHtml(p.champion.code)}</span>
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
      <td class="lb-col-rank">${hasResults ? rankCellHTML(p.rank) : '<span class="lb-rank-num">—</span>'}</td>
      <td class="lb-col-name">
        <img class="lb-avatar" src="${avatarUrl(p.id)}" alt="" />
        <a class="lb-name-link" href="${viewHref}">${escapeHtml(p.name)}</a>${isMe ? ' <span class="lb-you-pill">you</span>' : ''}
      </td>
      <td class="lb-col-chips">${stageChipsHTML(p, visibleStages, leadersByStage)}</td>
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

const RANK_VARIANT = { 1: 'gold', 2: 'silver', 3: 'bronze' };
const RANK_LABEL = { 1: '1st place', 2: '2nd place', 3: '3rd place' };

function rankCellHTML(rank) {
  const variant = RANK_VARIANT[rank];
  if (variant) {
    return `<span class="lb-rank-badge lb-rank-badge--${variant}" title="${RANK_LABEL[rank]}" aria-label="${RANK_LABEL[rank]}">${rank}</span>`;
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

// (flagCode / escapeHtml live in src/page-utils.js)
