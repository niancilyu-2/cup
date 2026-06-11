// ABOUTME: Header ticker — pulls live FIFA World Cup headlines from ESPN's public news API,
// ABOUTME: caches 30 min in localStorage, falls back to static tournament facts on any failure.

(() => {
  const STORAGE_KEY = 'ticker-news-v2';
  const CACHE_MS = 30 * 60 * 1000;
  const NEWS_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/news';

  const FALLBACK_FACTS = [
    '16 host cities',
    '104 matches',
    '48 nations — largest WC ever',
    'USA · Canada · Mexico co-hosting',
    'First kickoff Jun 11 — Mexico vs South Africa @ Estadio Azteca',
    'Final Jul 19 @ MetLife Stadium, New Jersey',
    'Defending champions: Argentina (2022)',
    'Perfect bracket = 148 pts · never been done',
  ];

  const track = document.getElementById('ticker-track');
  if (!track) return;

  render(loadCached() || FALLBACK_FACTS.map((title) => ({ title, link: null })));

  fetchNews()
    .then((items) => {
      if (items.length === 0) return;
      saveCached(items);
      render(items);
    })
    .catch(() => {
      // Silent fail — static facts already on screen.
    });

  function render(items) {
    const html = items.map(renderItem).join('');
    // Duplicate the run so the marquee can loop seamlessly via translateX(-50%).
    track.innerHTML = html + html;
  }

  function renderItem({ title, link }) {
    const safeTitle = escapeHtml(title);
    const sep = '<span class="ticker-sep" aria-hidden="true">·</span>';
    if (link) {
      return `<a class="ticker-item" href="${escapeAttr(link)}" target="_blank" rel="noopener noreferrer">${safeTitle}</a>${sep}`;
    }
    return `<span class="ticker-item">${safeTitle}</span>${sep}`;
  }

  async function fetchNews() {
    const res = await fetch(NEWS_URL);
    if (!res.ok) throw new Error('news fetch failed: ' + res.status);
    const data = await res.json();
    if (!Array.isArray(data.articles)) throw new Error('bad ESPN response');
    return data.articles
      .map((a) => ({
        title: shortenTitle(a.headline || ''),
        link: a.links && a.links.web && a.links.web.href ? a.links.web.href : null,
      }))
      .filter((it) => it.title.length > 0)
      .slice(0, 15);
  }

  function shortenTitle(raw) {
    const t = raw.trim();
    if (t.length <= 95) return t;
    return t.slice(0, 92).replace(/\s+\S*$/, '') + '…';
  }

  function loadCached() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const { ts, items } = JSON.parse(raw);
      if (!Array.isArray(items) || Date.now() - ts > CACHE_MS) return null;
      return items;
    } catch {
      return null;
    }
  }

  function saveCached(items) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ts: Date.now(), items }));
    } catch {
      // Quota exceeded or storage disabled — non-fatal.
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(s) {
    return escapeHtml(s);
  }
})();
