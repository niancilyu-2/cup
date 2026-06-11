// ABOUTME: Renders the schedule + live results page from the Supabase matches table.
// ABOUTME: Scores, winners, and knockout matchups come from the results-sync pipeline.

(() => {
  const root = document.getElementById('livescores-root');
  if (!root) return;

  const supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

  // Mirror of FIFA_TO_ISO in app.js. Kept inline so this page has no module dep.
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

  const STAGE_LABEL = {
    r32: 'Round of 32', r16: 'Round of 16', qf: 'Quarterfinals',
    sf: 'Semifinals', third: '3rd-Place Match', final: 'Final',
  };
  const KNOCKOUT_STAGES = ['r32', 'r16', 'qf', 'sf', 'third', 'final'];

  // Picks are private until the lock; the per-match "Picks" panels only load
  // and render after this instant (same as app.js and the DB RLS freeze).
  const LOCK_DATE_ISO = '2026-06-11T13:00:00-06:00';

  root.addEventListener('click', handleRootClick);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeGroupDetail();
  });

  init();

  async function init() {
    try {
      const locked = new Date() >= new Date(LOCK_DATE_ISO);
      const queries = [
        supabase.from('teams').select('*').order('code'),
        supabase.from('matches').select('*').order('kickoff_at'),
      ];
      if (locked) {
        queries.push(
          supabase.from('players').select('id, name'),
          supabase.from('group_picks').select('player_id, group_code, first_code, second_code, third_code'),
        );
      }
      const [teamsRes, matchesRes, playersRes, groupRes] = await Promise.all(queries);
      if (teamsRes.error) throw teamsRes.error;
      if (matchesRes.error) throw matchesRes.error;
      const teamByCode = Object.fromEntries(teamsRes.data.map((t) => [t.code, t]));
      // Pick data is an enhancement — render the schedule even if it failed.
      let picksCtx = null;
      if (locked && playersRes && !playersRes.error && !groupRes.error) {
        picksCtx = buildPicksCtx(playersRes.data, groupRes.data, teamsRes.data);
      }
      render(matchesRes.data, teamByCode, picksCtx);
    } catch (err) {
      root.innerHTML = `<div class="ls-error">Couldn't load matches. ${escapeHtml(err.message || String(err))}</div>`;
    }
  }

  // ---------- Who picked who ----------

  function buildPicksCtx(players, groupRows, teams) {
    const nameById = Object.fromEntries(players.map((p) => [p.id, p.name]));
    const teamsByGroup = {};
    for (const t of teams) (teamsByGroup[t.group_code] ||= []).push(t.code);
    // group -> [{ name, place: { teamCode: 1..4 } }] for every complete valid
    // ranking; the 4th place is the implied leftover team.
    const groupPlacements = {};
    for (const r of groupRows) {
      const name = nameById[r.player_id];
      const members = teamsByGroup[r.group_code] || [];
      if (!name || !r.first_code || !r.second_code || !r.third_code) continue;
      const trio = [r.first_code, r.second_code, r.third_code];
      if (new Set(trio).size !== 3 || !trio.every((c) => members.includes(c))) continue;
      const fourth = members.find((c) => !trio.includes(c));
      if (!fourth) continue;
      const place = { [r.first_code]: 1, [r.second_code]: 2, [r.third_code]: 3, [fourth]: 4 };
      (groupPlacements[r.group_code] ||= []).push({ name, place });
    }
    return { groupPlacements };
  }

  const ORDINAL = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' };
  let groupDetailStore = {};

  function namesHTML(names, cap = 8) {
    if (!names.length) return '<span class="ls-picks-nobody">N/A</span>';
    const sorted = names.slice().sort((a, b) => a.localeCompare(b));
    const shown = sorted.slice(0, cap).map(escapeHtml).join(', ');
    const extra = sorted.length - cap;
    return extra > 0 ? `${shown} <span class="ls-picks-more">+${extra} more</span>` : shown;
  }

  // Group matches have no per-match picks, so the panel shows ranking
  // behavior instead: how the pool ordered these two teams. The detail sheet
  // stays group-only because knockout paths can differ across players.
  function groupPanelHTML(match, ctx) {
    const a = match.team_a_code;
    const b = match.team_b_code;
    const ranked = (ctx.groupPlacements[match.group_code] || [])
      .filter((p) => p.place[a] && p.place[b]);
    if (!ranked.length) return '<div class="ls-picks-foot">No complete group rankings yet.</div>';
    const aAbove = ranked.filter((p) => p.place[a] < p.place[b]).length;
    const pctA = Math.round((aAbove / ranked.length) * 100);
    const pctB = 100 - pctA;
    const lead = pctA >= pctB ? { code: a, pct: pctA } : { code: b, pct: pctB };
    const trail = lead.code === a ? { code: b, pct: pctB } : { code: a, pct: pctA };
    const detailId = `group-${match.id}`;

    const teamRows = (code) => {
      const byPlace = {};
      for (const p of ranked) (byPlace[p.place[code]] ||= []).push(p.name);
      return [1, 2, 3, 4].map((place) => ({
        rank: ORDINAL[place],
        names: (byPlace[place] || []).slice().sort((x, y) => x.localeCompare(y)),
      }));
    };
    groupDetailStore[detailId] = {
      title: `${a} vs ${b}`,
      split: { left: a, leftPct: pctA, right: b, rightPct: pctB },
      teams: [
        { code: a, rows: teamRows(a) },
        { code: b, rows: teamRows(b) },
      ],
    };

    return `
      <button class="ls-h2h" type="button" data-group-detail="${escapeHtml(detailId)}"
              aria-label="${lead.pct}% of the pool ranked ${escapeHtml(lead.code)} above ${escapeHtml(trail.code)}. Open per-player placements.">
        <span class="ls-h2h-stat">
          <span class="ls-h2h-copy">
            <strong>${lead.pct}%</strong> ranked ${escapeHtml(lead.code)} above ${escapeHtml(trail.code)}
          </span>
          <span class="ls-h2h-detail-pill">Details</span>
        </span>
        <span class="ls-h2h-bar" aria-hidden="true">
          <span class="ls-h2h-bar-side ls-h2h-bar-side--left" style="width: ${pctA}%"></span>
          <span class="ls-h2h-bar-side ls-h2h-bar-side--right" style="width: ${pctB}%"></span>
        </span>
        <span class="ls-h2h-caption"><span>${escapeHtml(a)} ${pctA}%</span><span>${escapeHtml(b)} ${pctB}%</span></span>
      </button>`;

  }

  function picksPanelHTML(match, ctx) {
    if (!ctx) return '';
    if (match.stage === 'group') {
      return groupPanelHTML(match, ctx);
    }
    return '';
  }

  function picksPanelBlockHTML(match, ctx) {
    const panel = picksPanelHTML(match, ctx);
    if (!panel) return '';
    return `<div class="ls-picks-panel">${panel}</div>`;
  }

  function render(matches, teamByCode, picksCtx) {
    groupDetailStore = {};
    const matchesByStage = groupBy(matches, 'stage');
    const matchesByGroup = groupBy(matchesByStage.group || [], 'group_code');

    const liveBlockHTML = renderLiveBlock(matches, teamByCode, picksCtx);
    const knockoutsHTML = KNOCKOUT_STAGES
      .map((stage) => renderStageSection(stage, STAGE_LABEL[stage], matchesByStage[stage] || [], teamByCode, picksCtx))
      .join('');
    const groupsHTML = renderGroupStage(matchesByGroup, teamByCode, picksCtx);

    root.innerHTML = `
      ${liveBlockHTML}
      <section class="ls-block">
        <h3 class="ls-block-head">Knockouts</h3>
        ${knockoutsHTML}
      </section>
      ${groupsHTML}
      ${detailSheetHTML()}
    `;
  }

  function detailSheetHTML() {
    return `
      <div class="ls-detail-sheet-overlay" id="ls-detail-sheet" aria-hidden="true">
        <section class="ls-detail-sheet" role="dialog" aria-modal="true" aria-labelledby="ls-detail-title">
          <div class="ls-detail-sheet-head">
            <div>
              <span class="ls-detail-sheet-kicker">Pool detail</span>
              <h3 class="ls-detail-sheet-title" id="ls-detail-title">Group matchup</h3>
            </div>
            <button class="ls-detail-sheet-close" type="button" aria-label="Close">x</button>
          </div>
          <div class="ls-detail-sheet-body" id="ls-detail-sheet-body"></div>
        </section>
      </div>`;
  }

  function handleRootClick(e) {
    const detailTrigger = e.target.closest('[data-group-detail]');
    if (detailTrigger && root.contains(detailTrigger)) {
      openGroupDetail(detailTrigger.dataset.groupDetail);
      return;
    }

    if (e.target.closest('.ls-detail-sheet-close') || e.target.classList.contains('ls-detail-sheet-overlay')) {
      closeGroupDetail();
      return;
    }

    const toggle = e.target.closest('.ls-toggle');
    if (!toggle || !root.contains(toggle)) return;
    const section = toggle.closest('.ls-section');
    const expanded = section.classList.toggle('is-expanded');
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  function openGroupDetail(detailId) {
    const data = groupDetailStore[detailId];
    const sheet = document.getElementById('ls-detail-sheet');
    const title = document.getElementById('ls-detail-title');
    const body = document.getElementById('ls-detail-sheet-body');
    if (!data || !sheet || !title || !body) return;
    title.textContent = data.title;
    body.innerHTML = `${supportDetailHTML(data.split)}<div class="ls-place-grid">${data.teams.map(placeCardHTML).join('')}</div>`;
    sheet.classList.add('is-open');
    sheet.setAttribute('aria-hidden', 'false');
  }

  function closeGroupDetail() {
    const sheet = document.getElementById('ls-detail-sheet');
    if (!sheet) return;
    sheet.classList.remove('is-open');
    sheet.setAttribute('aria-hidden', 'true');
  }

  function supportDetailHTML(split) {
    return `
      <div class="ls-detail-support">
        <div class="ls-support-row">
          <span>${escapeHtml(split.left)} support</span>
          <span>${escapeHtml(split.right)} support</span>
        </div>
        <div class="ls-h2h-bar" aria-hidden="true">
          <span class="ls-h2h-bar-side ls-h2h-bar-side--left" style="width: ${split.leftPct}%"></span>
          <span class="ls-h2h-bar-side ls-h2h-bar-side--right" style="width: ${split.rightPct}%"></span>
        </div>
        <div class="ls-support-caption">
          <span>${escapeHtml(split.left)} ${split.leftPct}%</span>
          <span>${escapeHtml(split.right)} ${split.rightPct}%</span>
        </div>
      </div>`;
  }

  function placeCardHTML(team) {
    return `
      <article class="ls-place-card">
        <h4><span class="fi fi-${flagCode(team.code)}" aria-hidden="true"></span>${escapeHtml(team.code)}</h4>
        ${team.rows.map((row) => `
          <div class="ls-place-row">
            <span class="ls-place-rank">${escapeHtml(row.rank)}</span>
            <span class="ls-place-names">${namesHTML(row.names, 99)}</span>
          </div>
        `).join('')}
      </article>`;
  }

  function statusFor(match) {
    if (match.completed) return 'final';
    // The sync writes in-progress scores (without completing) for live games.
    if (match.score_a != null && match.score_b != null) return 'live';
    return 'upcoming';
  }

  function liveMatches(matches) {
    return matches.filter((m) => statusFor(m) === 'live');
  }

  function renderLiveBlock(matches, teamByCode, picksCtx) {
    const lives = liveMatches(matches);
    if (!lives.length) return '';
    const cards = lives.map((m) => renderLiveCard(m, teamByCode, picksCtx)).join('');
    const countLabel = lives.length === 1 ? '1 match' : `${lives.length} matches`;
    return `
      <section class="ls-live-block">
        <header class="ls-live-block-head">
          <span class="ls-live-pulse" aria-hidden="true"></span>
          <h3 class="ls-live-block-title">Live Now</h3>
          <span class="ls-live-block-count">${countLabel}</span>
        </header>
        <div class="ls-live-block-body">${cards}</div>
      </section>`;
  }

  function renderLiveCard(match, teamByCode, picksCtx) {
    const teamA = teamByCode[match.team_a_code];
    const teamB = teamByCode[match.team_b_code];
    const sa = match.score_a ?? 0;
    const sb = match.score_b ?? 0;
    return `
      <section class="ls-live-card">
        <header class="ls-live-card-head">
          <span class="ls-live-min">LIVE</span>
          <span class="ls-live-meta">${escapeHtml(stageMetaLabel(match))} · ${escapeHtml(venueShort(match.venue))}</span>
        </header>
        <div class="ls-live-matchup">
          <div class="ls-live-team">${liveTeamHTML(teamA)}</div>
          <div class="ls-live-score">
            <span>${escapeHtml(sa)}</span>
            <span class="ls-live-dash">–</span>
            <span>${escapeHtml(sb)}</span>
          </div>
          <div class="ls-live-team ls-live-team--right">${liveTeamHTML(teamB)}</div>
        </div>
        ${picksPanelBlockHTML(match, picksCtx)}
      </section>`;
  }

  function renderStageSection(stage, label, matches, teamByCode, picksCtx) {
    const ordered = matches.slice().sort((a, b) => new Date(a.kickoff_at) - new Date(b.kickoff_at));
    const completed = ordered.filter((m) => statusFor(m) === 'final').length;
    const summary = ordered.length
      ? `${completed}/${ordered.length} done`
      : 'No matches';
    return `
      <section class="ls-section" data-stage="${stage}">
        <button type="button" class="ls-toggle" aria-expanded="false">
          <span class="ls-toggle-title">${label}</span>
          <span class="ls-toggle-meta">${summary}</span>
          <span class="ls-toggle-caret" aria-hidden="true">▾</span>
        </button>
        <div class="ls-section-body">
          ${ordered.map((m) => matchRowHTML(m, teamByCode, picksCtx)).join('')}
        </div>
      </section>`;
  }

  function renderGroupStage(matchesByGroup, teamByCode, picksCtx) {
    const groups = Object.keys(matchesByGroup).sort();
    if (!groups.length) return '';
    const sections = groups.map((code) => {
      const matches = matchesByGroup[code].slice().sort((a, b) => new Date(a.kickoff_at) - new Date(b.kickoff_at));
      const completed = matches.filter((m) => statusFor(m) === 'final').length;
      const summary = completed === matches.length
        ? `All ${matches.length} done`
        : `${completed}/${matches.length} done`;
      return `
        <section class="ls-section ls-section--group is-expanded" data-group="${code}">
          <button type="button" class="ls-toggle" aria-expanded="true">
            <span class="ls-toggle-title">Group ${code}</span>
            <span class="ls-toggle-meta">${summary}</span>
            <span class="ls-toggle-caret" aria-hidden="true">▾</span>
          </button>
          <div class="ls-section-body">
            ${matches.map((m) => matchRowHTML(m, teamByCode, picksCtx)).join('')}
          </div>
        </section>`;
    }).join('');
    return `
      <section class="ls-block">
        <h3 class="ls-block-head">Group stage</h3>
        ${sections}
      </section>`;
  }

  function matchRowHTML(match, teamByCode, picksCtx) {
    const teamACode = match.team_a_code;
    const teamBCode = match.team_b_code;
    const teamA = teamACode ? teamByCode[teamACode] : null;
    const teamB = teamBCode ? teamByCode[teamBCode] : null;
    const status = statusFor(match);
    const winnerCode = match.winner_code;
    const sa = match.score_a != null ? match.score_a : '';
    const sb = match.score_b != null ? match.score_b : '';

    const teamLine = (team, code, side) => {
      if (!team) {
        const slot = side === 'a' ? match.slot_a : match.slot_b;
        return `<span class="ls-team ls-team--placeholder">${escapeHtml(slot || '?')}</span>`;
      }
      const isWinner = winnerCode === code;
      const isLoser = winnerCode && winnerCode !== code && status === 'final';
      const cls = isWinner ? 'is-winner' : (isLoser ? 'is-loser' : '');
      return `
        <span class="ls-team ${cls}">
          <span class="fi fi-${flagCode(team.code)}" aria-hidden="true"></span>
          <span class="ls-team-name">${escapeHtml(team.name)}</span>
        </span>`;
    };

    let centerHTML;
    if (status === 'final') {
      centerHTML = `
        <span class="ls-score">${escapeHtml(sa)}<span class="ls-score-dash">–</span>${escapeHtml(sb)}</span>
        <span class="ls-status ls-status--final">FT</span>`;
    } else if (status === 'live') {
      centerHTML = `
        <span class="ls-score ls-score--live">${escapeHtml(sa)}<span class="ls-score-dash">–</span>${escapeHtml(sb)}</span>
        <span class="ls-status ls-status--live"><span class="ls-pulse" aria-hidden="true"></span>LIVE</span>`;
    } else {
      centerHTML = `<span class="ls-vs">vs</span>`;
    }

    return `
      <div class="ls-match ls-match--${status}" data-match-id="${match.id}">
        <div class="ls-match-when">${escapeHtml(formatKickoff(match.kickoff_at))}</div>
        <div class="ls-match-row">
          ${teamLine(teamA, teamACode, 'a')}
          <div class="ls-match-center">${centerHTML}</div>
          ${teamLine(teamB, teamBCode, 'b')}
        </div>
        <div class="ls-match-venue">${escapeHtml(venueShort(match.venue))}</div>
        ${picksPanelBlockHTML(match, picksCtx)}
      </div>`;
  }

  function liveTeamHTML(team) {
    if (!team) return '<span class="ls-live-team-name">TBD</span>';
    return `
      <span class="fi fi-${flagCode(team.code)}" aria-hidden="true"></span>
      <span class="ls-live-team-name">${escapeHtml(team.name)}</span>`;
  }

  function stageMetaLabel(match) {
    return match.stage === 'group'
      ? `Group ${match.group_code}`
      : (STAGE_LABEL[match.stage] || match.stage);
  }

  function flagCode(teamCode) {
    return FIFA_TO_ISO[teamCode] || teamCode.toLowerCase();
  }

  function venueShort(venue) {
    if (!venue) return '';
    const parts = venue.split(',').map((s) => s.trim());
    return parts.length > 1 ? `${parts[0]} · ${parts[1]}` : parts[0];
  }

  function formatKickoff(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
    })} ET`;
  }

  function groupBy(arr, key) {
    const out = {};
    for (const item of arr) {
      const k = item[key] || '_';
      (out[k] = out[k] || []).push(item);
    }
    return out;
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
