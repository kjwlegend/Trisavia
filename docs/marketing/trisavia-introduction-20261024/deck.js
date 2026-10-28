(() => {
  'use strict';
  const dictionaries = window.TRISAVIA_INTRO_CONTENT;
  if (!dictionaries?.en || !dictionaries?.['zh-CN']) return; // Pre-rendered entries remain readable.
  const locales = ['en', 'zh-CN'];
  const resourceRoot = new URL('.', document.currentScript.src);
  const isSources = document.body.classList.contains('sources-page');
  function explicitLocale() {
    const match = location.pathname.match(/^\/(en|zh-CN)\/intro(?:\/|$)/);
    if (match) return match[1];
    if (location.protocol === 'file:' || !/^\/intro(?:\/|$)/.test(location.pathname)) {
      const localMatch = location.pathname.match(/\/(en|zh-CN)\/(?:index|sources)\.html$/);
      if (localMatch) return localMatch[1];
    }
    return null;
  }
  let stored;
  try { stored = localStorage.getItem('trisavia.locale'); } catch (_) { /* Storage is optional. */ }
  let locale = explicitLocale() || (locales.includes(stored) ? stored : (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en');
  const slides = [...document.querySelectorAll('.slide')];
  const previous = document.getElementById('previous');
  const next = document.getElementById('next');
  const dots = document.getElementById('page-dots');
  const count = document.getElementById('current-page');
  const total = document.getElementById('total-pages');
  const status = document.getElementById('slide-status');
  const readingToggle = document.getElementById('reading-toggle');
  const fullscreenToggle = document.getElementById('fullscreen-toggle');
  const narrow = window.matchMedia('(max-width: 800px), (orientation: portrait)');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let current = Math.max(0, Math.min(slides.length - 1, Number(location.hash.match(/^#slide-(\d+)$/)?.[1] || 1) - 1));
  let messageTimer;
  let announcedMessage;

  function text(key, params = {}) {
    const value = dictionaries[locale][key];
    if (typeof value !== 'string') throw new Error('Expected plain introduction message: ' + key);
    return value.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`));
  }
  function messageNodes(value) {
    if (typeof value === 'string') return [document.createTextNode(value)];
    return value.map(part => {
      if (typeof part === 'string') return document.createTextNode(part);
      // Only the build-time allowlisted inline tags/classes can reach this local resource.
      const node = document.createElement(part.tag);
      if (part.className) node.className = part.className;
      node.append(...messageNodes(part.children));
      return node;
    });
  }
  function localeUrl(target, sourcePage = isSources) {
    if (location.protocol === 'file:') {
      const url = new URL(`${target}/${sourcePage ? 'sources.html' : 'index.html'}`, resourceRoot);
      url.search = location.search;
      url.hash = location.hash;
      return url;
    }
    const url = new URL(`/${target}/intro/${sourcePage ? 'sources.html' : ''}`, location.origin);
    url.search = location.search;
    url.hash = location.hash;
    return url;
  }
  function updateLinks() {
    document.querySelectorAll('[data-intro-locale]').forEach(link => {
      link.href = localeUrl(link.dataset.introLocale).href;
      link.setAttribute('aria-current', String(link.dataset.introLocale === locale));
    });
    document.querySelectorAll('[data-intro-source-link]').forEach(link => { link.href = localeUrl(locale, true).href; });
    document.querySelectorAll('[data-intro-return]').forEach(link => { link.href = localeUrl(locale, false).href; });
  }
  function applyLocale() {
    const active = document.activeElement;
    const scroll = { x: window.scrollX, y: window.scrollY };
    // Explicit bindings only. Original code examples, pixels, source URLs and other DOM stay intact.
    document.querySelectorAll('[data-intro-i18n]').forEach(node => {
      const value = dictionaries[locale][node.dataset.introI18n];
      node.replaceChildren(...messageNodes(value));
    });
    for (const attribute of ['alt', 'title', 'aria-label', 'content', 'data-title']) {
      document.querySelectorAll(`[data-intro-${attribute}]`).forEach(node => {
        node.setAttribute(attribute, text(node.getAttribute(`data-intro-${attribute}`), { count: slides.length }));
      });
    }
    document.documentElement.lang = locale;
    document.querySelectorAll('[data-intro-source-locale]').forEach(article => {
      article.hidden = article.dataset.introSourceLocale !== locale;
      article.inert = article.hidden;
    });
    document.querySelectorAll('[data-world-shot]').forEach(updateWorldShot);
    updateLinks();
    if (slides.length) render({ updateHash: false });
    if (announcedMessage) document.getElementById('viewer-message').textContent = text(announcedMessage);
    // Controls and all interactive links are stable nodes. Keep the actual focus and scroll position.
    if (active?.isConnected && document.activeElement !== active) active.focus({ preventScroll: true });
    if (window.scrollX !== scroll.x || window.scrollY !== scroll.y) window.scrollTo(scroll.x, scroll.y);
  }
  function setLocale(target, { persist = false, updateUrl = false } = {}) {
    if (!locales.includes(target)) return;
    // Both local dictionaries are loaded before this script; the switch has no asynchronous partial state.
    if (updateUrl) {
      try { history.replaceState(history.state, '', localeUrl(target)); } catch (_) { /* file:// history can be restricted. */ }
    }
    locale = target;
    applyLocale();
    if (persist) try { localStorage.setItem('trisavia.locale', locale); } catch (_) { /* Optional preference only. */ }
  }
  document.querySelectorAll('[data-intro-locale]').forEach(link => {
    link.addEventListener('click', event => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      setLocale(link.dataset.introLocale, { persist: true, updateUrl: true });
    });
  });
  window.addEventListener('popstate', () => { const target = explicitLocale(); if (target) setLocale(target); });

  function isReading() { return narrow.matches || document.body.classList.contains('reading'); }
  function announce(key) {
    const box = document.getElementById('viewer-message');
    announcedMessage = key;
    box.textContent = text(key);
    box.classList.add('visible');
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => { box.classList.remove('visible'); announcedMessage = undefined; }, 2800);
  }
  function render({ scroll = false, updateHash = true } = {}) {
    const reading = isReading();
    slides.forEach((slide, index) => {
      slide.classList.toggle('active', index === current);
      slide.inert = !reading && index !== current;
      slide.setAttribute('aria-hidden', String(!reading && index !== current));
      const dot = dots.children[index];
      dot.setAttribute('aria-current', String(index === current));
      dot.setAttribute('aria-label', text('controls.dot', { page: index + 1, title: slide.dataset.title }));
      dot.title = `${index + 1} · ${slide.dataset.title}`;
    });
    count.textContent = String(current + 1).padStart(2, '0');
    total.textContent = String(slides.length).padStart(2, '0');
    previous.disabled = current === 0;
    next.disabled = current === slides.length - 1;
    const manualReading = document.body.classList.contains('reading');
    readingToggle.setAttribute('aria-pressed', String(manualReading));
    readingToggle.textContent = text(manualReading ? 'controls.presentation' : 'controls.reading');
    const fullscreen = !!document.fullscreenElement;
    fullscreenToggle.setAttribute('aria-label', text(fullscreen ? 'controls.fullscreenExit' : 'controls.fullscreenEnter'));
    fullscreenToggle.title = text(fullscreen ? 'controls.fullscreenExitTitle' : 'controls.fullscreenTitle');
    status.textContent = text('controls.status', { page: current + 1, count: slides.length, title: slides[current].dataset.title });
    if (updateHash) {
      try { history.replaceState(history.state, '', `#slide-${current + 1}`); } catch (_) { /* Also works from file://. */ }
    }
    updateLinks();
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
      else announce('controls.fullscreenUnsupported');
    } catch (_) { announce('controls.fullscreenRejected'); }
  }
  function updateWorldShot(img) {
    if (!img.dataset.fallbackUsed) return;
    img.alt = text('cover.fallbackAlt');
    const caption = img.closest('figure')?.querySelector('[data-image-caption]');
    if (caption) caption.textContent = text('cover.fallbackCaption');
  }
  document.querySelectorAll('[data-world-shot]').forEach(img => {
    function useFallback() {
      if (img.dataset.fallbackUsed) return;
      img.dataset.fallbackUsed = 'true';
      img.src = img.dataset.fallback;
      img.closest('figure')?.classList.add('is-fallback');
      updateWorldShot(img);
    }
    img.addEventListener('error', useFallback);
    if (img.complete && !img.naturalWidth) useFallback();
  });

  if (slides.length) {
    slides.forEach((_, index) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'page-dot';
      dot.addEventListener('click', () => goTo(index));
      dots.append(dot);
    });
    previous.addEventListener('click', () => goTo(current - 1));
    next.addEventListener('click', () => goTo(current + 1));
    readingToggle.addEventListener('click', () => {
      document.body.classList.toggle('reading');
      render({ scroll: true });
    });
    document.getElementById('print-deck').addEventListener('click', () => window.print());
    fullscreenToggle.addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', () => render({ updateHash: false }));
    document.addEventListener('keydown', event => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
      if ((event.key === ' ' || event.key === 'Enter') && event.target.closest('button,a')) return;
      if (['ArrowRight', 'PageDown', ' '].includes(event.key)) { event.preventDefault(); goTo(current + (event.shiftKey && event.key === ' ' ? -1 : 1)); }
      else if (['ArrowLeft', 'PageUp'].includes(event.key)) { event.preventDefault(); goTo(current - 1); }
      else if (event.key === 'Home') { event.preventDefault(); goTo(0); }
      else if (event.key === 'End') { event.preventDefault(); goTo(slides.length - 1); }
      else if (event.key.toLowerCase() === 'f') { event.preventDefault(); toggleFullscreen(); }
      else if (event.key.toLowerCase() === 'r' && !narrow.matches) { event.preventDefault(); readingToggle.click(); }
    });
    window.addEventListener('hashchange', () => {
      const match = location.hash.match(/^#slide-(\d+)$/);
      if (match) goTo(Number(match[1]) - 1, { updateHash: false });
    });
    narrow.addEventListener('change', () => render({ updateHash: false }));
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
  }
  applyLocale();
  // Add presentation-mode CSS only after successful rendering, preserving no-JS fallback on errors.
  document.documentElement.classList.add('js');
  if (slides.length) render({ scroll: isReading() && current > 0, updateHash: /^#slide-\d+$/.test(location.hash) || !location.hash });
})();
