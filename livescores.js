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

  init();

  async function init() {
    try {
      const [teamsRes, matchesRes] = await Promise.all([
        supabase.from('teams').select('*').order('code'),
        supabase.from('matches').select('*').order('kickoff_at'),
      ]);
      if (teamsRes.error) throw teamsRes.error;
      if (matchesRes.error) throw matchesRes.error;
      const teamByCode = Object.fromEntries(teamsRes.data.map((t) => [t.code, t]));
      render(matchesRes.data, teamByCode);
    } catch (err) {
      root.innerHTML = `<div class="ls-error">Couldn't load matches. ${escapeHtml(err.message || String(err))}</div>`;
    }
  }

  function render(matches, teamByCode) {
    const matchesByStage = groupBy(matches, 'stage');
    const matchesByGroup = groupBy(matchesByStage.group || [], 'group_code');

    const liveBlockHTML = renderLiveBlock(matches, teamByCode);
    const knockoutsHTML = KNOCKOUT_STAGES
      .map((stage) => renderStageSection(stage, STAGE_LABEL[stage], matchesByStage[stage] || [], teamByCode))
      .join('');
    const groupsHTML = renderGroupStage(matchesByGroup, teamByCode);

    root.innerHTML = `
      ${liveBlockHTML}
      <section class="ls-block">
        <h3 class="ls-block-head">Knockouts</h3>
        ${knockoutsHTML}
      </section>
      ${groupsHTML}
    `;

    root.addEventListener('click', (e) => {
      const toggle = e.target.closest('.ls-toggle');
      if (!toggle) return;
      const section = toggle.closest('.ls-section');
      const expanded = section.classList.toggle('is-expanded');
      toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });
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

  function renderLiveBlock(matches, teamByCode) {
    const lives = liveMatches(matches);
    if (!lives.length) return '';
    const cards = lives.map((m) => renderLiveCard(m, teamByCode)).join('');
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

  function renderLiveCard(match, teamByCode) {
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
      </section>`;
  }

  function renderStageSection(stage, label, matches, teamByCode) {
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
          ${ordered.map((m) => matchRowHTML(m, teamByCode)).join('')}
        </div>
      </section>`;
  }

  function renderGroupStage(matchesByGroup, teamByCode) {
    const groups = Object.keys(matchesByGroup).sort();
    if (!groups.length) return '';
    const sections = groups.map((code) => {
      const matches = matchesByGroup[code].slice().sort((a, b) => new Date(a.kickoff_at) - new Date(b.kickoff_at));
      const completed = matches.filter((m) => statusFor(m) === 'final').length;
      const summary = completed === matches.length
        ? `All ${matches.length} done`
        : `${completed}/${matches.length} done`;
      return `
        <section class="ls-section ls-section--group" data-group="${code}">
          <button type="button" class="ls-toggle" aria-expanded="false">
            <span class="ls-toggle-title">Group ${code}</span>
            <span class="ls-toggle-meta">${summary}</span>
            <span class="ls-toggle-caret" aria-hidden="true">▾</span>
          </button>
          <div class="ls-section-body">
            ${matches.map((m) => matchRowHTML(m, teamByCode)).join('')}
          </div>
        </section>`;
    }).join('');
    return `
      <section class="ls-block">
        <h3 class="ls-block-head">Group stage</h3>
        ${sections}
      </section>`;
  }

  function matchRowHTML(match, teamByCode) {
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
    return d.toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
    });
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
