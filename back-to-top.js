// ABOUTME: Fixed bottom-right "return to top" button shown after the user scrolls.
// ABOUTME: Injected on every page via <script src="back-to-top.js" defer>.

(function () {
  const THRESHOLD = 320;

  function init() {
    if (document.getElementById('back-to-top')) return;
    const btn = document.createElement('button');
    btn.id = 'back-to-top';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Back to top');
    btn.innerHTML = `
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M8 13 V3" />
        <path d="M4 7 L8 3 L12 7" />
      </svg>
    `;
    btn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    document.body.appendChild(btn);

    let ticking = false;
    function update() {
      ticking = false;
      const y = window.scrollY || window.pageYOffset || 0;
      btn.classList.toggle('is-visible', y > THRESHOLD);
    }
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    }, { passive: true });
    update();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
