// ABOUTME: Pool Stats page — renders aggregate pick trends from Supabase after lock.
// ABOUTME: Pre-lock it shows a locked panel and fetches no pick data (picks are private).

import { flagCode, escapeHtml, bucketPicks, avatarUrl } from './src/page-utils.js';
import {
  championFavorites, finalMatchups, similarPickPairs, leastSimilarPickPairs,
  divisiveMatches, divisiveGroups, contrarianPicks,
} from './src/pool-stats.js';

// Same instant as app.js's lock and the DB RLS freeze (2026-06-11 19:00 UTC).
const LOCK_DATE_ISO = '2026-06-11T13:00:00-06:00';

const STAGE_LABEL = { r32: 'R32', r16: 'R16', qf: 'QF', sf: 'SF', final: 'Final' };
const DEPTH_COPY = {
  champion: { pick: 'champion', share: 'Champion share' },
  final:    { pick: 'in the final', share: 'Final share' },
  sf:       { pick: 'to the semis', share: 'SF share' },
  qf:       { pick: 'to the QF', share: 'QF share' },
};
const BAR_VARIANTS = ['', ' pulse-bar-fill--steel', ' pulse-bar-fill--orange', ' pulse-bar-fill--muted'];

const root = document.getElementById('pool-stats');
if (root) init();

function isLocked() {
  return new Date() >= new Date(LOCK_DATE_ISO);
}

async function init() {
  // Privacy gate: aggregate pick data must not be loaded — let alone shown —
  // before everyone's picks lock and become public at first kickoff.
  if (!isLocked()) {
    root.innerHTML = `
      <section class="pulse-locked-panel" aria-label="Pool stats locked">
        <div class="lb-empty">Pool stats unlock when picks lock at first kickoff on June&nbsp;11.
        Everyone&rsquo;s picks go public then &mdash; check back to see the pool&rsquo;s favorites,
        feuds, and boldest calls.</div>
      </section>`;
    return;
  }

  const supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  try {
    const [playersRes, teamsRes, groupRes, brktRes] = await Promise.all([
      supabase.from('players').select('id, name'),
      supabase.from('teams').select('code, name, group_code'),
      supabase.from('group_picks').select('player_id, group_code, first_code, second_code, third_code, third_advances'),
      supabase.from('bracket_picks').select('player_id, match_id, winner_code'),
    ]);
    for (const r of [playersRes, teamsRes, groupRes, brktRes]) {
      if (r.error) throw r.error;
      if (r.data && r.data.length >= 1000) {
        throw new Error('Pick data exceeds a single query — pool stats needs pagination.');
      }
    }

    const nameById = Object.fromEntries(playersRes.data.map((p) => [p.id, p.name]));
    const teamName = Object.fromEntries(teamsRes.data.map((t) => [t.code, t.name]));
    const teamsByGroup = {};
    for (const t of teamsRes.data) (teamsByGroup[t.group_code] ||= []).push(t.code);

    const picksByPlayer = bucketPicks(groupRes.data, brktRes.data, []);
    if (picksByPlayer.size === 0) {
      root.innerHTML = '<div class="lb-empty">Nobody entered picks — there are no pool stats to show.</div>';
      return;
    }

    const ctx = { teamName, nameById };
    root.innerHTML = `
      <section class="pulse-grid" aria-label="Pool stats">
        ${card('Champion favorites', 'Most picked winners',
          favoritesHTML(championFavorites(picksByPlayer), ctx))}
        ${card('Most common final matchup', 'Projected final pairings',
          matchupsHTML(finalMatchups(picksByPlayer), ctx))}
        ${card('Most divisive groups', 'Ranking disagreement',
          divisiveGroupsHTML(divisiveGroups(picksByPlayer, teamsByGroup), ctx))}
        ${card('Most divisive matches', 'Closest pick splits',
          divisiveMatchesHTML(divisiveMatches(picksByPlayer), ctx))}
        ${card('Contrarian picks', 'Boldest user calls',
          contrarianHTML(contrarianPicks(picksByPlayer), ctx), 'pulse-card--wide')}
        ${card('Most similar picks', 'Closest player pairs',
          similarPairsHTML(similarPickPairs(picksByPlayer, teamsByGroup, { top: 3 }), ctx))}
        ${card('Least similar picks', 'Biggest pick contrasts',
          similarPairsHTML(leastSimilarPickPairs(picksByPlayer, teamsByGroup, { top: 3 }), ctx, 'pulse-similar-row--least'))}
      </section>`;
  } catch (err) {
    root.innerHTML = `<div class="lb-error">Couldn't load pool stats. ${escapeHtml(err.message || String(err))}</div>`;
  }
}

// ---------- Shared fragments ----------

function card(title, note, bodyHTML, extraClass = '') {
  return `
    <article class="pulse-card ${extraClass}">
      <div class="pulse-card-head">
        <h3>${escapeHtml(title)}</h3>
        <span class="pulse-card-note">${escapeHtml(note)}</span>
      </div>
      ${bodyHTML}
    </article>`;
}

function emptyBody() {
  return '<div class="pulse-card-body"><span class="pulse-card-note">Not enough picks for this one.</span></div>';
}

function flagHTML(code, teamName) {
  const title = escapeHtml(teamName[code] || code);
  return `<span class="pulse-flag fi fi-${flagCode(code)}" aria-label="${title}" title="${title}"></span>`;
}

function teamHTML(code, ctx, cls = 'pulse-team') {
  return `<span class="${cls}">${flagHTML(code, ctx.teamName)} ${escapeHtml(code)}</span>`;
}

function userLinkHTML(id, ctx) {
  const name = escapeHtml(ctx.nameById[id] || 'Unknown');
  return `<a class="pulse-user-link" href="./?view=${encodeURIComponent(id)}#bracket-section" title="View ${name}'s picks read-only"><img class="pulse-user-avatar" src="${avatarUrl(id)}" alt="" />${name}</a>`;
}

const pct = (share) => `${Math.round(share * 100)}%`;

// ---------- Champion favorites ----------

function favoritesHTML(fav, ctx) {
  if (!fav.totalPickers) return emptyBody();
  const rows = fav.entries.map((e, i) => barRowHTML(
    teamHTML(e.code, ctx), e.share, BAR_VARIANTS[Math.min(i, BAR_VARIANTS.length - 1)]));
  if (fav.other) {
    rows.push(barRowHTML(
      '<span class="pulse-team"><span class="pulse-flag pulse-flag--neutral">ALL</span> Other</span>',
      fav.other.share, ' pulse-bar-fill--muted'));
  }
  return `<div class="pulse-card-body pulse-bars">${rows.join('')}</div>`;
}

function barRowHTML(labelHTML, share, variant) {
  return `
    <div class="pulse-bar-row">
      ${labelHTML}
      <span class="pulse-bar-track"><span class="pulse-bar-fill${variant}" style="width: ${Math.round(share * 100)}%"></span></span>
      <span class="pulse-percent">${pct(share)}</span>
    </div>`;
}

// ---------- Final matchups ----------

function matchupsHTML(fm, ctx) {
  if (!fm.entries.length) return emptyBody();
  const rows = fm.entries.map((e) => `
    <div class="pulse-matchup-row">
      ${teamHTML(e.a, ctx, 'pulse-matchup-team')}
      <span class="pulse-matchup-vs">vs</span>
      ${teamHTML(e.b, ctx, 'pulse-matchup-team')}
      <span class="pulse-matchup-share">${pct(e.share)}</span>
    </div>`);
  return `<div class="pulse-card-body pulse-matchup-board">${rows.join('')}</div>`;
}

// ---------- Most similar picks ----------

function similarPairsHTML(pairs, ctx, rowClass = '') {
  if (!pairs.length) return emptyBody();
  const rows = pairs.map((p) => {
    const [a, b] = p.playerIds;
    const parts = [
      p.groupCompared ? `${p.groupMatches}/${p.groupCompared} group` : '',
      p.bracketCompared ? `${p.bracketMatches}/${p.bracketCompared} bracket` : '',
    ].filter(Boolean).join(' · ');
    return `
      <div class="pulse-similar-row ${rowClass}">
        <div class="pulse-similar-topline">
          <span class="pulse-similar-users">
            ${userLinkHTML(a, ctx)}
            <span class="pulse-similar-plus">+</span>
            ${userLinkHTML(b, ctx)}
          </span>
          <span class="pulse-tag">${pct(p.share)} match</span>
        </div>
        <div class="pulse-similar-meter" aria-hidden="true">
          <span style="width: ${Math.round(p.share * 100)}%"></span>
        </div>
        <div class="pulse-similar-meta"><span>${p.matches}/${p.compared} same picks</span><span>${parts}</span></div>
      </div>`;
  });
  return `<div class="pulse-card-body pulse-similar-list">${rows.join('')}</div>`;
}

// ---------- Divisive matches ----------

function divisiveMatchesHTML(matches, ctx) {
  if (!matches.length) return emptyBody();
  const cards = matches.map((m) => {
    const [first, second] = m.options;
    const restShare = m.options.slice(2).reduce((s, o) => s + o.share, 0);
    const tag = m.options.length > 2
      ? `${Math.round(first.share * 100)} / ${Math.round(second.share * 100)} / ${Math.round(restShare * 100)}`
      : `${Math.round(first.share * 100)} / ${Math.round(second.share * 100)}`;
    const caption = [
      `<span>${escapeHtml(first.code)} ${pct(first.share)}</span>`,
      `<span>${escapeHtml(second.code)} ${pct(second.share)}</span>`,
      ...(restShare > 0 ? [`<span>Other ${pct(restShare)}</span>`] : []),
    ].join('');
    return `
      <div class="pulse-match-card">
        <div class="pulse-match-topline">
          <span class="pulse-match-title">
            <span class="pulse-match-stage">${STAGE_LABEL[m.stage] || m.stage}</span>
            ${teamHTML(first.code, ctx, 'pulse-match-team')}
            <span class="pulse-match-vs">vs</span>
            ${teamHTML(second.code, ctx, 'pulse-match-team')}
          </span>
          <span class="pulse-tag">${tag}</span>
        </div>
        <div class="pulse-split-line" style="--left: ${Math.round(first.share * 100)}%; --middle: ${m.options.length > 2 ? Math.round(second.share * 100) : 0}%"><span></span><span></span><span></span></div>
        <div class="pulse-split-caption">${caption}</div>
      </div>`;
  });
  return `<div class="pulse-card-body pulse-match-list">${cards.join('')}</div>`;
}

// ---------- Divisive groups ----------

function divisiveGroupsHTML(groups, ctx) {
  if (!groups.length) return emptyBody();
  const parts = [featuredGroupHTML(groups[0], ctx)];
  if (groups[1]) parts.push(compactGroupHTML(groups[1], ctx));
  return `<div class="pulse-card-body pulse-group-list">${parts.join('')}</div>`;
}

function featuredGroupHTML(g, ctx) {
  const race = g.topTwoRace.map((t, i) =>
    `${i ? '<span class="pulse-signal-break" aria-hidden="true"></span>' : ''}${flagHTML(t.code, ctx.teamName)} ${escapeHtml(t.code)} ${pct(t.share)}`
  ).join(' ');
  const orders = g.topOrderings.map((o, i) => `
    <div class="pulse-order-row">
      <strong>${i === 0 ? 'Most common' : 'Close second'}</strong>
      <span>${o.order.map(escapeHtml).join(' / ')}</span>
      <span>${pct(o.share)}</span>
    </div>`).join('');
  return `
    <div class="pulse-group-card pulse-group-card--featured">
      <div class="pulse-group-summary">
        <div class="pulse-group-rank-badge"><strong>Group ${escapeHtml(g.group)}</strong></div>
        <div class="pulse-group-copy">
          <div class="pulse-group-title">${g.teams.map(escapeHtml).join(' / ')}</div>
        </div>
        <span class="pulse-tag">chaos ${g.chaos}</span>
      </div>
      <div class="pulse-signal-grid">
        <div class="pulse-signal">
          <span>1st-place favorite</span>
          <strong>${flagHTML(g.firstFavorite.code, ctx.teamName)} ${escapeHtml(g.firstFavorite.code)} ${pct(g.firstFavorite.share)}</strong>
        </div>
        <div class="pulse-signal">
          <span>Top-two race</span>
          <strong>${race || '&mdash;'}</strong>
        </div>
        <div class="pulse-signal">
          <span>Wildcard wrinkle</span>
          <strong>${g.wildcard
            ? `${flagHTML(g.wildcard.code, ctx.teamName)} ${escapeHtml(g.wildcard.code)} 3rd ${pct(g.wildcard.share)}`
            : 'Nobody flagged this group'}</strong>
        </div>
      </div>
      <div class="pulse-order-board" aria-label="Most common Group ${escapeHtml(g.group)} orders">${orders}</div>
      <div class="pulse-group-caption"><span>Highest ranking disagreement</span><span>${g.uniqueOrderings} unique ordering${g.uniqueOrderings === 1 ? '' : 's'}</span></div>
    </div>`;
}

function compactGroupHTML(g, ctx) {
  const chips = [
    `<span class="pulse-group-team">${flagHTML(g.firstFavorite.code, ctx.teamName)} ${escapeHtml(g.firstFavorite.code)} 1st ${pct(g.firstFavorite.share)}</span>`,
    ...g.topTwoRace.map((t) =>
      `<span class="pulse-group-team">${flagHTML(t.code, ctx.teamName)} ${escapeHtml(t.code)} top 2 ${pct(t.share)}</span>`),
  ].join('');
  return `
    <div class="pulse-group-card">
      <div class="pulse-group-topline">
        <span class="pulse-group-title"><span class="pulse-group-code">Group ${escapeHtml(g.group)}</span> ${g.teams.map(escapeHtml).join(' / ')}</span>
        <span class="pulse-tag">chaos ${g.chaos}</span>
      </div>
      <div class="pulse-team-strip">${chips}</div>
      <div class="pulse-group-caption"><span>Second-most contested group</span><span>${g.uniqueOrderings} unique ordering${g.uniqueOrderings === 1 ? '' : 's'}</span></div>
    </div>`;
}

// ---------- Contrarian picks ----------

function contrarianHTML(entries, ctx) {
  if (!entries.length) return emptyBody();
  const cards = entries.map((e) => {
    const copy = DEPTH_COPY[e.depth];
    const links = e.pickerIds.map((id) => userLinkHTML(id, ctx)).join('<span class="pulse-user-sep">,</span>');
    return `
      <div class="pulse-contrarian-card">
        <div>
          <div class="pulse-contrarian-topline">
            <span class="pulse-contrarian-pick">${flagHTML(e.code, ctx.teamName)} ${escapeHtml(e.code)} ${copy.pick}</span>
            <span class="pulse-tag">${e.count} picker${e.count === 1 ? '' : 's'}</span>
          </div>
          <div class="pulse-contrarian-meta"><span>${links}</span><span>${copy.share}: ${pct(e.share)}</span></div>
        </div>
      </div>`;
  });
  return `<div class="pulse-card-body pulse-contrarian-list">${cards.join('')}</div>`;
}
