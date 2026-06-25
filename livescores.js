// ABOUTME: Renders the schedule + live results page from the Supabase matches table.
// ABOUTME: Scores, winners, and knockout matchups come from the results-sync pipeline.

(() => {
  const root = document.getElementById('livescores-root');
  if (!root) return;
  const summaryRoot = document.getElementById('livescores-summary');

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
  const ESPN_SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';
  const ESPN_EVENT_LIMIT = 200;
  const ESPN_NAME_TO_CODE = {
    'Mexico': 'MEX',
    'South Africa': 'RSA',
    'South Korea': 'KOR', 'Korea Republic': 'KOR',
    'Czech Republic': 'CZE', 'Czechia': 'CZE',
    'Canada': 'CAN',
    'Bosnia and Herzegovina': 'BIH', 'Bosnia & Herzegovina': 'BIH', 'Bosnia-Herzegovina': 'BIH',
    'Qatar': 'QAT',
    'Switzerland': 'SUI',
    'Brazil': 'BRA',
    'Morocco': 'MAR',
    'Haiti': 'HAI',
    'Scotland': 'SCO',
    'United States': 'USA', 'USA': 'USA',
    'Paraguay': 'PAR',
    'Australia': 'AUS',
    'Turkey': 'TUR', 'Turkiye': 'TUR',
    'Germany': 'GER',
    'Curacao': 'CUW',
    'Ivory Coast': 'CIV', "Cote d'Ivoire": 'CIV',
    'Ecuador': 'ECU',
    'Netherlands': 'NED',
    'Japan': 'JPN',
    'Sweden': 'SWE',
    'Tunisia': 'TUN',
    'Belgium': 'BEL',
    'Egypt': 'EGY',
    'Iran': 'IRN', 'IR Iran': 'IRN',
    'New Zealand': 'NZL',
    'Spain': 'ESP',
    'Cape Verde': 'CPV', 'Cabo Verde': 'CPV',
    'Saudi Arabia': 'KSA',
    'Uruguay': 'URU',
    'France': 'FRA',
    'Senegal': 'SEN',
    'Iraq': 'IRQ',
    'Norway': 'NOR',
    'Argentina': 'ARG',
    'Algeria': 'ALG',
    'Austria': 'AUT',
    'Jordan': 'JOR',
    'Portugal': 'POR',
    'DR Congo': 'COD', 'Congo DR': 'COD', 'DR Congo (Congo-Kinshasa)': 'COD',
    'Uzbekistan': 'UZB',
    'Colombia': 'COL',
    'England': 'ENG',
    'Croatia': 'CRO',
    'Ghana': 'GHA',
    'Panama': 'PAN',
  };

  // Picks are private until the lock; the per-match "Picks" panels only load
  // and render after this instant (same as app.js and the DB RLS freeze).
  const LOCK_DATE_ISO = '2026-06-11T13:00:00-06:00';
  const LIVE_REFRESH_MS = 30 * 1000;
  const LIVE_WINDOW_BEFORE_MS = 5 * 60 * 1000;
  const LIVE_WINDOW_AFTER_MS = 3 * 60 * 60 * 1000;
  let liveRefreshTimer = null;
  let liveRefreshWakeTimer = null;
  let liveRefreshInFlight = false;

  root.addEventListener('click', handleRootClick);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeGroupDetail();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && liveRefreshTimer) refreshLiveScores();
  });

  init();

  async function init({ silent = false } = {}) {
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
      queries.push(fetchEspnLiveEvents().catch(() => []));
      const results = await Promise.all(queries);
      const espnLiveEvents = results.pop();
      const [teamsRes, matchesRes, playersRes, groupRes] = results;
      if (teamsRes.error) throw teamsRes.error;
      if (matchesRes.error) throw matchesRes.error;
      const teamByCode = Object.fromEntries(teamsRes.data.map((t) => [t.code, t]));
      const matches = applyEspnLiveOverlay(matchesRes.data, espnLiveEvents);
      // Pick data is an enhancement — render the schedule even if it failed.
      let picksCtx = null;
      if (locked && playersRes && !playersRes.error && !groupRes.error) {
        picksCtx = buildPicksCtx(playersRes.data, groupRes.data, teamsRes.data);
      }
      renderTodaySummary(matches, teamByCode);
      render(matches, teamByCode, picksCtx);
      updateLivePolling(matches);
    } catch (err) {
      if (silent) {
        console.warn('Live scores refresh failed', err);
        return;
      }
      stopLivePolling();
      clearLiveWakeTimer();
      root.innerHTML = `<div class="ls-error">Couldn't load matches. ${escapeHtml(err.message || String(err))}</div>`;
    }
  }

  async function refreshLiveScores() {
    if (liveRefreshInFlight) return;
    liveRefreshInFlight = true;
    try {
      await init({ silent: true });
    } finally {
      liveRefreshInFlight = false;
    }
  }

  function updateLivePolling(matches) {
    const shouldPoll = liveMatches(matches).length > 0 || hasActiveMatchWindow(matches);
    if (shouldPoll && !liveRefreshTimer) {
      clearLiveWakeTimer();
      liveRefreshTimer = window.setInterval(refreshLiveScores, LIVE_REFRESH_MS);
    } else if (!shouldPoll && liveRefreshTimer) {
      stopLivePolling();
      scheduleNextLiveWake(matches);
    } else if (!shouldPoll) {
      scheduleNextLiveWake(matches);
    }
  }

  function stopLivePolling() {
    if (!liveRefreshTimer) return;
    window.clearInterval(liveRefreshTimer);
    liveRefreshTimer = null;
  }

  function clearLiveWakeTimer() {
    if (!liveRefreshWakeTimer) return;
    window.clearTimeout(liveRefreshWakeTimer);
    liveRefreshWakeTimer = null;
  }

  function scheduleNextLiveWake(matches) {
    clearLiveWakeTimer();
    const wakeAt = nextLiveWakeMs(matches);
    if (!wakeAt) return;
    liveRefreshWakeTimer = window.setTimeout(() => {
      liveRefreshWakeTimer = null;
      refreshLiveScores();
    }, Math.max(0, wakeAt - Date.now()));
  }

  function hasActiveMatchWindow(matches) {
    const now = Date.now();
    return matches.some((match) => {
      if (!match.kickoff_at || match.completed) return false;
      const kickoff = new Date(match.kickoff_at).getTime();
      if (!Number.isFinite(kickoff)) return false;
      return now >= kickoff - LIVE_WINDOW_BEFORE_MS && now <= kickoff + LIVE_WINDOW_AFTER_MS;
    });
  }

  function nextLiveWakeMs(matches) {
    const now = Date.now();
    const upcoming = matches
      .filter((match) => match.kickoff_at && !match.completed)
      .map((match) => new Date(match.kickoff_at).getTime() - LIVE_WINDOW_BEFORE_MS)
      .filter((wakeAt) => Number.isFinite(wakeAt) && wakeAt > now)
      .sort((a, b) => a - b);
    return upcoming[0] || null;
  }

  function utcDateStamp(value) {
    const d = new Date(value);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  }

  function liveScoreboardRange() {
    const now = new Date();
    const start = new Date(now);
    const end = new Date(now);
    start.setUTCDate(start.getUTCDate() - 1);
    end.setUTCDate(end.getUTCDate() + 1);
    return `${utcDateStamp(start)}-${utcDateStamp(end)}`;
  }

  function codeFromEspnCompetitor(competitor) {
    const abbr = String(competitor?.team?.abbreviation || '').trim().toUpperCase();
    if (abbr && FIFA_TO_ISO[abbr]) return abbr;
    const name = String(competitor?.team?.displayName || '').trim();
    return ESPN_NAME_TO_CODE[name] || null;
  }

  function normalizeEspnLiveEvent(event) {
    const comp = event?.competitions?.[0];
    const type = comp?.status?.type;
    if (!comp || type?.state !== 'in') return null;
    const home = comp.competitors?.find((c) => c.homeAway === 'home');
    const away = comp.competitors?.find((c) => c.homeAway === 'away');
    if (!home || !away) return null;
    const teamA = codeFromEspnCompetitor(home);
    const teamB = codeFromEspnCompetitor(away);
    if (!teamA || !teamB) return null;
    const scoreA = home.score == null || home.score === '' ? null : Number(home.score);
    const scoreB = away.score == null || away.score === '' ? null : Number(away.score);
    if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB)) return null;
    return {
      dateUTC: utcDateStamp(event.date),
      teamA,
      teamB,
      scoreA,
      scoreB,
      clock: type.shortDetail || type.detail || comp.status?.displayClock || 'LIVE',
    };
  }

  async function fetchEspnLiveEvents() {
    const range = liveScoreboardRange();
    const res = await fetch(`${ESPN_SCOREBOARD_URL}?dates=${range}&limit=${ESPN_EVENT_LIMIT}`);
    if (!res.ok) throw new Error(`ESPN live fetch failed: ${res.status}`);
    const data = await res.json();
    return (data.events || []).map(normalizeEspnLiveEvent).filter(Boolean);
  }

  function pairKey(a, b) {
    return [a, b].filter(Boolean).sort().join('|');
  }

  function stampToMs(stamp) {
    const y = Number(stamp.slice(0, 4));
    const m = Number(stamp.slice(4, 6)) - 1;
    const d = Number(stamp.slice(6, 8));
    return Date.UTC(y, m, d);
  }

  function nearestMatchRef(candidates, eventDateUTC) {
    if (!candidates?.length) return null;
    const evMs = stampToMs(eventDateUTC);
    return candidates.slice().sort(
      (x, y) => Math.abs(stampToMs(x.dateUTC) - evMs) - Math.abs(stampToMs(y.dateUTC) - evMs),
    )[0];
  }

  function applyEspnLiveOverlay(matches, liveEvents) {
    if (!liveEvents?.length) return matches;
    const out = matches.map((m) => ({ ...m }));
    const byId = Object.fromEntries(out.map((m) => [m.id, m]));
    const byPair = {};
    for (const match of out) {
      if (!match.team_a_code || !match.team_b_code) continue;
      const key = pairKey(match.team_a_code, match.team_b_code);
      (byPair[key] ||= []).push({ id: match.id, dateUTC: utcDateStamp(match.kickoff_at) });
    }

    for (const event of liveEvents) {
      const matchRef = nearestMatchRef(byPair[pairKey(event.teamA, event.teamB)], event.dateUTC);
      const match = matchRef ? byId[matchRef.id] : null;
      if (!match || match.completed || match.result_source === 'manual') continue;
      const flipped = event.teamA === match.team_b_code;
      match.score_a = flipped ? event.scoreB : event.scoreA;
      match.score_b = flipped ? event.scoreA : event.scoreB;
      match.live_clock = event.clock;
      match.is_espn_live_overlay = true;
    }
    return out;
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

  function renderTodaySummary(matches, teamByCode) {
    if (!summaryRoot) return;
    const todayKey = etDateKey(new Date());
    const todayMatches = matches
      .filter((m) => m.kickoff_at && etDateKey(m.kickoff_at) === todayKey)
      .sort((a, b) => new Date(a.kickoff_at) - new Date(b.kickoff_at));
    const todayCount = todayMatches.length;
    const fixtureHTML = todayMatches.map((match) => todayFixtureHTML(match, teamByCode)).join('');
    summaryRoot.innerHTML = `
      <div class="ls-summary-stat ls-summary-stat--with-fixtures">
        <div class="ls-summary-count">
          <span>Today</span>
          <strong>${todayCount}</strong>
          <small>${todayCount === 1 ? 'game' : 'games'}</small>
        </div>
        ${fixtureHTML ? `<div class="ls-today-fixtures">${fixtureHTML}</div>` : ''}
      </div>`;
  }

  function todayFixtureHTML(match, teamByCode) {
    const teamA = teamByCode[match.team_a_code];
    const teamB = teamByCode[match.team_b_code];
    return `
      <div class="ls-today-fixture">
        <span class="ls-today-side" title="${escapeHtml(teamA?.name || match.team_a_code || match.slot_a || '')}">
          ${teamChipHTML(match.team_a_code || match.slot_a, teamA)}
        </span>
        <span class="ls-today-vs">vs</span>
        <span class="ls-today-side" title="${escapeHtml(teamB?.name || match.team_b_code || match.slot_b || '')}">
          ${teamChipHTML(match.team_b_code || match.slot_b, teamB)}
        </span>
        <time>${escapeHtml(formatKickoffTime(match.kickoff_at))}</time>
      </div>`;
  }

  function teamChipHTML(code, team) {
    const label = team?.code || code || 'TBD';
    const flag = team?.code
      ? `<span class="fi fi-${flagCode(team.code)}" aria-hidden="true"></span>`
      : '';
    return `${flag}<span>${escapeHtml(label)}</span>`;
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
          <span class="ls-live-min">${escapeHtml(match.live_clock || 'LIVE')}</span>
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
    const allDone = ordered.length > 0 && completed === ordered.length;
    const summary = ordered.length
      ? `${completed}/${ordered.length} done`
      : 'No matches';
    // Same rule as the group stage: keep stages open while they're in play and
    // collapse them once every match is final. The toggle still opens them.
    const expandedClass = allDone ? '' : ' is-expanded';
    return `
      <section class="ls-section${expandedClass}" data-stage="${stage}">
        <button type="button" class="ls-toggle" aria-expanded="${allDone ? 'false' : 'true'}">
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
      const allDone = matches.length > 0 && completed === matches.length;
      const summary = allDone
        ? `All ${matches.length} done`
        : `${completed}/${matches.length} done`;
      // Fully-finished groups collapse by default so attention stays on groups
      // still in play; the toggle still opens them.
      const expandedClass = allDone ? '' : ' is-expanded';
      return `
        <section class="ls-section ls-section--group${expandedClass}" data-group="${code}">
          <button type="button" class="ls-toggle" aria-expanded="${allDone ? 'false' : 'true'}">
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
        <span class="ls-status ls-status--live"><span class="ls-pulse" aria-hidden="true"></span>${escapeHtml(match.live_clock || 'LIVE')}</span>`;
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

  function formatKickoffTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/New_York',
    });
  }

  function etDateKey(value) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(value));
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
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
