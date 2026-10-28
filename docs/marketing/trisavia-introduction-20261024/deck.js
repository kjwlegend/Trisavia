(() => {
  'use strict';
  document.documentElement.classList.add('js');

  const slides = [...document.querySelectorAll('.slide')];
  const previous = document.getElementById('previous');
  const next = document.getElementById('next');
  const dots = document.getElementById('page-dots');
  const count = document.getElementById('current-page');
  const total = document.getElementById('total-pages');
  if (total) total.textContent = String(slides.length).padStart(2, '0');
  document.getElementById('deck').setAttribute('aria-label', `Trisavia 万物有邻项目介绍，共 ${slides.length} 页`);
  const status = document.getElementById('slide-status');
  const readingToggle = document.getElementById('reading-toggle');
  const fullscreenToggle = document.getElementById('fullscreen-toggle');
  const narrow = window.matchMedia('(max-width: 800px), (orientation: portrait)');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let current = Math.max(0, Math.min(slides.length - 1, Number(location.hash.match(/^#slide-(\d+)$/)?.[1] || 1) - 1));
  let messageTimer;

  function isReading() { return narrow.matches || document.body.classList.contains('reading'); }
  function announce(message) {
    const box = document.getElementById('viewer-message');
    box.textContent = message;
    box.classList.add('visible');
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => box.classList.remove('visible'), 2800);
  }

  slides.forEach((slide, index) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'page-dot';
    dot.setAttribute('aria-label', `第 ${index + 1} 页：${slide.dataset.title}`);
    dot.title = `${index + 1} · ${slide.dataset.title}`;
    dot.addEventListener('click', () => goTo(index));
    dots.append(dot);
  });

  function render({ scroll = false, updateHash = true } = {}) {
    const reading = isReading();
    slides.forEach((slide, index) => {
      slide.classList.toggle('active', index === current);
      slide.inert = !reading && index !== current;
      slide.setAttribute('aria-hidden', String(!reading && index !== current));
      dots.children[index].setAttribute('aria-current', String(index === current));
    });
    count.textContent = String(current + 1).padStart(2, '0');
    previous.disabled = current === 0;
    next.disabled = current === slides.length - 1;
    readingToggle.setAttribute('aria-pressed', String(document.body.classList.contains('reading')));
    readingToggle.textContent = document.body.classList.contains('reading') ? '演示' : '阅读';
    status.textContent = `第 ${current + 1} 页，共 ${slides.length} 页。${slides[current].dataset.title}`;
    if (updateHash) {
      try { history.replaceState(null, '', `#slide-${current + 1}`); } catch (_) { /* The deck also works from file://. */ }
    }
    if (reading && scroll) slides[current].scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
  }

  function goTo(index, options = {}) {
    current = Math.max(0, Math.min(slides.length - 1, index));
    render({ scroll: true, ...options });
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else announce('此浏览器不支持全屏，可使用浏览器的全屏命令。');
    } catch (_) { announce('全屏未打开，可使用浏览器的全屏命令。'); }
  }

  previous.addEventListener('click', () => goTo(current - 1));
  next.addEventListener('click', () => goTo(current + 1));
  readingToggle.addEventListener('click', () => {
    document.body.classList.toggle('reading');
    render({ scroll: true });
  });
  document.getElementById('print-deck').addEventListener('click', () => window.print());
  fullscreenToggle.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', () => {
    const active = !!document.fullscreenElement;
    fullscreenToggle.setAttribute('aria-label', active ? '退出全屏' : '进入全屏');
    fullscreenToggle.title = active ? '退出全屏（Esc / F）' : '全屏（F）';
  });
  document.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
    if ((event.key === ' ' || event.key === 'Enter') && event.target.closest('button,a')) return;
    const nextKeys = ['ArrowRight', 'PageDown', ' '];
    const previousKeys = ['ArrowLeft', 'PageUp'];
    if (nextKeys.includes(event.key)) { event.preventDefault(); goTo(current + (event.shiftKey && event.key === ' ' ? -1 : 1)); }
    else if (previousKeys.includes(event.key)) { event.preventDefault(); goTo(current - 1); }
    else if (event.key === 'Home') { event.preventDefault(); goTo(0); }
    else if (event.key === 'End') { event.preventDefault(); goTo(slides.length - 1); }
    else if (event.key.toLowerCase() === 'f') { event.preventDefault(); toggleFullscreen(); }
    else if (event.key.toLowerCase() === 'r' && !narrow.matches) { event.preventDefault(); readingToggle.click(); }
  });
  window.addEventListener('hashchange', () => {
    const match = location.hash.match(/^#slide-(\d+)$/);
    if (match) goTo(Number(match[1]) - 1, { updateHash: false });
  });
  narrow.addEventListener('change', () => render());

  // Keep the page counter useful while scrolling the continuous reading view.
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      if (!isReading()) return;
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible.length) {
        const index = slides.indexOf(visible[0].target);
        if (index !== current) { current = index; render({ updateHash: false }); }
      }
    }, { rootMargin: '-15% 0px -60% 0px', threshold: 0 });
    slides.forEach(slide => observer.observe(slide));
  }

  document.querySelectorAll('[data-world-shot]').forEach(img => {
    function useFallback() {
      if (img.dataset.fallbackUsed) return;
      img.dataset.fallbackUsed = 'true';
      img.src = img.dataset.fallback;
      img.alt = '2026年10月23日匿名开发截图，含拍摄时的旧字标';
      const figure = img.closest('figure');
      figure?.classList.add('is-fallback');
      const caption = figure?.querySelector('[data-image-caption]');
      if (caption) caption.textContent = '开发截图 · 2026.10.23（含旧字标）';
    }
    img.addEventListener('error', useFallback);
    if (img.complete && !img.naturalWidth) useFallback();
  });

  render({ scroll: isReading() && current > 0 });
})();
