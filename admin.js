// ABOUTME: Admin results-entry page logic — per-match score/winner/completed form posting straight to Supabase.
// ABOUTME: Gated by ADMIN_CODE from config.js; remembered for the tab via sessionStorage.

(() => {
  const STORAGE_KEY = 'wcbracket.admin.unlocked';
  const STAGE_ORDER = ['group', 'r32', 'r16', 'qf', 'sf', 'third', 'final'];
  const STAGE_LABEL = {
    group: 'Group stage', r32: 'Round of 32', r16: 'Round of 16',
    qf: 'Quarterfinals', sf: 'Semifinals', third: '3rd-place match', final: 'Final',
  };

  // Admin-only display shortenings for long team names that crowd the
   // results-entry rows. Trims happen at render time only — DB values stay
   // canonical, so the picks page and leaderboard are unaffected.
  const TEAM_DISPLAY_NAME = {
    BIH: 'Bosnia',
  };
  const teamLabel = (team) => team ? (TEAM_DISPLAY_NAME[team.code] || team.name) : '';

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

  const gate = document.getElementById('admin-gate');
  const root = document.getElementById('admin-root');
  const supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

  let teamsByCode = {};
  let allMatches = [];
  let allPlayers = [];
  let listenersWired = false;

  init();

  function init() {
    if (isUnlocked()) {
      gate.hidden = true;
      loadAndRender();
    } else {
      gate.hidden = false;
      root.innerHTML = '';
    }
    const form = document.getElementById('admin-gate-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = document.getElementById('admin-code-input').value;
      if (v && v === window.ADMIN_CODE) {
        sessionStorage.setItem(STORAGE_KEY, '1');
        gate.hidden = true;
        loadAndRender();
      } else {
        document.getElementById('admin-gate-error').hidden = false;
      }
    });
  }

  function isUnlocked() {
    return sessionStorage.getItem(STORAGE_KEY) === '1';
  }

  async function loadAndRender() {
    root.innerHTML = '<div class="admin-loading">Loading&hellip;</div>';
    try {
      const [teamsRes, matchesRes, playersRes] = await Promise.all([
        supabase.from('teams').select('*').order('code'),
        supabase.from('matches').select('*').order('kickoff_at'),
        supabase.from('players').select('id, name, created_at, groups_submitted_at, bracket_submitted_at').order('created_at'),
      ]);
      if (teamsRes.error) throw teamsRes.error;
      if (matchesRes.error) throw matchesRes.error;
      if (playersRes.error) throw playersRes.error;
      teamsByCode = Object.fromEntries(teamsRes.data.map((t) => [t.code, t]));
      allMatches = matchesRes.data;
      allPlayers = playersRes.data;
      render();
    } catch (err) {
      root.innerHTML = `<div class="admin-error">Couldn't load. ${escapeHtml(err.message || String(err))}</div>`;
    }
  }

  function render() {
    const playersSection = renderPlayersSection();
    const sections = STAGE_ORDER.map((stage) => {
      const matches = allMatches.filter((m) => m.stage === stage);
      if (!matches.length) return '';
      const done = matches.filter((m) => m.completed).length;
      const rows = matches.map(rowHTML).join('');
      return `
        <section class="admin-stage">
          <header class="admin-stage-head">
            <h3>${escapeHtml(STAGE_LABEL[stage] || stage)}</h3>
            <span class="admin-stage-count">${done}/${matches.length} complete</span>
          </header>
          <div class="admin-rows">
            ${rows}
          </div>
        </section>`;
    }).join('');
    root.innerHTML = playersSection + sections;
    // render() now also runs after cascade updates; attach only once or every
    // re-render would stack another copy of each listener.
    if (!listenersWired) {
      root.addEventListener('click', onClick);
      root.addEventListener('change', onChange);
      listenersWired = true;
    }
  }

  function renderPlayersSection() {
    const rows = allPlayers.length
      ? allPlayers.map(playerRowHTML).join('')
      : '<div class="admin-empty">No players yet.</div>';
    return `
      <section class="admin-stage admin-players">
        <header class="admin-stage-head">
          <h3>Players</h3>
          <span class="admin-stage-count">${allPlayers.length} total</span>
        </header>
        <div class="admin-rows">
          ${rows}
        </div>
      </section>`;
  }

  function playerRowHTML(p) {
    const created = p.created_at ? new Date(p.created_at).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    }) : '';
    const groupsDone = !!p.groups_submitted_at;
    const bracketDone = !!p.bracket_submitted_at;
    const status = groupsDone && bracketDone ? 'Submitted'
      : groupsDone || bracketDone ? 'Partial'
      : 'Draft';
    return `
      <div class="admin-player-row" data-player-id="${escapeAttr(p.id)}">
        <div class="admin-player-meta">
          <span class="admin-player-name">${escapeHtml(p.name)}</span>
          <span class="admin-player-sub">${escapeHtml(status)} · joined ${escapeHtml(created)}</span>
        </div>
        <div class="admin-player-controls">
          <button type="button" class="btn-secondary admin-player-rename">Rename</button>
          <button type="button" class="btn-secondary admin-player-reset">Reset PIN</button>
          <button type="button" class="btn-secondary admin-player-delete">Delete</button>
          <span class="admin-row-status" aria-live="polite"></span>
        </div>
      </div>`;
  }

  function rowHTML(m) {
    const teamA = m.team_a_code ? teamsByCode[m.team_a_code] : null;
    const teamB = m.team_b_code ? teamsByCode[m.team_b_code] : null;
    const teamCell = (team, slot) => {
      if (!team) return `<span class="admin-team admin-team-placeholder">${escapeHtml(slot || '?')}</span>`;
      return `
        <span class="admin-team">
          <span class="fi fi-${flagCode(team.code)}" aria-hidden="true"></span>
          <span class="admin-team-name">${escapeHtml(teamLabel(team))}</span>
        </span>`;
    };
    const winnerOptions = [
      { v: '', label: '— winner —' },
      ...(teamA ? [{ v: teamA.code, label: teamLabel(teamA) }] : []),
      ...(teamB ? [{ v: teamB.code, label: teamLabel(teamB) }] : []),
    ];
    const winnerSelect = winnerOptions.map((o) =>
      `<option value="${escapeAttr(o.v)}" ${o.v === (m.winner_code || '') ? 'selected' : ''}>${escapeHtml(o.label)}</option>`
    ).join('');
    const completed = !!m.completed;
    const canFill = !!(teamA && teamB);
    const kickoffStr = formatKickoff(m.kickoff_at);
    const sourceStr = m.result_source ? `· ${escapeHtml(m.result_source)}` : '';

    return `
      <div class="admin-row ${completed ? 'is-completed' : ''}" data-match-id="${escapeAttr(m.id)}">
        <div class="admin-row-meta">
          <span class="admin-match-id">${escapeHtml(m.id)}</span>
          <span class="admin-kickoff">${escapeHtml(kickoffStr)}</span>
          ${sourceStr ? `<span class="admin-source">${sourceStr}</span>` : ''}
        </div>
        <div class="admin-row-match">
          ${teamCell(teamA, m.slot_a)}
          <input type="number" class="admin-score" data-field="score_a" min="0" max="30" step="1"
                 value="${m.score_a == null ? '' : m.score_a}" ${canFill ? '' : 'disabled'} aria-label="Score for ${escapeAttr(teamLabel(teamA) || m.slot_a)}" />
          <span class="admin-dash">–</span>
          <input type="number" class="admin-score" data-field="score_b" min="0" max="30" step="1"
                 value="${m.score_b == null ? '' : m.score_b}" ${canFill ? '' : 'disabled'} aria-label="Score for ${escapeAttr(teamLabel(teamB) || m.slot_b)}" />
          ${teamCell(teamB, m.slot_b)}
        </div>
        <div class="admin-row-controls">
          <select class="admin-winner" data-field="winner_code" ${canFill ? '' : 'disabled'}>
            ${winnerSelect}
          </select>
          <label class="admin-completed">
            <input type="checkbox" data-field="completed" ${completed ? 'checked' : ''} ${canFill ? '' : 'disabled'} />
            Final
          </label>
          <button type="button" class="btn-primary admin-save-btn" ${canFill ? '' : 'disabled'}>Save</button>
          <span class="admin-row-status" aria-live="polite"></span>
        </div>
      </div>`;
  }

  function onClick(e) {
    const saveBtn = e.target.closest('.admin-save-btn');
    if (saveBtn) { saveRow(saveBtn.closest('.admin-row')); return; }
    const renameBtn = e.target.closest('.admin-player-rename');
    if (renameBtn) { renamePlayer(renameBtn.closest('.admin-player-row')); return; }
    const deleteBtn = e.target.closest('.admin-player-delete');
    if (deleteBtn) { deletePlayer(deleteBtn.closest('.admin-player-row')); return; }
    const resetBtn = e.target.closest('.admin-player-reset');
    if (resetBtn) resetPlayerPin(resetBtn.closest('.admin-player-row'));
  }

  async function hashPin(pin, playerId) {
    const data = new TextEncoder().encode(String(pin) + String(playerId));
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function syncStoredPlayerName(playerId, name) {
    try {
      const raw = localStorage.getItem('wcbracket.player');
      const stored = raw ? JSON.parse(raw) : null;
      if (!stored || stored.id !== playerId) return;
      localStorage.setItem('wcbracket.player', JSON.stringify({ ...stored, name }));
      if (typeof window.renderUserBar === 'function') window.renderUserBar();
    } catch (_) {
      // Non-critical: the database rename succeeded even if local header sync fails.
    }
  }

  function playerErrorMessage(err) {
    const msg = err?.message || String(err);
    if (err?.code === '23505' || /duplicate key|unique/i.test(msg)) {
      return 'That name is already taken.';
    }
    return msg;
  }

  async function renamePlayer(row) {
    const playerId = row.dataset.playerId;
    const player = allPlayers.find((p) => p.id === playerId);
    if (!player) return;
    const status = row.querySelector('.admin-row-status');
    const rawName = window.prompt(`Rename "${player.name}" to:`, player.name);
    if (rawName == null) return;
    const name = rawName.trim().replace(/\s+/g, ' ');
    if (!name) return fail(status, 'Name cannot be blank.');
    if (name.length > 30) return fail(status, 'Name must be 30 characters or fewer.');
    if (name === player.name) {
      status.className = 'admin-row-status';
      status.textContent = 'No change.';
      setTimeout(() => { if (status.textContent === 'No change.') status.textContent = ''; }, 2000);
      return;
    }

    status.className = 'admin-row-status';
    status.textContent = 'Renaming...';
    try {
      const { data, error } = await supabase
        .from('players')
        .update({ name })
        .eq('id', playerId)
        .select('id, name')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('No player row updated.');
      player.name = data.name;
      const nameEl = row.querySelector('.admin-player-name');
      if (nameEl) nameEl.textContent = data.name;
      syncStoredPlayerName(playerId, data.name);
      status.classList.add('is-ok');
      status.textContent = '✓ Renamed';
      setTimeout(() => { if (status.textContent === '✓ Renamed') status.textContent = ''; }, 3000);
    } catch (err) {
      fail(status, playerErrorMessage(err));
    }
  }

  async function resetPlayerPin(row) {
    const playerId = row.dataset.playerId;
    const player = allPlayers.find((p) => p.id === playerId);
    if (!player) return;
    const status = row.querySelector('.admin-row-status');
    const newPin = window.prompt(`Reset PIN for "${player.name}" to (4 digits):`, '0000');
    if (newPin == null) return;
    if (!/^\d{4}$/.test(newPin)) {
      return fail(status, 'PIN must be 4 digits.');
    }
    status.className = 'admin-row-status';
    status.textContent = 'Resetting…';
    try {
      const pin_hash = await hashPin(newPin, playerId);
      const { error } = await supabase
        .from('players')
        .update({ pin_hash })
        .eq('id', playerId);
      if (error) throw error;
      status.classList.add('is-ok');
      status.textContent = `✓ PIN set to ${newPin}`;
      setTimeout(() => { if (status.textContent.startsWith('✓')) status.textContent = ''; }, 4000);
    } catch (err) {
      fail(status, err.message || String(err));
    }
  }

  async function deletePlayer(row) {
    const playerId = row.dataset.playerId;
    const player = allPlayers.find((p) => p.id === playerId);
    if (!player) return;
    const status = row.querySelector('.admin-row-status');
    const confirmed = window.confirm(
      `Delete "${player.name}"? This removes the player and all their picks. Cannot be undone.`
    );
    if (!confirmed) return;
    status.className = 'admin-row-status';
    status.textContent = 'Deleting…';
    try {
      // Chain .select() so PostgREST returns the deleted row(s). If RLS
      // silently filters the DELETE, data comes back as an empty array.
      const { data, error } = await supabase
        .from('players')
        .delete()
        .eq('id', playerId)
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error(
          'No row deleted. Player deletion is disabled once picks lock at first ' +
          'kickoff (it would cascade-delete their picks); use the Supabase SQL ' +
          'editor if removal is truly needed. Before lock, check that the ' +
          'players_delete_prelock policy from migration 005 exists.'
        );
      }
      allPlayers = allPlayers.filter((p) => p.id !== playerId);
      row.remove();
      const countEl = root.querySelector('.admin-players .admin-stage-count');
      if (countEl) countEl.textContent = `${allPlayers.length} total`;
    } catch (err) {
      fail(status, err.message || String(err));
    }
  }

  function onChange(e) {
    const field = e.target.dataset.field;
    if (!field) return;
    // Auto-fill winner from scores when user types both: if A > B set winner A;
    // if B > A set winner B; if equal leave whatever the user had. Knockouts
    // can't end in draws so the user still needs to choose the PK winner.
    if (field === 'score_a' || field === 'score_b') {
      const row = e.target.closest('.admin-row');
      const sa = parseInt(row.querySelector('[data-field="score_a"]').value, 10);
      const sb = parseInt(row.querySelector('[data-field="score_b"]').value, 10);
      if (Number.isFinite(sa) && Number.isFinite(sb) && sa !== sb) {
        const winnerSel = row.querySelector('[data-field="winner_code"]');
        const opts = Array.from(winnerSel.options);
        const aCode = opts[1]?.value || '';
        const bCode = opts[2]?.value || '';
        const target = sa > sb ? aCode : bCode;
        if (target && !winnerSel.value) winnerSel.value = target;
      }
    }
  }

  async function saveRow(row) {
    const matchId = row.dataset.matchId;
    const status = row.querySelector('.admin-row-status');
    status.className = 'admin-row-status';
    status.textContent = 'Saving…';

    const saField = row.querySelector('[data-field="score_a"]');
    const sbField = row.querySelector('[data-field="score_b"]');
    const winnerField = row.querySelector('[data-field="winner_code"]');
    const completedField = row.querySelector('[data-field="completed"]');

    const saRaw = saField.value;
    const sbRaw = sbField.value;
    const score_a = saRaw === '' ? null : Number(saRaw);
    const score_b = sbRaw === '' ? null : Number(sbRaw);
    let winner_code = winnerField.value || null;
    const completed = completedField.checked;

    for (const [label, val] of [['Team A', score_a], ['Team B', score_b]]) {
      if (val != null && (!Number.isInteger(val) || val < 0)) {
        return fail(status, `${label} score must be a whole number 0 or higher.`);
      }
    }

    const match = allMatches.find((m) => m.id === matchId);
    const isGroup = match?.stage === 'group';

    if (isGroup && winner_code && score_a != null && score_b != null && score_a === score_b) {
      return fail(status, 'Group draws have no winner — leave it blank.');
    }

    if (completed) {
      if (score_a == null || score_b == null) {
        return fail(status, 'Need both scores to mark final.');
      }
      if (!isGroup && score_a === score_b && !winner_code) {
        return fail(status, 'Knockout draws need a PK winner.');
      }
      // A final with a decisive score must name its winner — a completed row
      // with winner_code null scores nobody and silently stalls the cascade.
      // Derive it from the score when the select was left blank (e.g. scores
      // were prefilled by the ESPN poll, so the change-event autofill never ran).
      if (!winner_code && score_a !== score_b) {
        winner_code = score_a > score_b ? match?.team_a_code : match?.team_b_code;
        if (!winner_code) {
          return fail(status, 'Pick the winner before marking final.');
        }
        winnerField.value = winner_code;
      }
      if (winner_code && score_a !== score_b) {
        const higher = score_a > score_b ? 'a' : 'b';
        const opts = Array.from(winnerField.options);
        const expected = higher === 'a' ? opts[1]?.value : opts[2]?.value;
        if (expected && winner_code !== expected) {
          return fail(status, `Winner doesn't match the score.`);
        }
      }
    }

    try {
      const { error } = await supabase
        .from('matches')
        .update({
          score_a,
          score_b,
          winner_code,
          completed,
          result_source: 'manual',
          updated_at: new Date().toISOString(),
        })
        .eq('id', matchId);
      if (error) throw error;
      Object.assign(match, { score_a, score_b, winner_code, completed, result_source: 'manual' });
      row.classList.toggle('is-completed', completed);
      status.classList.add('is-ok');
      status.textContent = '✓ Saved';
    } catch (err) {
      return fail(status, err.message || String(err));
    }

    // Propagate teams into later rounds exactly like the ESPN sync does, so
    // manual entry alone can progress the knockout bracket (this page is the
    // fallback for when the automated poll is offline).
    try {
      const cascaded = await runCascade();
      if (cascaded > 0) {
        render(); // newly resolved knockout rows become editable
        const fresh = root.querySelector(`.admin-row[data-match-id="${matchId}"] .admin-row-status`);
        if (fresh) {
          fresh.classList.add('is-ok');
          fresh.textContent = `✓ Saved · ${cascaded} bracket slot${cascaded === 1 ? '' : 's'} updated`;
        }
      } else {
        setTimeout(() => { if (status.textContent === '✓ Saved') status.textContent = ''; }, 2500);
      }
    } catch (err) {
      fail(status, `Saved, but bracket propagation failed: ${err.message || err}`);
    }
  }

  // Same slot-resolution the sync script uses, via the shared pure modules.
  // Dynamic import keeps this classic (non-module) script working unchanged.
  async function runCascade() {
    const [{ computeCascadeWrites }, { computeGroupStandings }] = await Promise.all([
      import('./src/cascade.js'),
      import('./src/standings.js'),
    ]);
    const byGroup = {};
    for (const m of allMatches) {
      if (m.stage === 'group' && m.group_code) (byGroup[m.group_code] ||= []).push(m);
    }
    const standings = {};
    for (const [g, ms] of Object.entries(byGroup)) standings[g] = computeGroupStandings(ms);
    const writes = computeCascadeWrites(allMatches, standings);
    for (const w of writes) {
      const local = allMatches.find((m) => m.id === w.id);
      const fields = {
        team_a_code: w.team_a_code,
        team_b_code: w.team_b_code,
        updated_at: new Date().toISOString(),
      };
      // Losing a participant invalidates any result already on the row: keep
      // it and the leaderboard would still score a match whose teams are now
      // unknown — and the row would be uneditable here (no teams, no inputs).
      if ((w.team_a_code == null || w.team_b_code == null) && local?.completed) {
        Object.assign(fields, {
          score_a: null, score_b: null, winner_code: null,
          completed: false, result_source: null,
        });
      }
      const { error } = await supabase.from('matches').update(fields).eq('id', w.id);
      if (error) throw error;
      if (local) {
        const { updated_at, ...localFields } = fields;
        Object.assign(local, localFields);
      }
    }
    return writes.length;
  }

  function fail(status, msg) {
    status.classList.add('is-error');
    status.textContent = `✗ ${msg}`;
  }

  function flagCode(code) {
    return FIFA_TO_ISO[code] || String(code || '').toLowerCase();
  }

  function formatKickoff(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
    });
  }

  function escapeAttr(s) {
    return escapeHtml(s);
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
