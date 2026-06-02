// ABOUTME: Shared header chip showing the active player + edit-name / switch controls.
// ABOUTME: Loaded on every page so the identity travels across tabs.

(function () {
  const KEY = 'wcbracket.player';

  function escapeHTML(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function getPlayer() {
    try {
      const raw = localStorage.getItem(KEY);
      const p = raw ? JSON.parse(raw) : null;
      return (p && typeof p === 'object' && p.id) ? p : null;
    } catch (_) { return null; }
  }

  function isValidPin(pin) {
    return typeof pin === 'string' && /^\d{4}$/.test(pin);
  }

  // SHA-256 of (pin || player_id) — matches the hash app.js writes.
  async function hashPin(pin, playerId) {
    const data = new TextEncoder().encode(String(pin) + String(playerId));
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Rename needs Supabase; pages without it (e.g. rules.html) just omit the control.
  let _client = null;
  function client() {
    if (_client) return _client;
    if (!window.supabase || !window.SUPABASE_URL) return null;
    _client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    return _client;
  }

  function render() {
    const bar = document.getElementById('user-bar');
    if (!bar) return;
    const player = getPlayer();
    if (!player || !player.name) {
      bar.innerHTML = '';
      return;
    }
    const canRename = !!client();
    bar.innerHTML = `
      <span class="user-id">
        <svg class="user-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="8" cy="5.5" r="2.5" />
          <path d="M3 14 C3 11 5 9.5 8 9.5 C11 9.5 13 11 13 14" />
        </svg>
        <span class="user-name">${escapeHTML(player.name)}</span>
      </span>
      ${canRename ? '<button id="edit-name" class="link-button" type="button">edit</button>' : ''}
      <button id="switch-user" class="link-button" type="button">switch</button>
    `;
    if (canRename) {
      document.getElementById('edit-name').addEventListener('click', () => openRename(player));
    }
    document.getElementById('switch-user').addEventListener('click', () => {
      localStorage.removeItem(KEY);
      // Redirect to the picks page so the player picker shows. On index.html
      // this is effectively a reload.
      location.href = 'index.html';
    });
  }

  function openRename(player) {
    const db = client();
    if (!db) return;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h2>Change your name</h2>
        <p>Enter a new display name and your 4-digit PIN to confirm.</p>
        <form id="rename-form">
          <input id="rename-name" type="text" maxlength="30" value="${escapeHTML(player.name)}" required autofocus />
          <input id="rename-pin" type="password" inputmode="numeric" pattern="\\d{4}" maxlength="4" autocomplete="off" placeholder="4-digit PIN" required />
          <div class="modal-actions">
            <button type="submit" class="btn-primary">Save</button>
            <button type="button" class="btn-secondary" id="rename-cancel">Cancel</button>
          </div>
          <p id="rename-error" class="error" hidden></p>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);
    const errorEl = overlay.querySelector('#rename-error');
    const fail = (msg) => { errorEl.textContent = msg; errorEl.hidden = false; };
    const close = () => overlay.remove();

    overlay.querySelector('#rename-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelector('#rename-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.hidden = true;
      const name = overlay.querySelector('#rename-name').value.trim();
      const pin = overlay.querySelector('#rename-pin').value.trim();
      if (!name) return fail('Enter a name.');
      if (!isValidPin(pin)) return fail('PIN must be 4 digits.');
      if (name === player.name) return close();

      const { data, error } = await db.from('players').select('pin_hash').eq('id', player.id).single();
      if (error || !data) return fail("Couldn't verify your PIN. Try again.");
      const provided = await hashPin(pin, player.id);
      if (provided !== data.pin_hash) {
        overlay.querySelector('#rename-pin').select();
        return fail('Wrong PIN.');
      }

      const { error: upErr } = await db.from('players').update({ name }).eq('id', player.id);
      if (upErr) {
        return fail(upErr.code === '23505'
          ? `"${name}" is already taken. Try another.`
          : `Couldn't save: ${upErr.message}`);
      }
      localStorage.setItem(KEY, JSON.stringify({ ...player, name }));
      close();
      render();
    });
  }

  window.renderUserBar = render;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
