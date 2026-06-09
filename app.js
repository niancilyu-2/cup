// ABOUTME: Core application logic for WC 2026 bracket pick'em.
// ABOUTME: Handles self-signup, picks, lock logic, stage flow, tiebreaker, and bracket rendering.

import { lookupAssignment } from './src/wildcards.js';
import { buildTournamentResults } from './src/results.js';

// Single-phase model: everything (groups + bracket + tiebreaker) is editable
// until the first WC kickoff on June 11.
const LOCK_DATE_ISO = '2026-06-11T13:00:00-06:00'; // Mexico vs South Africa
const STORAGE_KEY_PLAYER = 'wcbracket.player';
const STORAGE_KEY_COLLAPSED = 'wcbracket.collapsed'; // JSON: { groups: bool, wildcards: bool }
const FINAL_MATCH_ID = 'M104';

const supabase = window.supabase.createClient(
  window.SUPABASE_URL,
  window.SUPABASE_ANON_KEY,
);

// Two-tier pick state:
//   draft = working copy edited by clicks/auto-pick; never written to DB until Save/Submit.
//   saved = last snapshot persisted to DB.
// isDirty() compares the two; nav guards and Save button rely on the diff.
// Each group pick has { first, second, third, advances } where `advances` flags
// the group's 3rd team as one of the eight R32 wildcards.
function blankPicks() {
  return { groups: {}, bracket: {}, tiebreaker: null };
}

const state = {
  player: null,
  // When set, the page is in read-only "view another player's picks" mode.
  // `picks` holds the viewed player's snapshot; `state.player` still holds the
  // current user so the header bar / nav identity stays correct.
  viewedPlayer: null,
  groups: [],
  teams: [],
  matches: [],
  teamsByGroup: {},
  teamsByCode: {},
  picks: {
    draft: blankPicks(),
    saved: blankPicks(),
  },
};

// Latches so each stage-complete transition triggers its auto-advance only
// once. Re-seeded after init and after clear so returning users with full
// picks don't get scrolled or popped a modal on page load.
const stageProgress = { groups: false, wildcards: false, bracket: false };
let tiebreakerPromptShown = false;

// FIFA 3-letter code → ISO 3166-1 alpha-2 (used by lipis/flag-icons).
// gb-eng/gb-sct are valid library subregion codes.
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

function flagHTML(teamCode) {
  const iso = FIFA_TO_ISO[teamCode];
  return iso ? `<span class="fi fi-${iso}"></span>` : '';
}

function isLocked() {
  return new Date() >= new Date(LOCK_DATE_ISO);
}

function isViewing() {
  return !!state.viewedPlayer;
}

// Privacy gate: pre-lock, another player's picks are hidden.
// Lifts automatically when the tournament locks at first kickoff.
function isPicksHidden() {
  return isViewing() && !isLocked();
}

function isSubmitted() {
  return !!state.player?.groups_submitted_at && !!state.player?.bracket_submitted_at;
}

// Edits are disabled when locked, when the player has submitted (until Edit),
// or when viewing another player's picks in read-only mode.
function isEditingDisabled() {
  return isLocked() || isSubmitted() || isViewing();
}

function isDirty() {
  if (isViewing()) return false;
  return JSON.stringify(state.picks.draft) !== JSON.stringify(state.picks.saved);
}

function hasResults() {
  return !!state.matches?.some((m) => m.completed);
}

function groupOutcomeFor(groupCode) {
  return state.results?.groupOutcomes?.[groupCode] || null;
}

// The eight advancing 3rd-place teams are only known once every group is done,
// so wildcard correctness can't be shown until then.
function allGroupsDecided() {
  return Object.keys(state.results?.groupOutcomes || {}).length === 12;
}

function pickMarkHTML(correct) {
  return correct
    ? '<span class="pick-mark is-correct" aria-label="Correct">✓</span>'
    : '<span class="pick-mark is-wrong" aria-label="Wrong">✗</span>';
}

function dirtyCount() {
  let n = 0;
  const draftGroups = state.picks.draft.groups || {};
  const savedGroups = state.picks.saved.groups || {};
  const groupCodes = new Set([...Object.keys(draftGroups), ...Object.keys(savedGroups)]);
  for (const code of groupCodes) {
    const d = draftGroups[code] || { first: null, second: null, third: null, advances: false };
    const s = savedGroups[code] || { first: null, second: null, third: null, advances: false };
    if (d.first !== s.first || d.second !== s.second || d.third !== s.third || !!d.advances !== !!s.advances) n++;
  }
  const draftBracket = state.picks.draft.bracket || {};
  const savedBracket = state.picks.saved.bracket || {};
  const matchIds = new Set([...Object.keys(draftBracket), ...Object.keys(savedBracket)]);
  for (const id of matchIds) {
    if ((draftBracket[id] || null) !== (savedBracket[id] || null)) n++;
  }
  if ((state.picks.draft.tiebreaker ?? null) !== (state.picks.saved.tiebreaker ?? null)) n++;
  return n;
}

function snapshot(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function getStoredPlayer() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PLAYER);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && parsed.id) ? parsed : null;
  } catch {
    return null;
  }
}

function setStoredPlayer(player) {
  localStorage.setItem(STORAGE_KEY_PLAYER, JSON.stringify(player));
}

function clearStoredPlayer() {
  localStorage.removeItem(STORAGE_KEY_PLAYER);
}

// Trust-based PIN: SHA-256 of (pin || player_id::text). The player_id acts as a
// per-row salt so identical PINs hash to different values. Matches the
// `encode(digest('NNNN' || id::text, 'sha256'), 'hex')` shape used by the
// pgcrypto backfill in the migration SQL.
async function hashPin(pin, playerId) {
  const data = new TextEncoder().encode(String(pin) + String(playerId));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function isValidPin(pin) {
  return typeof pin === 'string' && /^\d{4}$/.test(pin);
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const escAttr = escHtml;

// Deterministic auto-avatar from the player id (stable across renames).
function avatarUrl(id) {
  return `https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(id)}`;
}

// ---------- Player picker (signup + switch) ----------

async function loadPlayers() {
  const { data, error } = await supabase
    .from('players')
    .select('id, name, groups_submitted_at, bracket_submitted_at')
    .order('name');
  if (error) {
    console.error('Failed to load players', error);
    return [];
  }
  return data;
}

function showPlayerPicker({ current = null } = {}) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    // When already signed in, the picker can be dismissed to stay logged in.
    const closeHTML = current
      ? '<button type="button" class="modal-close" id="picker-close" aria-label="Close">✕</button>'
      : '';

    const renderPickerList = (players) => {
      root.innerHTML = `
        <div class="modal-overlay">
          <div class="modal">
            ${closeHTML}
            <h2>Login</h2>
            ${
              players.length
                ? `<p>Pick yourself from the list, or add a new player.</p>
                   <ul class="player-list">
                     ${players
                       .map(
                         (p) => `
                       <li class="player-row">
                         <button type="button" class="player-pick" data-id="${p.id}" data-name="${escAttr(p.name)}">
                           <img class="picker-avatar" src="${avatarUrl(p.id)}" alt="" />
                           <span class="player-pick-name">${escHtml(p.name)}</span>
                           ${(p.groups_submitted_at && p.bracket_submitted_at) ? '<span class="player-submitted" title="Submitted a complete bracket" aria-label="Submitted">✓</span>' : ''}
                         </button>
                         <button type="button" class="player-edit" data-id="${p.id}" data-name="${escAttr(p.name)}" title="Rename" aria-label="Rename ${escAttr(p.name)}">rename</button>
                       </li>`,
                       )
                       .join('')}
                   </ul>
                   <hr class="modal-divider" />`
                : `<p>No players yet. Add yourself to get started.</p>`
            }
            <button type="button" class="link-button" id="add-new-player">+ New player</button>
          </div>
        </div>
      `;
      root.querySelectorAll('.player-pick').forEach((btn) => {
        btn.addEventListener('click', () => {
          const player = { id: btn.dataset.id, name: btn.dataset.name };
          renderPinPrompt(player);
        });
      });
      root.querySelectorAll('.player-edit').forEach((btn) => {
        btn.addEventListener('click', () => {
          const player = { id: btn.dataset.id, name: btn.dataset.name };
          renderRenameForm(player);
        });
      });
      document.getElementById('add-new-player').addEventListener('click', renderNewForm);
      if (current) {
        const dismiss = () => { root.innerHTML = ''; resolve(current); };
        document.getElementById('picker-close')?.addEventListener('click', dismiss);
        root.querySelector('.modal-overlay')?.addEventListener('click', (e) => {
          if (e.target === e.currentTarget) dismiss();
        });
      }
    };

    const renderRenameForm = (player) => {
      root.innerHTML = `
        <div class="modal-overlay">
          <div class="modal">
            <h2>Rename ${escHtml(player.name)}</h2>
            <p>Enter a new display name and the 4-digit PIN to confirm.</p>
            <form id="rename-form">
              <input id="rename-name" type="text" maxlength="30" value="${escAttr(player.name)}" required autofocus />
              <input id="rename-pin" type="password" inputmode="numeric" pattern="\\d{4}" maxlength="4" autocomplete="off" placeholder="4-digit PIN" required />
              <button type="submit" class="btn-primary">Save</button>
              <p id="rename-error" class="error" hidden></p>
            </form>
            <button type="button" class="link-button" id="rename-back">← back to list</button>
          </div>
        </div>
      `;
      const form = document.getElementById('rename-form');
      const errorEl = document.getElementById('rename-error');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorEl.hidden = true;
        const name = document.getElementById('rename-name').value.trim();
        const pin = document.getElementById('rename-pin').value.trim();
        if (!name) { errorEl.textContent = 'Enter a name.'; errorEl.hidden = false; return; }
        if (!isValidPin(pin)) { errorEl.textContent = 'PIN must be 4 digits.'; errorEl.hidden = false; return; }
        if (name === player.name) { renderPickerList(await loadPlayers()); return; }
        const { data, error } = await supabase
          .from('players')
          .select('pin_hash')
          .eq('id', player.id)
          .single();
        if (error || !data) { errorEl.textContent = "Couldn't verify PIN. Try again."; errorEl.hidden = false; return; }
        const provided = await hashPin(pin, player.id);
        if (provided !== data.pin_hash) {
          errorEl.textContent = 'Wrong PIN.';
          errorEl.hidden = false;
          document.getElementById('rename-pin').select();
          return;
        }
        const { error: upErr } = await supabase
          .from('players')
          .update({ name })
          .eq('id', player.id);
        if (upErr) {
          errorEl.textContent = upErr.code === '23505'
            ? `"${name}" is already taken. Try another.`
            : `Couldn't save: ${upErr.message}`;
          errorEl.hidden = false;
          return;
        }
        const stored = getStoredPlayer();
        if (stored && stored.id === player.id) setStoredPlayer({ ...stored, name });
        renderPickerList(await loadPlayers());
      });
      document.getElementById('rename-back').addEventListener('click', async () => {
        renderPickerList(await loadPlayers());
      });
    };

    const renderPinPrompt = (player) => {
      root.innerHTML = `
        <div class="modal-overlay">
          <div class="modal">
            <h2>Enter PIN for ${player.name}</h2>
            <p>4-digit PIN. Ask the admin to reset it if you've forgotten.</p>
            <form id="pin-form">
              <input id="pin-input" type="password" inputmode="numeric" pattern="\\d{4}" maxlength="4" autocomplete="off" placeholder="••••" required autofocus />
              <button type="submit" class="btn-primary">Continue</button>
              <p id="pin-error" class="error" hidden></p>
            </form>
            <button type="button" class="link-button" id="pin-back">← back to list</button>
          </div>
        </div>
      `;
      const form = document.getElementById('pin-form');
      const errorEl = document.getElementById('pin-error');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorEl.hidden = true;
        const pin = document.getElementById('pin-input').value.trim();
        if (!isValidPin(pin)) {
          errorEl.textContent = 'PIN must be 4 digits.';
          errorEl.hidden = false;
          return;
        }
        const { data, error } = await supabase
          .from('players')
          .select('pin_hash')
          .eq('id', player.id)
          .single();
        if (error || !data) {
          errorEl.textContent = "Couldn't check PIN. Try again.";
          errorEl.hidden = false;
          return;
        }
        const provided = await hashPin(pin, player.id);
        if (provided !== data.pin_hash) {
          errorEl.textContent = 'Wrong PIN.';
          errorEl.hidden = false;
          document.getElementById('pin-input').select();
          return;
        }
        setStoredPlayer(player);
        root.innerHTML = '';
        resolve(player);
      });
      document.getElementById('pin-back').addEventListener('click', async () => {
        renderPickerList(await loadPlayers());
      });
    };

    const renderNewForm = () => {
      root.innerHTML = `
        <div class="modal-overlay">
          <div class="modal">
            <h2>New player</h2>
            <p>Pick a display name and a 4-digit PIN. The PIN gates anyone else from switching into your account.</p>
            <form id="signup-form">
              <input id="signup-name" type="text" maxlength="30" placeholder="Your name" required autofocus />
              <input id="signup-pin" type="password" inputmode="numeric" pattern="\\d{4}" maxlength="4" autocomplete="off" placeholder="4-digit PIN" required />
              <button type="submit" class="btn-primary">Enter</button>
              <p id="signup-error" class="error" hidden></p>
            </form>
            <button type="button" class="link-button" id="back-to-list">← back to list</button>
          </div>
        </div>
      `;
      const form = document.getElementById('signup-form');
      const errorEl = document.getElementById('signup-error');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorEl.hidden = true;
        const name = document.getElementById('signup-name').value.trim();
        const pin = document.getElementById('signup-pin').value.trim();
        if (!name) return;
        if (!isValidPin(pin)) {
          errorEl.textContent = 'PIN must be 4 digits.';
          errorEl.hidden = false;
          return;
        }
        // Two-step insert so the PIN hash can be salted with the player's UUID:
        // insert with a placeholder hash, then UPDATE with the real one.
        const { data: inserted, error: insertErr } = await supabase
          .from('players')
          .insert({ name, pin_hash: 'pending' })
          .select()
          .single();
        if (insertErr) {
          errorEl.textContent =
            insertErr.code === '23505'
              ? `"${name}" is already taken. Try another name.`
              : `Couldn't add you: ${insertErr.message}`;
          errorEl.hidden = false;
          return;
        }
        const pin_hash = await hashPin(pin, inserted.id);
        const { error: updateErr } = await supabase
          .from('players')
          .update({ pin_hash })
          .eq('id', inserted.id);
        if (updateErr) {
          errorEl.textContent = `Saved your name but couldn't save the PIN: ${updateErr.message}`;
          errorEl.hidden = false;
          return;
        }
        setStoredPlayer({ id: inserted.id, name: inserted.name });
        root.innerHTML = '';
        resolve(inserted);
      });
      document.getElementById('back-to-list').addEventListener('click', async () => {
        renderPickerList(await loadPlayers());
      });
    };

    loadPlayers().then(renderPickerList);
  });
}

// ---------- Data loading ----------

async function loadReferenceData() {
  const [{ data: groups }, { data: teams }, { data: matches }] = await Promise.all([
    supabase.from('groups').select('*').order('code'),
    supabase.from('teams').select('*').order('code'),
    supabase.from('matches').select('*').order('id'),
  ]);
  state.groups = groups;
  state.teams = teams;
  state.matches = matches;
  state.results = buildTournamentResults(matches);
  // Reverse map: for each match, find the downstream match that consumes its
  // winner (so we can render "→ #89" hints in the bracket).
  state.matchDestinations = {};
  for (const m of matches) {
    for (const slot of [m.slot_a, m.slot_b]) {
      if (slot && slot.startsWith('W')) {
        state.matchDestinations['M' + slot.slice(1)] = m.id;
      }
    }
  }
  state.teamsByGroup = teams.reduce((acc, t) => {
    (acc[t.group_code] ||= []).push(t);
    return acc;
  }, {});
  // Randomize each group's starting order so the default ranking carries no
  // seeding hint; players must actively rank. A saved order takes over once set.
  for (const code of Object.keys(state.teamsByGroup)) {
    state.teamsByGroup[code] = shuffled(state.teamsByGroup[code]);
  }
  state.teamsByCode = Object.fromEntries(teams.map((t) => [t.code, t]));
}

async function loadCurrentPlayer() {
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('id', state.player.id)
    .single();
  if (error) {
    console.error('Failed to refresh player', error);
    return;
  }
  state.player = { ...state.player, ...data };
  setStoredPlayer({ id: state.player.id, name: state.player.name });
  window.renderUserBar?.();
}

async function loadViewedPlayer(playerId) {
  const { data, error } = await supabase
    .from('players')
    .select('id, name, groups_submitted_at, bracket_submitted_at')
    .eq('id', playerId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

async function loadMyPicks(playerId) {
  const id = playerId || state.player.id;
  const [groupRes, brktRes, tbRes] = await Promise.all([
    supabase.from('group_picks').select('*').eq('player_id', id),
    supabase.from('bracket_picks').select('*').eq('player_id', id),
    supabase.from('tiebreaker_picks').select('*').eq('player_id', id).maybeSingle(),
  ]);
  const saved = blankPicks();
  if (!groupRes.error) {
    for (const row of groupRes.data) {
      saved.groups[row.group_code] = {
        first: row.first_code,
        second: row.second_code,
        third: row.third_code,
        advances: !!row.third_advances,
      };
    }
  }
  if (!brktRes.error) {
    for (const row of brktRes.data) {
      saved.bracket[row.match_id] = row.winner_code;
    }
  }
  if (!tbRes.error && tbRes.data) {
    saved.tiebreaker = tbRes.data.champion_avg_goals == null
      ? null
      : Number(tbRes.data.champion_avg_goals);
  }
  state.picks.saved = saved;
  state.picks.draft = snapshot(saved); // start clean
}

// ---------- Bracket helpers ----------

// FIFA's R32 pairing rules: 1A means "winner of group A", 2A means "runner-up
// of group A", '3wc' means "wildcard 3rd-place team for this slot" (resolved
// via the lookup table once the user has picked their 8 advancing thirds).
// Source: Wikipedia 2026 FIFA World Cup knockout stage.
const R32_SLOT_RULES = {
  M73: { a: '2A', b: '2B' },
  M74: { a: '1E', b: '3wc' },
  M75: { a: '1F', b: '2C' },
  M76: { a: '1C', b: '2F' },
  M77: { a: '1I', b: '3wc' },
  M78: { a: '2E', b: '2I' },
  M79: { a: '1A', b: '3wc' },
  M80: { a: '1L', b: '3wc' },
  M81: { a: '1D', b: '3wc' },
  M82: { a: '1G', b: '3wc' },
  M83: { a: '2K', b: '2L' },
  M84: { a: '1H', b: '2J' },
  M85: { a: '1B', b: '3wc' },
  M86: { a: '1J', b: '2H' },
  M87: { a: '1K', b: '3wc' },
  M88: { a: '2D', b: '2G' },
};

function advancingGroups() {
  return state.groups
    .map((g) => g.code)
    .filter((code) => state.picks.draft.groups[code]?.advances);
}

function currentWildcardAssignment() {
  const groups = advancingGroups();
  if (groups.length !== 8) return null;
  return lookupAssignment(groups);
}

function resolveR32Slot(matchId, position) {
  const rule = R32_SLOT_RULES[matchId];
  if (!rule) return null;
  const slot = position === 'a' ? rule.a : rule.b;
  if (slot === '3wc') {
    const wc = currentWildcardAssignment();
    if (!wc) return null;
    const sourceGroup = wc[matchId];
    return state.picks.draft.groups[sourceGroup]?.third || null;
  }
  // slot is like '1A' or '2B'
  const rank = slot[0];
  const group = slot[1];
  const pick = state.picks.draft.groups[group];
  if (!pick) return null;
  return rank === '1' ? pick.first : pick.second;
}

// Resolve which team is in a given match's a/b slot, reading from the draft.
function teamForSlot(matchId, position) {
  const match = state.matches.find((m) => m.id === matchId);
  if (!match) return null;
  if (match.stage === 'group') {
    return position === 'a' ? match.team_a_code : match.team_b_code;
  }
  if (match.stage === 'r32') {
    return resolveR32Slot(matchId, position);
  }
  const label = position === 'a' ? match.slot_a : match.slot_b;
  if (!label) return null;
  if (label.startsWith('W')) {
    // Only propagate a winner that is still a participant of the source match,
    // so changing an upstream group/wildcard pick doesn't leave a stale team
    // advancing downstream.
    const priorId = `M${label.slice(1)}`;
    const winner = state.picks.draft.bracket[priorId];
    if (!winner) return null;
    const a = teamForSlot(priorId, 'a');
    const b = teamForSlot(priorId, 'b');
    return (winner === a || winner === b) ? winner : null;
  }
  if (label.startsWith('L')) {
    const priorId = `M${label.slice(1)}`;
    const winner = state.picks.draft.bracket[priorId];
    if (!winner) return null;
    const a = teamForSlot(priorId, 'a');
    const b = teamForSlot(priorId, 'b');
    if (winner === a) return b;
    if (winner === b) return a;
    return null;
  }
  return null;
}

const KNOCKOUT_ROUNDS = [
  { id: 'r32',   label: 'Round of 32' },
  { id: 'r16',   label: 'Round of 16' },
  { id: 'qf',    label: 'Quarterfinals' },
  { id: 'sf',    label: 'Semifinals' },
  { id: 'final', label: 'Final' },
];

// ---------- Stage progression (auto-scroll + tiebreaker prompt) ----------

function isGroupsComplete() {
  return state.groups.length > 0 && state.groups.every((g) => hasGroupPick(g.code));
}

function isWildcardsComplete() {
  return isGroupsComplete() && advancingGroups().length === 8;
}

// state.matches includes the 72 group-stage matches; bracket picks only cover
// the 32 knockout matches (R32 + R16 + QF + SF + Final + 3rd). Use this helper
// anywhere "the bracket" is being counted or iterated.
function bracketMatches() {
  return state.matches.filter((m) => m.stage !== 'group');
}

function isBracketComplete() {
  const ko = bracketMatches();
  if (!isWildcardsComplete() || !ko.length) return false;
  // A pick counts only if it is still a participant of its match; an upstream
  // change can leave a stale pick that no longer belongs.
  return ko.every((m) => {
    const pick = state.picks.draft.bracket[m.id];
    return pick && (pick === teamForSlot(m.id, 'a') || pick === teamForSlot(m.id, 'b'));
  });
}

function scrollToSection(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function seedStageProgress() {
  stageProgress.groups = isGroupsComplete();
  stageProgress.wildcards = isWildcardsComplete();
  stageProgress.bracket = isBracketComplete();
  tiebreakerPromptShown = state.picks.draft.tiebreaker != null;
}

// Called after every user-initiated pick mutation. Each stage's auto-scroll
// fires only on the false→true transition; rolling back lets it fire again.
function maybeAdvanceStage() {
  const groups = isGroupsComplete();
  const wildcards = isWildcardsComplete();
  const bracket = isBracketComplete();

  if (groups && !stageProgress.groups) {
    stageProgress.groups = true;
    scrollToSection('wildcards-section');
  } else if (!groups) {
    stageProgress.groups = false;
  }

  if (wildcards && !stageProgress.wildcards) {
    stageProgress.wildcards = true;
    scrollToSection('bracket-section');
  } else if (!wildcards) {
    stageProgress.wildcards = false;
  }

  if (bracket && !stageProgress.bracket) {
    stageProgress.bracket = true;
    if (!tiebreakerPromptShown && state.picks.draft.tiebreaker == null && !isEditingDisabled()) {
      tiebreakerPromptShown = true;
      showTiebreakerModal();
    }
  } else if (!bracket) {
    stageProgress.bracket = false;
  }
}

function showTiebreakerModal() {
  const root = document.getElementById('modal-root');
  if (!root) return;
  const champCode = predictedChampionCode();
  const champ = champCode ? state.teamsByCode[champCode] : null;
  const currentVal = state.picks.draft.tiebreaker ?? '';
  root.innerHTML = `
    <div class="modal-overlay">
      <div class="modal">
        <h2>One last thing &mdash; tiebreaker</h2>
        <p>Bracket's full. Predict your champion's average goals per game across the tournament.</p>
        ${champ ? `<p class="modal-champion">${flagHTML(champ.code)} <strong>${champ.name}</strong></p>` : ''}
        <input type="number" id="tb-modal-input" min="0" max="6" step="0.1"
               placeholder="e.g. 2.3" value="${currentVal}" autofocus />
        <div class="modal-actions">
          <button type="button" class="btn-primary" id="tb-modal-save">Save</button>
          <button type="button" class="btn-link" id="tb-modal-cancel">Skip for now</button>
        </div>
      </div>
    </div>`;
  const input = document.getElementById('tb-modal-input');
  // Numeric inputs ignore range-style autofocus → manually focus.
  setTimeout(() => input.focus(), 0);
  const close = () => { root.innerHTML = ''; };
  document.getElementById('tb-modal-save').addEventListener('click', () => {
    const v = input.value;
    state.picks.draft.tiebreaker = v === '' ? null : Number(v);
    close();
    renderTiebreaker();
    renderActionsBar();
    renderCountdownBanner();
    scrollToSection('tiebreaker-section');
  });
  document.getElementById('tb-modal-cancel').addEventListener('click', () => {
    close();
    scrollToSection('tiebreaker-section');
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('tb-modal-save').click();
    if (e.key === 'Escape') document.getElementById('tb-modal-cancel').click();
  });
}

// ---------- Group picks (drag-to-reorder) ----------

function emptyGroupPick() {
  return { first: null, second: null, third: null, advances: false };
}

// Returns the 4-team order rendered for this group. We always show all 4
// teams; missing slots in a partial pick get backfilled from the remaining
// teams in default order so the card never loses a row.
function rankedOrder(groupCode) {
  const all = state.teamsByGroup[groupCode] || [];
  const allCodes = all.map((t) => t.code);
  const pick = state.picks.draft.groups[groupCode];
  if (!pick || !pick.first) {
    return { codes: allCodes, isDefault: true };
  }
  const explicit = [pick.first, pick.second, pick.third];
  const used = new Set(explicit.filter(Boolean));
  const remaining = allCodes.filter((c) => !used.has(c));
  const slots = explicit.map((c) => c || remaining.shift());
  if (remaining.length) slots.push(remaining.shift());
  return { codes: slots, isDefault: false };
}

function hasGroupPick(groupCode) {
  const p = state.picks.draft.groups[groupCode];
  return !!(p && p.first && p.second && p.third);
}

// Commit a new rank order for a group. newOrder is a 4-item array of team
// codes in 1st..4th order. Preserves the wildcard `advances` flag iff the
// team at slot 3 is unchanged; otherwise the prior flag no longer matches
// any real team and is cleared.
function reorderTeamsInGroup(groupCode, newOrder) {
  if (!Array.isArray(newOrder) || newOrder.length !== 4) return;
  const prev = state.picks.draft.groups[groupCode];
  const advances = !!(prev && prev.advances && prev.third === newOrder[2]);
  state.picks.draft.groups[groupCode] = {
    first: newOrder[0],
    second: newOrder[1],
    third: newOrder[2],
    advances,
  };
}

function toggleWildcardAdvance(groupCode) {
  const current = state.picks.draft.groups[groupCode];
  if (!current?.third) return; // can't advance without a 3rd picked
  const wildcardCount = advancingGroups().length;
  if (current.advances) {
    current.advances = false;
  } else {
    if (wildcardCount >= 8) return;
    current.advances = true;
  }
  state.picks.draft.groups[groupCode] = current;
  renderWildcardsSection();
  renderBracket();
  renderCountdownBanner();
  renderActionsBar();
  maybeAdvanceStage();
}

function groupCardHTML(groupCode) {
  const { codes, isDefault } = rankedOrder(groupCode);
  const disabled = isEditingDisabled();
  const outcome = groupOutcomeFor(groupCode);
  const rows = codes
    .map((code, idx) => {
      const team = state.teamsByCode[code];
      if (!team) return '';
      const rank = idx + 1;
      const classes = ['team-row', isDefault ? 'is-default' : '']
        .filter(Boolean)
        .join(' ');
      let mark = '';
      if (outcome && (rank === 1 || rank === 2)) {
        const actual = rank === 1 ? outcome.first : outcome.second;
        mark = pickMarkHTML(code === actual);
      }
      return `
        <li class="team-item" data-team="${code}"${disabled ? ' aria-disabled="true"' : ''}>
          <div class="${classes}" title="${team.name}">
            <span class="rank-chip rank-${rank}">${rank}</span>
            ${flagHTML(code)}
            <span class="team-code">${code}</span>
            ${mark}
            <span class="drag-handle" aria-hidden="true"></span>
          </div>
        </li>`;
    })
    .join('');

  return `
    <div class="group-card" data-group-card="${groupCode}">
      <header class="group-card-header">
        <span class="group-title">
          <span class="group-code-badge">${groupCode}</span>
          <span class="group-title-text">Group ${groupCode}</span>
        </span>
        ${hasGroupPick(groupCode) ? '<span class="group-ranked-check" title="Ranked" aria-label="Ranked">&#10003;</span>' : ''}
      </header>
      <ul class="team-list">${rows}</ul>
    </div>`;
}

// Attach SortableJS to a group's row list. Re-runs on every renderGroupCard
// because replaceWith() throws away the previous Sortable instance with the
// old DOM nodes. Touch behavior: a short hold starts the drag, so vertical
// page-scroll gestures still feel normal.
function initGroupCardSortable(groupCode) {
  if (typeof Sortable === 'undefined') return;
  const list = document.querySelector(`[data-group-card="${groupCode}"] .team-list`);
  if (!list) return;
  Sortable.create(list, {
    animation: 150,
    delay: 150,
    delayOnTouchOnly: true,
    touchStartThreshold: 5,
    disabled: isEditingDisabled(),
    ghostClass: 'team-row-ghost',
    chosenClass: 'team-row-chosen',
    dragClass: 'team-row-dragging',
    onEnd(evt) {
      if (evt.oldIndex === evt.newIndex) return;
      const newOrder = Array.from(evt.to.children).map((li) => li.dataset.team);
      reorderTeamsInGroup(groupCode, newOrder);
      // Re-render the card so rank chips, stripe colors, and the "default"
      // styling reflect the new positions. Sortable already mutated the DOM
      // but render() is the source of truth for these visuals.
      renderGroupCard(groupCode);
      renderWildcardsSection();
      renderBracket();
      renderTiebreaker();
      renderCountdownBanner();
      renderActionsBar();
      maybeAdvanceStage();
    },
  });
}

function renderGroupCard(groupCode) {
  const existing = document.querySelector(`[data-group-card="${groupCode}"]`);
  if (!existing) return;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = groupCardHTML(groupCode);
  existing.replaceWith(wrapper.firstElementChild);
  initGroupCardSortable(groupCode);
  renderGroupsToolbar();
  renderSectionToggle('groups');
}

function renderGroupPicks() {
  const grid = document.getElementById('groups-grid');
  grid.innerHTML = state.groups.map((g) => groupCardHTML(g.code)).join('');
  for (const g of state.groups) initGroupCardSortable(g.code);
  renderGroupsToolbar();
  renderSectionToggle('groups');
}

// ---------- Auto-fill empty groups ----------

function shuffled(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function autoFillEmptyGroups() {
  if (isEditingDisabled()) return;
  let changed = 0;
  for (const group of state.groups) {
    if (hasGroupPick(group.code)) continue;
    const teams = state.teamsByGroup[group.code] || [];
    if (teams.length < 3) continue;
    const order = shuffled(teams);
    state.picks.draft.groups[group.code] = {
      first: order[0].code,
      second: order[1].code,
      third: order[2].code,
      advances: false,
    };
    changed++;
  }
  if (!changed) return;
  renderGroupPicks();
  renderWildcardsSection();
  renderBracket();
  renderTiebreaker();
  renderCountdownBanner();
  renderActionsBar();
  maybeAdvanceStage();
}

function groupsRankedCount() {
  return state.groups.filter((g) => hasGroupPick(g.code)).length;
}

// ---------- Wildcards picker (8 of 12 thirds advance to R32) ----------

function renderWildcardsSection() {
  const root = document.getElementById('wildcards-grid');
  if (!root) return;
  const disabled = isEditingDisabled();
  const count = advancingGroups().length;
  const groupsReady = state.groups.every((g) => hasGroupPick(g.code));

  if (!groupsReady) {
    root.innerHTML = `
      <p class="wildcards-empty">Rank all 12 groups before picking wildcards.</p>
    `;
    document.getElementById('wildcards-status').textContent = '';
    renderWildcardsToolbar();
    renderSectionToggle('wildcards');
    return;
  }

  const cards = state.groups
    .map((g) => {
      const p = state.picks.draft.groups[g.code] || emptyGroupPick();
      const team = state.teamsByCode[p.third];
      const active = !!p.advances;
      const atMax = count >= 8 && !active;
      const teamName = team ? team.name : '—';
      const outcome = groupOutcomeFor(g.code);
      const mark = (outcome && allGroupsDecided()) ? pickMarkHTML(active === !!outcome.third_advances) : '';
      return `
        <button type="button" class="wildcard-card ${active ? 'is-active' : ''}"
                data-group="${g.code}"
                ${disabled || atMax ? 'disabled' : ''}
                ${atMax ? 'title="Already 8 picked — deselect another first"' : ''}>
          <header class="wildcard-card-group">Group ${g.code} · 3rd ${mark}</header>
          <div class="wildcard-card-team">
            ${team ? flagHTML(team.code) : ''}
            <span>${teamName}</span>
          </div>
          <span class="wildcard-card-state">${active ? '✓ Advances' : 'Tap to advance'}</span>
        </button>`;
    })
    .join('');

  root.innerHTML = cards;
  document.getElementById('wildcards-status').innerHTML = `
    <strong>${count} / 8 picked</strong>
    ${count === 8 ? '<span class="wildcards-ready">✓ Bracket ready</span>' : ''}
  `;
  renderWildcardsToolbar();
  renderSectionToggle('wildcards');
}

function wireWildcards() {
  document.getElementById('wildcards-grid').addEventListener('click', (e) => {
    if (isEditingDisabled()) return;
    const btn = e.target.closest('.wildcard-card');
    if (!btn || btn.disabled) return;
    toggleWildcardAdvance(btn.dataset.group);
  });
}

// ---------- Bracket winner pick ----------

function setBracketWinner(matchId, teamCode) {
  if (state.picks.draft.bracket[matchId] === teamCode) {
    delete state.picks.draft.bracket[matchId];
  } else {
    state.picks.draft.bracket[matchId] = teamCode;
  }
}

// ---------- Persistence: flush draft to DB ----------

function groupPickEqual(a, b) {
  return a.first === b.first && a.second === b.second && a.third === b.third && !!a.advances === !!b.advances;
}

async function persistGroupPicks() {
  const saved = state.picks.saved.groups;
  const draft = state.picks.draft.groups;
  const upserts = [];
  const deletes = [];
  for (const code of Object.keys(draft)) {
    const d = draft[code];
    const s = saved[code];
    const empty = !d.first && !d.second && !d.third && !d.advances;
    if (empty) {
      if (s) deletes.push(code);
      continue;
    }
    if (!s || !groupPickEqual(s, d)) {
      upserts.push({
        player_id: state.player.id,
        group_code: code,
        first_code: d.first,
        second_code: d.second,
        third_code: d.third,
        third_advances: !!d.advances,
        updated_at: new Date().toISOString(),
      });
    }
  }
  for (const code of Object.keys(saved)) {
    if (!(code in draft)) deletes.push(code);
  }
  if (upserts.length) {
    const { error } = await supabase
      .from('group_picks')
      .upsert(upserts, { onConflict: 'player_id,group_code' });
    if (error) throw error;
  }
  if (deletes.length) {
    const { error } = await supabase
      .from('group_picks')
      .delete()
      .eq('player_id', state.player.id)
      .in('group_code', deletes);
    if (error) throw error;
  }
}

async function persistBracketPicks() {
  const saved = state.picks.saved.bracket;
  const draft = state.picks.draft.bracket;
  const upserts = [];
  const deletes = [];
  for (const matchId of Object.keys(draft)) {
    if (saved[matchId] !== draft[matchId]) {
      upserts.push({
        player_id: state.player.id,
        match_id: matchId,
        winner_code: draft[matchId],
        updated_at: new Date().toISOString(),
      });
    }
  }
  for (const matchId of Object.keys(saved)) {
    if (!(matchId in draft)) deletes.push(matchId);
  }
  if (upserts.length) {
    const { error } = await supabase
      .from('bracket_picks')
      .upsert(upserts, { onConflict: 'player_id,match_id' });
    if (error) throw error;
  }
  if (deletes.length) {
    const { error } = await supabase
      .from('bracket_picks')
      .delete()
      .eq('player_id', state.player.id)
      .in('match_id', deletes);
    if (error) throw error;
  }
}

async function persistTiebreaker() {
  const draft = state.picks.draft.tiebreaker;
  const saved = state.picks.saved.tiebreaker;
  if (draft === saved) return;
  if (draft === null || draft === undefined) {
    const { error } = await supabase
      .from('tiebreaker_picks')
      .delete()
      .eq('player_id', state.player.id);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from('tiebreaker_picks').upsert(
    {
      player_id: state.player.id,
      champion_avg_goals: draft,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'player_id' },
  );
  if (error) throw error;
}

async function saveDraft() {
  await persistGroupPicks();
  await persistBracketPicks();
  await persistTiebreaker();
  state.picks.saved = snapshot(state.picks.draft);
}

async function submitPicks() {
  await saveDraft();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('players')
    .update({ groups_submitted_at: now, bracket_submitted_at: now })
    .eq('id', state.player.id);
  if (error) throw error;
  state.player.groups_submitted_at = now;
  state.player.bracket_submitted_at = now;
}

async function unsubmitPicks() {
  const { error } = await supabase
    .from('players')
    .update({ groups_submitted_at: null, bracket_submitted_at: null })
    .eq('id', state.player.id);
  if (error) throw error;
  state.player.groups_submitted_at = null;
  state.player.bracket_submitted_at = null;
}

// ---------- Top actions bar (Auto-fill / Save / Submit / Edit) ----------

function renderActionsBar() {
  const bar = document.getElementById('actions-bar');
  if (!bar) return;
  const locked = isLocked();
  const submitted = isSubmitted();
  const dirty = isDirty();

  if (isViewing()) {
    bar.innerHTML = `
      <a class="btn-secondary" href="leaderboard.html">← Back to leaderboard</a>
    `;
    return;
  }
  if (locked) {
    bar.innerHTML = `
      <span class="status-pill submitted">Picks are locked.</span>
    `;
    return;
  }
  if (submitted) {
    bar.innerHTML = `
      <button type="button" class="btn-secondary" id="edit-picks-btn">Edit picks</button>
    `;
    return;
  }
  bar.innerHTML = `
    <span class="status-pill ${dirty ? 'dirty' : 'clean'}">
      ${dirty ? '● Unsaved changes' : '✓ All changes saved'}
    </span>
    <button type="button" class="btn-secondary" id="save-picks-btn" ${dirty ? '' : 'disabled'}>Save my picks</button>
    <button type="button" class="btn-primary" id="submit-picks-btn">Submit</button>
  `;
}

function wireActionsBar() {
  document.getElementById('actions-bar').addEventListener('click', async (e) => {
    if (e.target.id === 'save-picks-btn') {
      try {
        await saveDraft();
      } catch (err) {
        console.error('Save failed', err);
        alert('Save failed — see console.');
        return;
      }
      renderActionsBar();
      renderCountdownBanner();
      updateNavigationGuards();
    } else if (e.target.id === 'submit-picks-btn') {
      const missing = getMissingPickSections();
      if (missing.length) {
        const decision = await showIncompletePicksModal(missing);
        if (decision === 'save') {
          try {
            await saveDraft();
          } catch (err) {
            console.error('Save failed', err);
            alert('Save failed — see console.');
            return;
          }
          renderActionsBar();
          renderCountdownBanner();
          updateNavigationGuards();
        } else {
          jumpToMissingSection(missing[0]);
        }
        return;
      }
      try {
        await submitPicks();
      } catch (err) {
        console.error('Submit failed', err);
        alert('Submit failed — see console.');
        return;
      }
      renderAll();
    } else if (e.target.id === 'edit-picks-btn') {
      try {
        await unsubmitPicks();
      } catch (err) {
        console.error('Unsubmit failed', err);
        return;
      }
      renderAll();
    }
  });
}

function renderAll() {
  document.body.classList.toggle('is-picks-hidden', isPicksHidden());
  seedStageProgress();
  window.renderUserBar?.();
  renderViewBanner();
  renderCountdownBanner();
  renderGroupPicks();
  renderActionsBar();
  renderGroupsToolbar();
  renderWildcardsSection();
  renderWildcardsToolbar();
  renderBracket();
  renderBracketToolbar();
  renderTiebreaker();
  updateNavigationGuards();
}

function renderViewBanner() {
  const el = document.getElementById('view-banner');
  if (!el) return;
  if (!isViewing()) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  const name = state.viewedPlayer.name;
  const safeName = name
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const hidden = isPicksHidden();
  const placeholder = hidden ? renderPicksHiddenCard(safeName) : '';
  el.hidden = false;
  el.innerHTML = `
    <div class="view-banner-row">
      <span class="view-banner-eye" aria-hidden="true">👁</span>
      <span class="view-banner-text">
        Viewing <strong>${safeName}</strong>'s picks
        <span class="view-banner-readonly">· read only</span>
      </span>
      <a class="view-banner-back" href="leaderboard.html">← Back to leaderboard</a>
    </div>
    ${placeholder}
  `;
}

function renderPicksHiddenCard(safeName) {
  return `
    <div class="picks-hidden-card">
      <div class="picks-hidden-lock" aria-hidden="true">🔒</div>
      <h3 class="picks-hidden-title">${safeName}'s picks are hidden</h3>
      <p class="picks-hidden-body">
        Picks stay private until first kickoff on <strong>June 11, 2026</strong>.
      </p>
      <a class="picks-hidden-back" href="leaderboard.html">← Back to leaderboard</a>
    </div>
  `;
}

// ---------- Per-section toolbars (Auto pick / Clear) ----------

function renderGroupsToolbar() {
  const el = document.getElementById('groups-toolbar');
  if (!el) return;
  if (isEditingDisabled()) { el.innerHTML = ''; return; }
  const allRanked = state.groups.every((g) => hasGroupPick(g.code));
  el.innerHTML = `
    <button type="button" class="btn-secondary" id="auto-pick-groups-btn" ${allRanked ? 'disabled' : ''} title="${allRanked ? 'All groups already ranked' : 'Fill any groups you haven\'t ranked with a random order'}">🎲 Auto pick</button>
    <button type="button" class="btn-link" id="clear-picks-btn">🗑️ Clear my picks</button>
  `;
}

function renderWildcardsToolbar() {
  const el = document.getElementById('wildcards-toolbar');
  if (!el) return;
  if (isEditingDisabled()) { el.innerHTML = ''; return; }
  const groupsReady = state.groups.every((g) => hasGroupPick(g.code));
  const count = advancingGroups().length;
  const canAutoPick = groupsReady && count < 8;
  const canClear = count > 0;
  const title = !groupsReady
    ? 'Rank all 12 groups first'
    : count >= 8 ? 'All 8 wildcards picked' : `Randomly fill the remaining ${8 - count} wildcard slot${8 - count === 1 ? '' : 's'}`;
  el.innerHTML = `
    <button type="button" class="btn-secondary" id="auto-pick-wildcards-btn" ${canAutoPick ? '' : 'disabled'} title="${title}">🎲 Auto pick</button>
    <button type="button" class="btn-link" id="clear-wildcards-btn" ${canClear ? '' : 'disabled'}>🗑️ Clear my picks</button>
  `;
}

function renderBracketToolbar() {
  const el = document.getElementById('bracket-toolbar');
  if (!el) return;
  const groupsReady = state.groups.every((g) => hasGroupPick(g.code));
  const wildcardsReady = advancingGroups().length === 8;
  const canShare = groupsReady && wildcardsReady;
  const shareTitle = canShare
    ? 'Generate a symmetric bracket image to share or download'
    : !groupsReady ? 'Rank all 12 groups before sharing your bracket'
    : 'Pick 8 wildcards before sharing your bracket';
  const shareIcon = '<svg class="share-bracket-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="3.5" r="2"/><circle cx="4" cy="8" r="2"/><circle cx="12" cy="12.5" r="2"/><path d="M5.7 7.1l4.6-2.4M5.7 8.9l4.6 2.4"/></svg>';
  const shareButton = `<button type="button" class="btn-primary share-bracket-btn" id="share-bracket-btn" ${canShare ? '' : 'disabled'} title="${shareTitle}">${shareIcon}<span>Share bracket</span></button>`;
  if (isEditingDisabled()) { el.innerHTML = shareButton; return; }
  const ko = bracketMatches();
  const hasUnpicked = ko.some((m) => !state.picks.draft.bracket[m.id]);
  const hasPicked = ko.some((m) => !!state.picks.draft.bracket[m.id]);
  const canAutoPick = groupsReady && wildcardsReady && hasUnpicked;
  const title = !groupsReady
    ? 'Rank all 12 groups first'
    : !wildcardsReady ? 'Pick 8 wildcards first'
    : !hasUnpicked ? 'All matches have a winner'
    : 'Randomly pick a winner for every empty match';
  el.innerHTML = `
    <button type="button" class="btn-secondary" id="auto-pick-bracket-btn" ${canAutoPick ? '' : 'disabled'} title="${title}">🎲 Auto pick</button>
    <button type="button" class="btn-link" id="clear-bracket-btn" ${hasPicked ? '' : 'disabled'}>🗑️ Clear my picks</button>
  `;
  if (shareButton) el.insertAdjacentHTML('beforeend', shareButton);
}

function wireSectionToolbars() {
  document.getElementById('groups-toolbar').addEventListener('click', (e) => {
    if (e.target.id === 'auto-pick-groups-btn') autoFillEmptyGroups();
    else if (e.target.id === 'clear-picks-btn') clearMyPicks();
  });
  document.getElementById('wildcards-toolbar').addEventListener('click', (e) => {
    if (e.target.id === 'auto-pick-wildcards-btn') autoPickWildcards();
    else if (e.target.id === 'clear-wildcards-btn') clearWildcardsOnly();
  });
  document.getElementById('bracket-toolbar').addEventListener('click', (e) => {
    const shareBtn = e.target.closest('#share-bracket-btn');
    if (shareBtn) { shareBracketImage(shareBtn); return; }
    if (e.target.id === 'auto-pick-bracket-btn') autoPickBracket();
    else if (e.target.id === 'clear-bracket-btn') clearBracketOnly();
  });
}

function clearMyPicks() {
  if (isEditingDisabled()) return;
  const ok = confirm('Clear ALL your picks (groups, wildcards, bracket, tiebreaker)?\n\nThis only resets your in-page draft. Your saved picks in the database stay until you click Save again.');
  if (!ok) return;
  state.picks.draft = blankPicks();
  seedStageProgress();
  renderGroupPicks();
  renderGroupsToolbar();
  renderWildcardsSection();
  renderWildcardsToolbar();
  renderBracket();
  renderBracketToolbar();
  renderTiebreaker();
  renderCountdownBanner();
  renderActionsBar();
}

function clearWildcardsOnly() {
  if (isEditingDisabled()) return;
  const count = advancingGroups().length;
  if (count === 0) return;
  const ok = confirm('Clear your wildcard picks (the 8 third-place teams)?\n\nYour group rankings stay. Bracket winner picks that depend on cleared wildcards will be dropped.');
  if (!ok) return;
  for (const code of Object.keys(state.picks.draft.groups)) {
    const p = state.picks.draft.groups[code];
    if (p) p.advances = false;
  }
  seedStageProgress();
  renderWildcardsSection();
  renderWildcardsToolbar();
  renderBracket();
  renderBracketToolbar();
  renderTiebreaker();
  renderCountdownBanner();
  renderActionsBar();
}

function clearBracketOnly() {
  if (isEditingDisabled()) return;
  const hasPicked = bracketMatches().some((m) => !!state.picks.draft.bracket[m.id]);
  if (!hasPicked) return;
  const ok = confirm('Clear all your knockout-bracket winner picks?\n\nYour group rankings and wildcards stay.');
  if (!ok) return;
  state.picks.draft.bracket = {};
  seedStageProgress();
  renderBracket();
  renderBracketToolbar();
  renderTiebreaker();
  renderCountdownBanner();
  renderActionsBar();
}

function autoPickWildcards() {
  if (isEditingDisabled()) return;
  const groupsReady = state.groups.every((g) => hasGroupPick(g.code));
  if (!groupsReady) return;
  const current = advancingGroups();
  const need = 8 - current.length;
  if (need <= 0) return;
  const candidates = state.groups
    .map((g) => g.code)
    .filter((code) => !state.picks.draft.groups[code]?.advances);
  const chosen = shuffled(candidates).slice(0, need);
  for (const code of chosen) {
    const p = state.picks.draft.groups[code];
    if (p) p.advances = true;
  }
  renderWildcardsSection();
  renderWildcardsToolbar();
  renderBracket();
  renderBracketToolbar();
  renderTiebreaker();
  renderCountdownBanner();
  renderActionsBar();
  maybeAdvanceStage();
}

function autoPickBracket() {
  if (isEditingDisabled()) return;
  const groupsReady = state.groups.every((g) => hasGroupPick(g.code));
  const wildcardsReady = advancingGroups().length === 8;
  if (!groupsReady || !wildcardsReady) return;
  // Iterate in match-id order so earlier rounds resolve first and their
  // winners populate downstream slots before we look at later matches.
  const ordered = state.matches
    .slice()
    .sort((a, b) => parseInt(a.id.slice(1), 10) - parseInt(b.id.slice(1), 10));
  let changed = 0;
  for (const m of ordered) {
    const teamA = teamForSlot(m.id, 'a');
    const teamB = teamForSlot(m.id, 'b');
    if (!teamA || !teamB) continue;
    const cur = state.picks.draft.bracket[m.id];
    if (cur === teamA || cur === teamB) continue; // already has a valid pick
    state.picks.draft.bracket[m.id] = Math.random() < 0.5 ? teamA : teamB;
    changed++;
  }
  if (!changed) return;
  renderBracket();
  renderBracketToolbar();
  renderTiebreaker();
  renderCountdownBanner();
  renderActionsBar();
  maybeAdvanceStage();
}

// ---------- Tiebreaker (champion derived from Final pick) ----------

function predictedChampionCode() {
  return state.picks.draft.bracket[FINAL_MATCH_ID] || null;
}

function renderTiebreaker() {
  const root = document.getElementById('tiebreaker');
  if (!root) return;
  const disabled = isEditingDisabled();
  const champCode = predictedChampionCode();
  const champ = champCode ? state.teamsByCode[champCode] : null;
  const value = state.picks.draft.tiebreaker ?? '';

  const championLine = champ
    ? `<div class="tiebreaker-champion">
         <strong>Your champion:</strong>
         ${flagHTML(champ.code)}
         <strong>${champ.name}</strong>
       </div>`
    : `<div class="tiebreaker-champion empty">
         Pick the Final winner in the bracket to set your champion.
       </div>`;

  root.innerHTML = `
    ${championLine}
    <label class="tiebreaker-label">
      <span>Predicted average goals per game:</span>
      <input type="number" id="tiebreaker-input" min="0" max="6" step="0.1"
             value="${value}" ${disabled ? 'disabled' : ''}
             placeholder="e.g. 2.3" />
    </label>
    <p class="tiebreaker-note">If two players tie on points, whoever's predicted average is closest to the real tournament average for the actual champion wins the tiebreaker.</p>
  `;
  document.getElementById('tiebreaker-input').addEventListener('input', (e) => {
    const v = e.target.value;
    state.picks.draft.tiebreaker = v === '' ? null : Number(v);
    renderActionsBar();
    renderCountdownBanner();
  });
}

// ---------- Navigation guards (beforeunload + internal link intercept) ----------

function shouldWarnOnLeave() {
  if (isLocked()) return false;
  if (isViewing()) return false;
  return isDirty();
}

function beforeUnloadHandler(e) {
  e.preventDefault();
  e.returnValue = '';
  return '';
}

function updateNavigationGuards() {
  window.removeEventListener('beforeunload', beforeUnloadHandler);
  if (shouldWarnOnLeave()) {
    window.addEventListener('beforeunload', beforeUnloadHandler);
  }
}

function showLeaveSiteModal() {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    root.innerHTML = `
      <div class="modal-overlay">
        <div class="modal">
          <h2>You haven't saved your progress</h2>
          <p>You have unsaved picks. Save them now, leave without saving, or stay here.</p>
          <div class="modal-actions">
            <button type="button" class="btn-primary" id="leave-save">Save &amp; continue</button>
            <button type="button" class="btn-secondary" id="leave-go">Leave without saving</button>
            <button type="button" class="btn-link" id="leave-cancel">Cancel</button>
          </div>
        </div>
      </div>
    `;
    const finish = (decision) => {
      root.innerHTML = '';
      resolve(decision);
    };
    document.getElementById('leave-save').addEventListener('click', async () => {
      try { await saveDraft(); } catch (err) { console.error(err); }
      finish('save');
    });
    document.getElementById('leave-go').addEventListener('click', () => finish('go'));
    document.getElementById('leave-cancel').addEventListener('click', () => finish('cancel'));
  });
}

function bracketPickedCount() {
  return bracketMatches().filter((m) => !!state.picks.draft.bracket[m.id]).length;
}

// Ordered top-to-bottom so the first entry is also where we scroll on "return".
function getMissingPickSections() {
  const missing = [];
  if (!isGroupsComplete()) {
    const done = groupsRankedCount();
    const total = state.groups.length || 12;
    missing.push({
      key: 'groups',
      anchorId: 'groups-section',
      label: 'Group rankings',
      detail: `${done} of ${total} groups ranked`,
    });
  }
  if (!isWildcardsComplete()) {
    const done = advancingGroups().length;
    missing.push({
      key: 'wildcards',
      anchorId: 'wildcards-section',
      label: 'Wildcards',
      detail: `${done} of 8 selected`,
    });
  }
  if (!isBracketComplete()) {
    const done = bracketPickedCount();
    const total = bracketMatches().length;
    missing.push({
      key: 'bracket',
      anchorId: 'bracket-section',
      label: 'Bracket',
      detail: `${done} of ${total} winners picked`,
    });
  }
  if (state.picks.draft.tiebreaker == null) {
    missing.push({
      key: 'tiebreaker',
      anchorId: 'tiebreaker-section',
      label: 'Tiebreaker',
      detail: 'avg goals not entered',
    });
  }
  return missing;
}

function showIncompletePicksModal(missing) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    const items = missing.map((m) => `
      <li class="incomplete-item">
        <span class="incomplete-label">${m.label}</span>
        <span class="incomplete-detail">${m.detail}</span>
      </li>`).join('');
    root.innerHTML = `
      <div class="modal-overlay">
        <div class="modal">
          <h2>Not quite ready to submit</h2>
          <p>You still have picks to finish before you can submit:</p>
          <ul class="incomplete-list">${items}</ul>
          <div class="modal-actions">
            <button type="button" class="btn-secondary" id="incomplete-save">Save current progress</button>
            <button type="button" class="btn-primary" id="incomplete-return">Return to finish picks</button>
          </div>
        </div>
      </div>`;
    const finish = (decision) => {
      root.innerHTML = '';
      resolve(decision);
    };
    document.getElementById('incomplete-save').addEventListener('click', () => finish('save'));
    document.getElementById('incomplete-return').addEventListener('click', () => finish('return'));
  });
}

function jumpToMissingSection(item) {
  if (!item) return;
  if (item.key === 'groups' || item.key === 'wildcards') {
    setSectionCollapsed(item.key, false);
    writeCollapsedPref(item.key, false);
  }
  scrollToSection(item.anchorId);
}

function wireInternalLinkGuards() {
  document.addEventListener('click', async (e) => {
    if (!shouldWarnOnLeave()) return;
    const anchor = e.target.closest('a[href]');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
    const url = new URL(href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname) return;
    e.preventDefault();
    const decision = await showLeaveSiteModal(href);
    if (decision === 'cancel') return;
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    location.href = href;
  });
}

// ---------- Bracket rendering ----------

function teamPillHTML(teamCode, opts = {}) {
  if (!teamCode) {
    return `<span class="team-pill team-pill--empty">${opts.placeholder || '— pick team —'}</span>`;
  }
  const team = state.teamsByCode[teamCode];
  if (!team) return `<span class="team-pill">${teamCode}</span>`;
  return `<span class="team-pill">${flagHTML(team.code)}<span>${team.name}</span></span>`;
}

function effectiveWinner(matchId, teamA, teamB) {
  const pick = state.picks.draft.bracket[matchId];
  if (!pick) return null;
  if (pick === teamA || pick === teamB) return pick;
  return null;
}

function formatKickoff(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });
}

function venueStadium(venue) {
  return venue ? venue.split(',')[0].trim() : '';
}

function venueCity(venue) {
  if (!venue) return '';
  const parts = venue.split(',').map((s) => s.trim());
  return parts[1] || '';
}

function resultFor(matchId) {
  const r = state.results?.matchResults?.[matchId];
  return r && r.played ? r : null;
}

function matchCellHTML(matchId) {
  const match = state.matches.find((m) => m.id === matchId);
  if (!match) return '';
  const teamA = teamForSlot(matchId, 'a');
  const teamB = teamForSlot(matchId, 'b');
  const disabled = isEditingDisabled();
  const canAdvance = !!(teamA && teamB);
  const winner = effectiveWinner(matchId, teamA, teamB);
  const dest = state.matchDestinations?.[matchId];
  const num = matchId.slice(1);
  const stadium = venueStadium(match.venue);
  const city = venueCity(match.venue);
  const result = resultFor(matchId);

  const slotHTML = (position, team) => {
    const isWinner = team && winner === team;
    let resultClass = '';
    if (result && isWinner) {
      resultClass = team === result.winner ? ' is-correct' : ' is-wrong';
    }
    const pill = teamPillHTML(team, { placeholder: '?' });
    if (!team || !canAdvance || disabled) {
      return `<div class="bracket-slot bracket-slot--readonly ${isWinner ? 'is-winner' : ''}${resultClass}">${pill}</div>`;
    }
    return `
      <button type="button" class="bracket-slot ${isWinner ? 'is-winner' : ''}${resultClass}"
              data-match="${matchId}" data-team="${team}" data-action="advance">
        ${pill}
      </button>`;
  };

  return `
    <div class="bracket-match${result ? ' is-played' : ''}" data-match-id="${matchId}">
      <div class="bracket-match-meta">
        <span class="bracket-match-num">#${num}</span>
        <span class="bracket-match-when">${formatKickoff(match.kickoff_at)}</span>
      </div>
      ${stadium ? `<div class="bracket-match-venue" title="${match.venue}">${stadium}${city ? ` &middot; ${city}` : ''}</div>` : ''}
      ${slotHTML('a', teamA)}
      ${slotHTML('b', teamB)}
      ${dest ? `<div class="bracket-feed">winner &rarr; <strong>#${dest.slice(1)}</strong></div>` : ''}
    </div>`;
}

function bracketPairOrder() {
  // Walk the bracket backward from the Final, so that within each column
  // the two matches whose winners meet in the next round are adjacent.
  // Returns { r32: [[M74,M77],...], r16: [[M89,M90],...], qf: [...], sf: [...], final: [[M104]] }.
  const out = { r32: [], r16: [], qf: [], sf: [], final: [] };
  const finalMatch = state.matches.find((m) => m.stage === 'final');
  if (!finalMatch) return out;
  out.final = [[finalMatch.id]];
  const feeds = (id) => {
    const m = state.matches.find((x) => x.id === id);
    if (!m) return [null, null];
    const fa = m.slot_a && m.slot_a.startsWith('W') ? 'M' + m.slot_a.slice(1) : null;
    const fb = m.slot_b && m.slot_b.startsWith('W') ? 'M' + m.slot_b.slice(1) : null;
    return [fa, fb];
  };
  const chain = [
    ['sf', 'final'],
    ['qf', 'sf'],
    ['r16', 'qf'],
    ['r32', 'r16'],
  ];
  for (const [stage, prev] of chain) {
    const prevOrder = out[prev].flat();
    const pairs = [];
    for (const prevId of prevOrder) {
      const [a, b] = feeds(prevId);
      if (a && b) pairs.push([a, b]);
    }
    out[stage] = pairs;
  }
  return out;
}

function matchFeedIds(matchId) {
  const match = state.matches.find((m) => m.id === matchId);
  if (!match) return [];
  return [match.slot_a, match.slot_b]
    .filter((slot) => slot && slot.startsWith('W'))
    .map((slot) => `M${slot.slice(1)}`);
}

function bracketShareFilename() {
  const name = (state.viewedPlayer?.name || state.player?.name || 'bracket')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'bracket';
  return `world-cup-2026-${name}-bracket.png`;
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not render bracket image.'));
    }, 'image/png');
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function canCopyImageBlob() {
  return !!(navigator.clipboard?.write && typeof ClipboardItem === 'function');
}

async function copyImageBlob(blob) {
  if (!canCopyImageBlob()) throw new Error('Image clipboard is not supported.');
  await navigator.clipboard.write([
    new ClipboardItem({ [blob.type || 'image/png']: blob }),
  ]);
}

function openShareDestination(destination) {
  const text = encodeURIComponent("My World Cup '26 bracket");
  const url = destination === 'whatsapp'
    ? `https://wa.me/?text=${text}`
    : 'https://www.instagram.com/';
  window.open(url, '_blank', 'noopener,noreferrer');
}

function showBracketShareFallback({ blob, filename }) {
  const root = document.getElementById('modal-root');
  if (!root) {
    downloadBlob(blob, filename);
    return;
  }
  const canCopy = canCopyImageBlob();
  root.innerHTML = `
    <div class="modal-overlay share-fallback-overlay">
      <div class="modal share-fallback-modal" role="dialog" aria-modal="true" aria-labelledby="share-fallback-title">
        <div class="share-fallback-header">
          <div>
            <span class="share-fallback-kicker">Image ready</span>
            <h2 id="share-fallback-title" class="share-fallback-title">Share bracket</h2>
          </div>
          <button class="share-fallback-close" type="button" aria-label="Close">x</button>
        </div>
        <div class="share-fallback-body">
          <div class="share-fallback-card">
            <div class="share-fallback-thumb" aria-hidden="true"></div>
            <strong>Symmetric bracket PNG</strong>
          </div>
          <div class="share-fallback-actions">
            <button type="button" class="btn-primary" id="share-download-image">Download image</button>
            <button type="button" class="btn-secondary" id="share-copy-image" ${canCopy ? '' : 'disabled'} title="${canCopy ? '' : 'Copy image is not supported in this browser'}">Copy image</button>
          </div>
          <p class="share-fallback-social-title">Open social app</p>
          <div class="share-fallback-socials">
            <button type="button" class="share-fallback-social" id="share-open-whatsapp"><span class="share-fallback-social-mark">wa</span> WhatsApp</button>
            <button type="button" class="share-fallback-social" id="share-open-instagram"><span class="share-fallback-social-mark">ig</span> Instagram</button>
          </div>
          <p class="share-fallback-status" id="share-fallback-status" aria-live="polite"></p>
        </div>
      </div>
    </div>
  `;

  let onKeyDown = null;
  const close = () => {
    if (onKeyDown) document.removeEventListener('keydown', onKeyDown);
    root.innerHTML = '';
  };
  root.querySelector('.share-fallback-close')?.addEventListener('click', close);
  root.querySelector('.share-fallback-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) close();
  });
  onKeyDown = (e) => {
    if (e.key === 'Escape') {
      close();
    }
  };
  document.addEventListener('keydown', onKeyDown);

  const status = root.querySelector('#share-fallback-status');
  root.querySelector('#share-download-image')?.addEventListener('click', () => {
    downloadBlob(blob, filename);
    if (status) status.textContent = 'Downloaded';
  });
  root.querySelector('#share-copy-image')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const oldText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Copying...';
    try {
      await copyImageBlob(blob);
      btn.textContent = 'Copied';
      if (status) status.textContent = 'Copied';
    } catch (err) {
      console.error('Failed to copy bracket image', err);
      btn.textContent = 'Copy failed';
      if (status) status.textContent = 'Copy failed';
    } finally {
      setTimeout(() => {
        btn.disabled = !canCopy;
        btn.textContent = oldText;
      }, 1400);
    }
  });
  root.querySelector('#share-open-whatsapp')?.addEventListener('click', () => openShareDestination('whatsapp'));
  root.querySelector('#share-open-instagram')?.addEventListener('click', () => openShareDestination('instagram'));
}

function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function fillRoundRect(ctx, x, y, w, h, r, fill, stroke) {
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawFittedText(ctx, text, x, y, maxWidth) {
  let out = String(text || '');
  if (ctx.measureText(out).width <= maxWidth) {
    ctx.fillText(out, x, y);
    return;
  }
  while (out.length > 4 && ctx.measureText(`${out.slice(0, -1)}...`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  ctx.fillText(`${out.slice(0, -1)}...`, x, y);
}

function drawFittedTextRight(ctx, text, x, y, maxWidth) {
  let out = String(text || '');
  if (ctx.measureText(out).width <= maxWidth) {
    ctx.fillText(out, x, y);
    return;
  }
  while (out.length > 4 && ctx.measureText(`${out.slice(0, -1)}...`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  ctx.fillText(`${out.slice(0, -1)}...`, x, y);
}

function measureTrackedText(ctx, text, tracking) {
  const chars = [...String(text || '')];
  return chars.reduce((width, char, index) => (
    width + ctx.measureText(char).width + (index < chars.length - 1 ? tracking : 0)
  ), 0);
}

function drawTrackedText(ctx, text, x, y, tracking) {
  let cursor = x;
  [...String(text || '')].forEach((char) => {
    ctx.fillText(char, cursor, y);
    cursor += ctx.measureText(char).width + tracking;
  });
  return cursor - tracking;
}

function drawExportSignature(ctx, centerX, y) {
  const nameFont = '600 14px Oswald, Inter, system-ui, sans-serif';
  const dotFont = '700 14px Oswald, Inter, system-ui, sans-serif';
  const tracking = 3;
  const gap = 9;
  const left = 'NIANCI';
  const right = 'CLAUDE';
  const dot = '\u00d7';

  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = nameFont;
  const leftWidth = measureTrackedText(ctx, left, tracking);
  const rightWidth = measureTrackedText(ctx, right, tracking);
  ctx.font = dotFont;
  const dotWidth = ctx.measureText(dot).width;
  let cursor = centerX - (leftWidth + gap + dotWidth + gap + rightWidth) / 2;

  ctx.font = nameFont;
  ctx.fillStyle = '#a6b0be';
  cursor = drawTrackedText(ctx, left, cursor, y, tracking) + gap;
  ctx.font = dotFont;
  ctx.fillStyle = '#f2c94c';
  ctx.fillText(dot, cursor, y);
  cursor += dotWidth + gap;
  ctx.font = nameFont;
  ctx.fillStyle = '#a6b0be';
  drawTrackedText(ctx, right, cursor, y, tracking);
  ctx.restore();
}

function drawExportTrophy(ctx, cx, cy, scale = 1) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.lineWidth = 1.7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const gold = ctx.createLinearGradient(0, -14, 0, 20);
  gold.addColorStop(0, '#fff1a8');
  gold.addColorStop(0.42, '#f2c94c');
  gold.addColorStop(1, '#bd7c18');

  ctx.fillStyle = 'rgba(242, 201, 76, 0.16)';
  ctx.beginPath();
  ctx.ellipse(0, 1, 24, 20, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 228, 128, 0.9)';
  ctx.fillStyle = 'rgba(242, 201, 76, 0.12)';
  ctx.beginPath();
  ctx.moveTo(-12, -5);
  ctx.bezierCurveTo(-21, -6, -21, 8, -9, 7);
  ctx.lineTo(-8, 3);
  ctx.bezierCurveTo(-15, 3, -15, -2, -11, -2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(12, -5);
  ctx.bezierCurveTo(21, -6, 21, 8, 9, 7);
  ctx.lineTo(8, 3);
  ctx.bezierCurveTo(15, 3, 15, -2, 11, -2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = gold;
  ctx.strokeStyle = '#ffe08a';
  ctx.beginPath();
  ctx.moveTo(-12, -10);
  ctx.lineTo(12, -10);
  ctx.bezierCurveTo(11, -1, 8, 6, 3, 9);
  ctx.lineTo(-3, 9);
  ctx.bezierCurveTo(-8, 6, -11, -1, -12, -10);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-5, -7);
  ctx.bezierCurveTo(-4, -2, -3, 2, 0, 5);
  ctx.stroke();

  ctx.fillStyle = gold;
  roundRectPath(ctx, -3, 8, 6, 8, 2);
  ctx.fill();
  ctx.strokeStyle = '#ffe08a';
  ctx.stroke();
  roundRectPath(ctx, -10, 15, 20, 4, 2);
  ctx.fill();
  ctx.stroke();
  roundRectPath(ctx, -14, 20, 28, 4, 2);
  ctx.fillStyle = '#d99a24';
  ctx.fill();

  ctx.fillStyle = '#fff1a8';
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const angle = -Math.PI / 2 + i * Math.PI / 5;
    const radius = i % 2 === 0 ? 3.2 : 1.4;
    const px = Math.cos(angle) * radius;
    const py = -17 + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function exportFlagBadge(teamCode) {
  const iso = FIFA_TO_ISO[teamCode];
  if (!iso) return teamCode ? teamCode.slice(0, 2) : '';
  return iso
    .replace('gb-eng', 'ENG')
    .replace('gb-sct', 'SCO')
    .replace('-', '')
    .slice(0, 3)
    .toUpperCase();
}

function collectExportTeamCodes(matchIds) {
  const out = new Set();
  matchIds.forEach((id) => {
    const teamA = teamForSlot(id, 'a');
    const teamB = teamForSlot(id, 'b');
    if (teamA) out.add(teamA);
    if (teamB) out.add(teamB);
  });
  return out;
}

async function loadExportFlagImages(teamCodes) {
  const images = new Map();
  const urls = [];
  await Promise.all([...teamCodes].map(async (teamCode) => {
    const iso = FIFA_TO_ISO[teamCode];
    if (!iso) return;
    try {
      const response = await fetch(`https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.2.3/flags/4x3/${iso}.svg`, { mode: 'cors' });
      if (!response.ok) return;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = url;
      });
      images.set(teamCode, img);
    } catch (_) {
      // Flag images are nice-to-have; the export still works with text badges.
    }
  }));
  return {
    images,
    cleanup: () => urls.forEach((url) => URL.revokeObjectURL(url)),
  };
}

function drawExportFlag(ctx, teamCode, flagImages, x, y, w, h) {
  const image = flagImages?.get(teamCode);
  if (image) {
    ctx.save();
    roundRectPath(ctx, x, y, w, h, 3);
    ctx.clip();
    ctx.drawImage(image, x, y, w, h);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 1;
    roundRectPath(ctx, x, y, w, h, 3);
    ctx.stroke();
    return;
  }
  fillRoundRect(ctx, x, y, w, h, 3, 'rgba(159, 184, 214, 0.16)', 'rgba(159, 184, 214, 0.28)');
  ctx.font = '800 8px "JetBrains Mono", monospace';
  ctx.fillStyle = '#d8e3ef';
  ctx.textAlign = 'center';
  ctx.fillText(exportFlagBadge(teamCode), x + w / 2, y + h / 2 + 3);
  ctx.textAlign = 'left';
}

function drawExportMatch(ctx, matchId, rect, opts = {}) {
  const match = state.matches.find((m) => m.id === matchId);
  if (!match) return;
  const teamA = teamForSlot(matchId, 'a');
  const teamB = teamForSlot(matchId, 'b');
  const winner = effectiveWinner(matchId, teamA, teamB);
  const { x, y, w, h } = rect;
  const isFinal = opts.isFinal;
  const isThird = opts.isThird;
  const flagImages = opts.flagImages;
  const winnerAccent = '#41b56a';
  const bg = isFinal ? 'rgba(21, 26, 34, 0.98)' : 'rgba(21, 26, 34, 0.92)';
  const headerH = isFinal ? 30 : 24;
  const rowGap = isFinal ? 4 : 3;
  const rowTop = y + headerH + (isFinal ? 10 : 5);
  const rowH = (h - headerH - rowGap - (isFinal ? 18 : 8)) / 2;
  const teamFontSize = isFinal ? 24 : 16;

  fillRoundRect(ctx, x, y, w, h, 10, bg, isFinal ? 'rgba(242, 201, 76, 0.72)' : 'rgba(159, 184, 214, 0.28)');
  ctx.fillStyle = isFinal ? 'rgba(242, 201, 76, 0.12)' : 'rgba(159, 184, 214, 0.08)';
  ctx.fillRect(x + 1, y + 1, w - 2, headerH - 2);

  ctx.font = `600 ${isFinal ? 15 : 12}px "JetBrains Mono", monospace`;
  ctx.fillStyle = isFinal ? '#f2c94c' : '#9fb8d6';
  ctx.fillText(`#${matchId.slice(1)}`, x + 12, y + (isFinal ? 20 : 16));

  const drawSlot = (team, rowIndex) => {
    const selected = winner && winner === team;
    const rowY = rowTop + rowIndex * (rowH + rowGap);
    const textBaseline = rowY + rowH / 2 + teamFontSize * 0.36;
    if (selected) {
      ctx.save();
      roundRectPath(ctx, x + 6, rowY, w - 12, rowH, isFinal ? 6 : 4);
      ctx.clip();
      ctx.fillStyle = 'rgba(65, 181, 106, 0.22)';
      ctx.fillRect(x + 6, rowY, w - 12, rowH);
      ctx.fillStyle = winnerAccent;
      ctx.fillRect(x + 6, rowY, 5, rowH);
      ctx.restore();
    }
    const hasTeam = !!team;
    const flagW = isFinal ? 28 : 24;
    const flagH = isFinal ? 20 : 18;
    const flagX = x + 18;
    const flagY = rowY + (rowH - flagH) / 2;
    if (hasTeam) {
      drawExportFlag(ctx, team, flagImages, flagX, flagY, flagW, flagH);
    }
    const textX = hasTeam ? x + (isFinal ? 58 : 50) : x + 18;
    const textWidth = w - (hasTeam ? (isFinal ? 78 : 66) : 36);
    ctx.font = `800 ${teamFontSize}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = selected ? '#ffffff' : '#eef3f8';
    drawFittedText(ctx, team || 'TBD', textX, textBaseline, textWidth);
  };

  drawSlot(teamA, 0);
  drawSlot(teamB, 1);
}

function bracketShareLayout() {
  const order = bracketPairOrder();
  const splitSide = (start, end) => ({
    r32: order.r32.slice(start, end).flat(),
    r16: order.r16.slice(start / 2, end / 2).flat(),
    qf: (order.qf[start / 4] || []).slice(),
    sf: [order.sf[0]?.[start / 4]].filter(Boolean),
  });
  return {
    left: splitSide(0, 4),
    right: splitSide(4, 8),
    final: state.matches.find((m) => m.stage === 'final')?.id || FINAL_MATCH_ID,
    third: state.matches.find((m) => m.stage === 'third')?.id || null,
  };
}

async function renderBracketShareCanvas() {
  if (document.fonts?.ready) {
    try { await document.fonts.ready; } catch (_) {}
  }
  const canvas = document.createElement('canvas');
  canvas.width = 2000;
  canvas.height = 1200;
  const ctx = canvas.getContext('2d');
  const layout = bracketShareLayout();
  const rects = {};
  const matchW = 190;
  const matchH = 78;
  const finalW = 300;
  const finalH = 122;
  const leftX = { r32: 30, r16: 225, qf: 420, sf: 615 };
  const rightX = {
    r32: canvas.width - 30 - matchW,
    r16: canvas.width - 225 - matchW,
    qf: canvas.width - 420 - matchW,
    sf: canvas.width - 615 - matchW,
  };
  const r32Y = Array.from({ length: 8 }, (_, i) => 240 + i * 105);
  const midpoints = (arr) => arr.reduce((out, _, i) => {
    if (i % 2 === 0) out.push((arr[i] + arr[i + 1]) / 2);
    return out;
  }, []);
  const y = {
    r32: r32Y,
    r16: midpoints(r32Y),
    qf: midpoints(midpoints(r32Y)),
    sf: midpoints(midpoints(midpoints(r32Y))),
  };

  const placeSide = (side, xMap) => {
    for (const round of ['r32', 'r16', 'qf', 'sf']) {
      side[round].forEach((id, i) => {
        rects[id] = { x: xMap[round], y: y[round][i] - matchH / 2, w: matchW, h: matchH };
      });
    }
  };
  placeSide(layout.left, leftX);
  placeSide(layout.right, rightX);
  rects[layout.final] = {
    x: (canvas.width - finalW) / 2,
    y: y.sf[0] - finalH / 2,
    w: finalW,
    h: finalH,
  };
  if (layout.third) {
    rects[layout.third] = {
      x: (canvas.width - finalW) / 2,
      y: y.sf[0] + 178,
      w: finalW,
      h: 90,
    };
  }
  const flagAssets = await loadExportFlagImages(collectExportTeamCodes(Object.keys(rects)));

  ctx.fillStyle = '#080b10';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
  bg.addColorStop(0, '#172131');
  bg.addColorStop(0.34, '#0b1018');
  bg.addColorStop(1, '#080b10');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const topWash = ctx.createLinearGradient(0, 0, 0, 190);
  topWash.addColorStop(0, 'rgba(10, 15, 23, 0.76)');
  topWash.addColorStop(0.7, 'rgba(10, 15, 23, 0.28)');
  topWash.addColorStop(1, 'rgba(10, 15, 23, 0)');
  ctx.fillStyle = topWash;
  ctx.fillRect(0, 0, canvas.width, 190);
  ctx.strokeStyle = 'rgba(159, 184, 214, 0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 126);
  ctx.lineTo(canvas.width, 126);
  ctx.stroke();

  const playerName = state.viewedPlayer?.name || state.player?.name || 'My bracket';

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = '#f3f4f0';
  ctx.font = '600 35px Oswald, Inter, system-ui, sans-serif';
  drawTrackedText(ctx, 'KNOCKOUT BRACKET', 60, 80, 1.1);
  ctx.restore();

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.46)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = '#ff9f43';
  ctx.font = '600 27px Oswald, Inter, system-ui, sans-serif';
  ctx.textAlign = 'right';
  drawFittedTextRight(ctx, playerName, canvas.width - 60, 80, 520);
  ctx.restore();
  ctx.textAlign = 'left';

  const roundLabels = [
    ['ROUND OF 32', leftX.r32, matchW], ['ROUND OF 16', leftX.r16, matchW], ['QF', leftX.qf, matchW], ['SF', leftX.sf, matchW],
    ['FINAL', rects[layout.final].x, finalW],
    ['SF', rightX.sf, matchW], ['QF', rightX.qf, matchW], ['ROUND OF 16', rightX.r16, matchW], ['ROUND OF 32', rightX.r32, matchW],
  ];
  ctx.font = '700 14px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#9fb8d6';
  ctx.textAlign = 'center';
  for (const [label, xPos, labelW] of roundLabels) {
    ctx.fillText(label, xPos + labelW / 2, 188);
  }
  ctx.textAlign = 'left';

  function drawConnector(fromId, toId) {
    const a = rects[fromId];
    const b = rects[toId];
    if (!a || !b) return;
    const leftSide = a.x < b.x;
    const startX = leftSide ? a.x + a.w : a.x;
    const endX = leftSide ? b.x : b.x + b.w;
    const startY = a.y + a.h / 2;
    const endY = b.y + b.h / 2;
    const midX = (startX + endX) / 2;
    ctx.strokeStyle = 'rgba(159, 184, 214, 0.34)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(midX, startY);
    ctx.lineTo(midX, endY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
  }

  for (const side of [layout.left, layout.right]) {
    [...side.r16, ...side.qf, ...side.sf].forEach((id) => {
      matchFeedIds(id).forEach((feedId) => drawConnector(feedId, id));
    });
  }
  matchFeedIds(layout.final).forEach((feedId) => drawConnector(feedId, layout.final));

  Object.entries(rects).forEach(([id, rect]) => {
    drawExportMatch(ctx, id, rect, { isFinal: id === layout.final, isThird: id === layout.third, flagImages: flagAssets.images });
  });
  const finalRect = rects[layout.final];
  if (finalRect) {
    drawExportTrophy(ctx, finalRect.x + finalRect.w / 2, finalRect.y - 28, 1.08);
  }
  flagAssets.cleanup();

  if (layout.third) {
    ctx.fillStyle = '#9fb8d6';
    ctx.font = '700 15px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('3RD PLACE', canvas.width / 2, rects[layout.third].y - 18);
    ctx.textAlign = 'left';
  }

  ctx.fillStyle = 'rgba(159, 184, 214, 0.18)';
  ctx.fillRect(0, canvas.height - 70, canvas.width, 1);
  drawExportSignature(ctx, canvas.width / 2, canvas.height - 32);
  ctx.textAlign = 'left';

  return canvas;
}

async function shareBracketImage(button) {
  const oldHTML = button.innerHTML;
  button.disabled = true;
  button.textContent = 'Rendering...';
  try {
    const canvas = await renderBracketShareCanvas();
    const blob = await canvasBlob(canvas);
    const filename = bracketShareFilename();
    const title = "World Cup '26 bracket";
    const text = 'My World Cup bracket picks';
    const canFileShare = typeof File === 'function' && navigator.canShare && navigator.share;
    if (canFileShare) {
      const file = new File([blob], filename, { type: 'image/png' });
      const data = { files: [file], title, text };
      if (navigator.canShare(data)) {
        try {
          await navigator.share(data);
          button.textContent = 'Shared';
        } catch (err) {
          if (err?.name === 'AbortError') {
            button.innerHTML = oldHTML;
            return;
          }
          showBracketShareFallback({ blob, filename });
          button.textContent = 'Ready';
          return;
        }
        if (button.textContent === 'Shared') return;
      }
    }
    showBracketShareFallback({ blob, filename });
    button.textContent = 'Ready';
  } catch (err) {
    console.error('Failed to share bracket image', err);
    alert('Could not generate the bracket image. Please try again.');
    button.innerHTML = oldHTML;
  } finally {
    setTimeout(() => {
      button.disabled = false;
      button.innerHTML = oldHTML;
    }, 1800);
  }
}

function bracketColumnHTML(round) {
  const pairs = state.bracketPairs?.[round.id] || [];
  // Final has one match; wrap it in a solo .bracket-pair so it gets the same
  // flex: 1 + space-around centering as every other column's pairs. That puts
  // M104 at body 50%, which is where the SF pair midpoint also lands.
  const isFinal = round.id === 'final';
  const thirdMatch = isFinal ? state.matches.find((m) => m.stage === 'third') : null;
  const thirdPlaceHTML = thirdMatch ? `
        <div class="bracket-third-place">
          <h3>3rd Place</h3>
          ${matchCellHTML(thirdMatch.id)}
        </div>` : '';
  return `
    <div class="bracket-column bracket-column--${round.id}">
      <header class="bracket-column-header">${round.label}</header>
      <div class="bracket-column-body">
        ${pairs.map((pair) => `
          <div class="bracket-pair${isFinal ? ' bracket-pair--solo' : ''}">
            ${pair.map((id) => matchCellHTML(id)).join('')}
          </div>
        `).join('')}
      </div>
      ${thirdPlaceHTML}
    </div>`;
}

function renderBracket() {
  const root = document.getElementById('bracket');
  const groupsReady = state.groups.every((g) => hasGroupPick(g.code));
  const wildcardsReady = advancingGroups().length === 8;

  if (!groupsReady || !wildcardsReady) {
    const missing = [];
    if (!groupsReady) missing.push('rank all 12 groups');
    if (!wildcardsReady) missing.push('pick 8 wildcard 3rd-place teams to advance');
    root.innerHTML = `
      <div class="bracket-locked-notice">
        <strong>The bracket auto-fills once your picks are complete.</strong>
        <p>To populate R32, you still need to ${missing.join(' and ')}.</p>
      </div>`;
    renderBracketToolbar();
    return;
  }

  state.bracketPairs = bracketPairOrder();
  root.innerHTML = `
    <div class="bracket-board">
      <div class="bracket-grid">
        ${KNOCKOUT_ROUNDS.map(bracketColumnHTML).join('')}
      </div>
    </div>
  `;
  renderBracketToolbar();
}

function wireBracketListener() {
  document.getElementById('bracket').addEventListener('click', (e) => {
    if (isEditingDisabled()) return;
    const advance = e.target.closest('[data-action="advance"]');
    if (!advance) return;
    setBracketWinner(advance.dataset.match, advance.dataset.team);
    renderBracket();
    renderTiebreaker(); // champion may have changed
    renderCountdownBanner();
    renderActionsBar();
    maybeAdvanceStage();
  });
}

// ---------- Countdown banner ----------


// Each cell of the countdown is two flip-card digits. The 8 digits across all
// four cells are addressed by a stable index [0..7] so the per-second tick can
// update them in place (preserving DOM for the flip animation).
function digitsForRemaining(ms) {
  const total = Math.max(0, ms);
  const days  = Math.floor(total / 86_400_000);
  const hours = Math.floor((total % 86_400_000) / 3_600_000);
  const mins  = Math.floor((total % 3_600_000) / 60_000);
  const secs  = Math.floor((total % 60_000) / 1000);
  const pad = (n) => String(Math.min(99, n)).padStart(2, '0');
  return (pad(days) + pad(hours) + pad(mins) + pad(secs)).split('');
}

function flipDigitHTML(idx, digit) {
  // A flip-digit has 4 layers: two halves (the resting state) and two leaves
  // (the animated halves that fold during a change). The halves are clipping
  // containers — the full digit is rendered in each, but only the top half
  // shows in flip-half--top and only the bottom half shows in flip-half--bottom
  // (via flex alignment + overflow:hidden).
  return `
    <span class="flip-digit" data-flip-id="${idx}" data-digit="${digit}">
      <span class="flip-half flip-half--top"><span class="flip-num">${digit}</span></span>
      <span class="flip-half flip-half--bottom"><span class="flip-num">${digit}</span></span>
      <span class="flip-leaf flip-leaf--top"><span class="flip-num">${digit}</span></span>
      <span class="flip-leaf flip-leaf--bottom"><span class="flip-num">${digit}</span></span>
    </span>`;
}

function countdownCellsHTML(ms) {
  const d = digitsForRemaining(ms);
  const cell = (label, i0, i1) => `
    <span class="countdown-cell">
      <span class="countdown-cell-num">
        ${flipDigitHTML(i0, d[i0])}${flipDigitHTML(i1, d[i1])}
      </span>
      <span class="countdown-cell-label">${label}</span>
    </span>`;
  return `
    <div class="countdown-clock">
      ${cell('Days', 0, 1)}
      ${cell('Hrs',  2, 3)}
      ${cell('Min',  4, 5)}
      ${cell('Sec',  6, 7)}
    </div>`;
}

function participationNoteHTML() {
  return `
    <aside class="countdown-entry-note" aria-label="Participation note">
      <span class="entry-note-kicker">Announcement</span>
      <span class="entry-note-main">Venmo <strong>@nianci $10</strong> before kickoff to lock in your participation.</span>
      <span class="entry-note-sub">Idle users will be deleted <time datetime="2026-06-11T09:00:00-04:00">9am ET June 11</time>.</span>
    </aside>`;
}

function flipDigit(slot, newDigit) {
  const oldDigit = slot.dataset.digit;
  if (oldDigit === newDigit) return;
  slot.dataset.digit = newDigit;
  // Both resting halves go to NEW immediately. The OLD frame lives only on
  // the top leaf, which is layered on top during the animation and peels
  // away to reveal the NEW underneath.
  slot.querySelector('.flip-half--top    .flip-num').textContent = newDigit;
  slot.querySelector('.flip-half--bottom .flip-num').textContent = newDigit;
  slot.querySelector('.flip-leaf--top    .flip-num').textContent = oldDigit;
  slot.querySelector('.flip-leaf--bottom .flip-num').textContent = newDigit;
  slot.classList.remove('is-flipping');
  // Force layout so removing + re-adding the class restarts the keyframes.
  void slot.offsetWidth;
  slot.classList.add('is-flipping');
  setTimeout(() => slot.classList.remove('is-flipping'), 480);
}

function tickCountdownDigits(remaining) {
  const slots = document.querySelectorAll('#countdown-banner .flip-digit');
  if (slots.length !== 8) return;
  const digits = digitsForRemaining(remaining);
  slots.forEach((slot, idx) => flipDigit(slot, digits[idx]));
}

function refreshProgressLine() {
  const old = document.querySelector('#countdown-banner .countdown-progress');
  if (!old) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = progressLineHTML();
  const next = tmp.querySelector('.countdown-progress');
  if (next) old.replaceWith(next);
}

function tickCountdown() {
  const banner = document.getElementById('countdown-banner');
  if (!banner) return;
  const remaining = new Date(LOCK_DATE_ISO) - new Date();
  const wasLocked = banner.classList.contains('is-locked');
  const nowLocked = remaining <= 0;
  if (wasLocked !== nowLocked) {
    if (nowLocked) {
      if (banner.classList.contains('is-locking')) return;
      const note = banner.querySelector('.countdown-entry-note');
      if (note) {
        banner.classList.add('is-locking');
        note.classList.add('is-spinning-off');
        setTimeout(renderCountdownBanner, 700);
        return;
      }
    }
    // Lock state flipped — banner structure differs, so do a full rebuild.
    renderCountdownBanner();
    return;
  }
  if (!nowLocked) tickCountdownDigits(remaining);
  refreshProgressLine();
}

function progressLineHTML() {
  if (isLocked()) {
    return `<div class="countdown-progress">Status: <span class="ok">Picks locked</span></div>`;
  }
  if (isViewing()) {
    const safeName = state.viewedPlayer.name
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<div class="countdown-progress">Status: <span class="dim">Viewing ${safeName} (read-only)</span></div>`;
  }
  const dirty = isDirty();
  const submitted = isSubmitted();
  let savePart;
  if (dirty) {
    const n = dirtyCount();
    const label = n === 1 ? '1 unsaved change' : `${n} unsaved changes`;
    savePart = `<span class="warn">● ${label}</span>`;
  } else {
    savePart = `<span class="ok">✓ All changes saved</span>`;
  }
  const submitPart = submitted
    ? `<span class="ok">✓ Submitted</span>`
    : `<span class="warn">○ Not submitted</span>`;

  return `<div class="countdown-progress">Status: ${savePart} <span class="dim">·</span> ${submitPart}</div>`;
}

function renderCountdownBanner() {
  const banner = document.getElementById('countdown-banner');
  if (!banner) return;
  const lockMoment = new Date(LOCK_DATE_ISO);
  const now = new Date();
  const remaining = lockMoment - now;
  const locked = remaining <= 0;

  const whenStr = lockMoment.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const headline = locked
    ? `<div class="countdown-headline countdown-headline--locked">Picks locked</div>`
    : `<div class="countdown-headline">Picks lock in</div>`;

  banner.classList.toggle('is-locked', locked);
  banner.innerHTML = `
    ${headline}
    <div class="countdown-stage">
      ${countdownCellsHTML(Math.max(0, remaining))}
      ${locked ? '' : participationNoteHTML()}
    </div>
    <div class="countdown-when">${locked ? 'First kickoff: ' : ''}${whenStr}</div>
    ${progressLineHTML()}
  `;
  renderStepper();
}

// ---------- Section collapse (Groups + Wildcards) ----------

const COLLAPSIBLE_SECTIONS = ['groups', 'wildcards'];

function readCollapsedPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_COLLAPSED);
    if (!raw) return {};
    const v = JSON.parse(raw);
    return (v && typeof v === 'object') ? v : {};
  } catch { return {}; }
}

function writeCollapsedPref(key, collapsed) {
  const prefs = readCollapsedPrefs();
  prefs[key] = !!collapsed;
  try { localStorage.setItem(STORAGE_KEY_COLLAPSED, JSON.stringify(prefs)); } catch {}
}

function sectionElForKey(key) {
  return document.getElementById(`${key}-section`);
}

function isSectionComplete(key) {
  if (key === 'groups') return isGroupsComplete();
  if (key === 'wildcards') return isWildcardsComplete();
  return false;
}

function sectionSummaryText(key) {
  if (key === 'groups') {
    const done = groupsRankedCount();
    const total = state.groups.length || 12;
    return done === total ? `✓ All ${total} groups ranked` : `${done} of ${total} groups ranked`;
  }
  if (key === 'wildcards') {
    const done = advancingGroups().length;
    return done === 8 ? `✓ 8 wildcards picked` : `${done} of 8 wildcards picked`;
  }
  return '';
}

function setSectionCollapsed(key, collapsed) {
  const section = sectionElForKey(key);
  if (!section) return;
  section.classList.toggle('is-collapsed', !!collapsed);
  const btn = section.querySelector('.section-toggle');
  if (btn) btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
}

function renderSectionToggle(key) {
  const section = sectionElForKey(key);
  if (!section) return;
  const summarySpan = section.querySelector(`.section-toggle-summary[data-summary-for="${key}"]`);
  if (!summarySpan) return;
  const text = sectionSummaryText(key);
  summarySpan.textContent = text;
  summarySpan.classList.toggle('is-complete', isSectionComplete(key));
}

function initCollapsedSections() {
  const prefs = readCollapsedPrefs();
  for (const key of COLLAPSIBLE_SECTIONS) {
    renderSectionToggle(key);
    // Incomplete sections always start expanded so a new player sees them.
    // The stored pref only applies once the section is complete, so a finished
    // section can be left expanded if the user explicitly opens it again.
    const complete = isSectionComplete(key);
    const collapsed = complete ? ((key in prefs) ? !!prefs[key] : true) : false;
    setSectionCollapsed(key, collapsed);
  }
}

function wireSectionToggles() {
  document.querySelector('main')?.addEventListener('click', (e) => {
    // Stepper anchor → ensure target section is expanded before scroll lands.
    const step = e.target.closest('.step');
    if (step) {
      const href = step.getAttribute('href') || '';
      const id = href.startsWith('#') ? href.slice(1) : '';
      const key = id === 'groups-section' ? 'groups' : id === 'wildcards-section' ? 'wildcards' : null;
      if (key) {
        setSectionCollapsed(key, false);
        writeCollapsedPref(key, false);
      }
      return;
    }
    // Section header collapse toggle.
    const toggle = e.target.closest('.section-toggle');
    if (!toggle) return;
    const section = toggle.closest('.pick-section');
    if (!section) return;
    const id = section.id;
    const key = id === 'groups-section' ? 'groups' : id === 'wildcards-section' ? 'wildcards' : null;
    if (!key) return;
    const willCollapse = !section.classList.contains('is-collapsed');
    setSectionCollapsed(key, willCollapse);
    writeCollapsedPref(key, willCollapse);
  });
}

function renderStepper() {
  const el = document.getElementById('pick-stepper');
  if (!el) return;
  const groupsTotal = state.groups.length || 12;
  const groupsDone = groupsRankedCount();
  const groupsComplete = groupsTotal > 0 && groupsDone === groupsTotal;

  const wildcardsTotal = 8;
  const wildcardsDone = advancingGroups().length;
  const wildcardsComplete = wildcardsDone === wildcardsTotal;

  const ko = bracketMatches();
  const bracketTotal = ko.length;
  const bracketDone = ko.filter((m) => state.picks.draft.bracket[m.id]).length;
  const bracketComplete = bracketTotal > 0 && bracketDone === bracketTotal;

  const tbDone = state.picks.draft.tiebreaker != null ? 1 : 0;
  const tbComplete = tbDone === 1;
  const champCode = predictedChampionCode();

  let s1, s2, s3, s4;
  s1 = groupsComplete ? 'is-complete' : 'is-current';
  if (!groupsComplete) s2 = 'is-locked';
  else if (wildcardsComplete) s2 = 'is-complete';
  else s2 = 'is-current';
  if (!wildcardsComplete) s3 = 'is-locked';
  else if (bracketComplete) s3 = 'is-complete';
  else s3 = 'is-current';
  if (!bracketComplete) s4 = 'is-locked';
  else if (tbComplete) s4 = 'is-complete';
  else s4 = 'is-current';

  const stepHTML = (n, href, name, done, total, st, countOverride) => {
    const numContent = st === 'is-complete' ? '✓' : n;
    const progressLightClass = st === 'is-complete'
      ? 'progress-light--done'
      : st === 'is-current'
        ? 'progress-light--current'
        : 'progress-light--locked';
    let countText;
    if (countOverride != null) {
      countText = countOverride;
    } else if (st === 'is-locked') {
      countText = 'Locked';
    } else if (st === 'is-complete') {
      countText = `${done} / ${total} ✓`;
    } else {
      countText = `${done} / ${total}`;
    }
    return `
      <a href="${href}" class="step ${st}">
        <span class="progress-light ${progressLightClass}" aria-hidden="true"></span>
        <span class="step-num">${numContent}</span>
        <div class="step-meta">
          <span class="step-name">${name}</span>
          <span class="step-count">${countText}</span>
        </div>
      </a>`;
  };

  let tbCount = null;
  if (s4 !== 'is-locked' && champCode) {
    const avg = state.picks.draft.tiebreaker;
    tbCount = avg != null
      ? `${champCode} · ${avg} avg ✓`
      : `${champCode} · — avg`;
  }

  el.innerHTML = `
    ${stepHTML(1, '#groups-section', 'Group Stage', groupsDone, groupsTotal, s1)}
    <span class="step-arrow" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3 L10 8 L5 13"/></svg></span>
    ${stepHTML(2, '#wildcards-section', 'Wildcards', wildcardsDone, wildcardsTotal, s2)}
    <span class="step-arrow" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3 L10 8 L5 13"/></svg></span>
    ${stepHTML(3, '#bracket-section', 'Bracket', bracketDone, bracketTotal, s3)}
    <span class="step-arrow" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3 L10 8 L5 13"/></svg></span>
    ${stepHTML(4, '#tiebreaker-section', 'Tiebreaker', tbDone, 1, s4, tbCount)}
  `;
}

function startCountdownTicker() {
  // Tick once per second. tickCountdown() updates only the digits in place
  // (preserving the flip-card DOM so the flip animation can play) plus the
  // progress line. Full re-renders happen only when the lock state changes.
  setInterval(tickCountdown, 1000);
}

// ---------- Init ----------

async function init() {
  const url = new URL(location.href);
  const viewId = url.searchParams.get('view');
  const wantLogin = url.searchParams.has('login');

  let player = getStoredPlayer();
  // Open the picker on first visit (no stored player) or when "switch" asked
  // for it. When a player is already stored, the picker can be closed to keep
  // them signed in.
  if (!player || (wantLogin && !viewId)) {
    player = await showPlayerPicker({ current: player });
  }
  state.player = player;

  // Drop the ?login flag so a refresh doesn't reopen the picker.
  if (wantLogin) {
    url.searchParams.delete('login');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }

  window.renderUserBar?.();
  await Promise.all([loadReferenceData(), loadCurrentPlayer()]);

  if (viewId && viewId !== state.player.id) {
    const viewed = await loadViewedPlayer(viewId);
    if (viewed) {
      state.viewedPlayer = viewed;
      await loadMyPicks(viewed.id);
    } else {
      // Unknown player id: fall back to the current user's own picks rather
      // than landing on a blank board.
      await loadMyPicks();
    }
  } else {
    await loadMyPicks();
  }

  renderAll();
  initCollapsedSections();
  wireWildcards();
  wireBracketListener();
  wireActionsBar();
  wireSectionToolbars();
  wireSectionToggles();
  wireInternalLinkGuards();
  startCountdownTicker();
}

document.addEventListener('DOMContentLoaded', init);
