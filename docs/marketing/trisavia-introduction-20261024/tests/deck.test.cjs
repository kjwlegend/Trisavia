// No browser or third-party dependency: exercise the shipped deck against its real HTML bindings.
const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function fixture({ url = 'http://127.0.0.1/en/intro/?review=1#slide-7', stored, language = 'en-US', sources = false, brokenStorage = false } = {}) {
  const entries = JSON.parse(execFileSync('python3', ['-c', `import importlib.util,json,sys;sys.dont_write_bytecode=True;from pathlib import Path;s=importlib.util.spec_from_file_location('intro_build',${JSON.stringify(path.join(root, 'build.py'))});m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(json.dumps(m.Document(Path(${JSON.stringify(path.join(root, 'publish/en', sources ? 'sources.html' : 'index.html'))}).read_text()).nodes))`], { encoding: 'utf8' }));
  let document;
  class Element {
    constructor(tag, attrs = {}) { this.tagName = tag; this.attrs = { ...attrs }; this.children = []; this.listeners = {}; this.inert = false; this.isConnected = true; this.dataset = new Proxy({}, { get: (_, key) => this.attrs['data-' + key.replace(/[A-Z]/g, m => '-' + m.toLowerCase())], set: (_, key, value) => { this.attrs['data-' + key.replace(/[A-Z]/g, m => '-' + m.toLowerCase())] = value; return true; } }); }
    get className() { return this.attrs.class || ''; }
    set className(value) { this.attrs.class = value; }
    get classList() { const self = this; return { contains(value) { return self.className.split(' ').includes(value); }, add(value) { if (!this.contains(value)) self.className += ' ' + value; }, remove(value) { self.className = self.className.split(' ').filter(x => x !== value).join(' '); }, toggle(value, state) { const active = state ?? !this.contains(value); if (active) this.add(value); else this.remove(value); return active; } }; }
    get textContent() { return this.children.map(child => typeof child === 'string' ? child : child.textContent).join(''); }
    set textContent(value) { this.children = [String(value)]; }
    setAttribute(key, value) { this.attrs[key] = String(value); }
    getAttribute(key) { return this.attrs[key] ?? null; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
    async dispatch(type, options = {}) { for (const callback of this.listeners[type] || []) await callback({ button: 0, target: this, preventDefault() {}, ...options }); }
    closest(selector) { return selector.split(',').includes(this.tagName) ? this : null; }
    focus() { document.activeElement = this; }
    scrollIntoView() { this.scrolled = true; }
    querySelector() { return null; }
    click() { return this.dispatch('click'); }
  }
  const elements = entries.map(entry => new Element(entry.tag, entry.attrs));
  const byId = id => elements.find(el => el.attrs.id === id);
  document = {
    documentElement: elements.find(el => el.tagName === 'html'), body: elements.find(el => el.tagName === 'body'), fullscreenElement: null,
    currentScript: { src: 'http://127.0.0.1/intro/deck.js' }, activeElement: null, listeners: {},
    createElement: tag => new Element(tag), createTextNode: value => String(value), getElementById: byId,
    querySelectorAll(selector) { if (selector === '.slide') return elements.filter(el => el.classList.contains('slide')); const attr = selector.match(/^\[([^\]]+)\]$/)?.[1]; return attr ? elements.filter(el => Object.hasOwn(el.attrs, attr)) : []; },
    addEventListener: Element.prototype.addEventListener, dispatch: Element.prototype.dispatch,
  };
  const location = new URL(url);
  let storedValue = stored;
  let writes = 0;
  const context = {
    document, location, navigator: { language }, URL,
    history: { state: { retained: true }, replaceState(state, _, value) { this.state = state; location.href = new URL(value, location).href; } },
    localStorage: { getItem(key) { assert.equal(key, 'trisavia.locale'); if (brokenStorage) throw Error('storage unavailable'); return storedValue; }, setItem(key, value) { assert.equal(key, 'trisavia.locale'); if (brokenStorage) throw Error('storage unavailable'); storedValue = value; writes++; } },
    matchMedia: () => ({ matches: false, addEventListener() {} }), scrollX: 8, scrollY: 120,
    scrollTo(x, y) { this.scrollX = x; this.scrollY = y; }, printCount: 0, print() { this.printCount++; },
    listeners: {}, addEventListener: Element.prototype.addEventListener, dispatch: Element.prototype.dispatch,
    setTimeout() { return 1; }, clearTimeout() {},
  };
  context.window = context;
  document.documentElement.requestFullscreen = async () => { document.fullscreenElement = document.documentElement; await document.dispatch('fullscreenchange'); };
  document.exitFullscreen = async () => { document.fullscreenElement = null; await document.dispatch('fullscreenchange'); };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'content.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'deck.js'), 'utf8'), context);
  const languageLink = target => elements.find(el => el.dataset.introLocale === target);
  return { context, document, elements, byId, languageLink, stored: () => storedValue, writes: () => writes };
}

test('explicit URL wins; switch preserves slide/query/hash/focus/reading/fullscreen and updates live labels', async () => {
  const f = fixture({ stored: 'zh-CN' });
  assert.equal(f.document.documentElement.lang, 'en');
  assert.equal(f.writes(), 0);
  assert.equal(f.byId('current-page').textContent, '07');
  assert.match(f.byId('slide-status').textContent, /^Slide 7 of 10/);
  await f.byId('reading-toggle').click();
  await f.byId('fullscreen-toggle').click();
  const focused = f.languageLink('zh-CN'); focused.focus();
  const before = f.byId('slide-7');
  await focused.click();
  assert.equal(f.context.location.pathname, '/zh-CN/intro/');
  assert.equal(f.context.location.search, '?review=1');
  assert.equal(f.context.location.hash, '#slide-7');
  assert.equal(f.context.history.state.retained, true);
  assert.equal(f.document.activeElement, focused);
  assert.equal(f.byId('slide-7'), before);
  assert.equal(f.byId('current-page').textContent, '07');
  assert.equal(f.document.body.classList.contains('reading'), true);
  assert.equal(f.byId('reading-toggle').textContent, '演示');
  assert.equal(f.byId('fullscreen-toggle').getAttribute('aria-label'), '退出全屏');
  assert.match(f.byId('slide-status').textContent, /^第 7 页/);
  assert.match(f.byId('page-dots').children[6].getAttribute('aria-label'), /^第 7 页/);
  assert.equal(f.stored(), 'zh-CN');
  assert.equal(f.context.scrollY, 120);
  await f.languageLink('en').click();
  assert.equal(f.byId('reading-toggle').textContent, 'Present');
  assert.equal(f.byId('fullscreen-toggle').getAttribute('aria-label'), 'Exit fullscreen');
  assert.match(f.byId('page-dots').children[6].getAttribute('aria-label'), /^Slide 7:/);
  await f.byId('fullscreen-toggle').click();
  assert.equal(f.byId('fullscreen-toggle').getAttribute('aria-label'), 'Enter fullscreen');
});

test('legacy entry uses device then browser preference; automatic choice is never persisted', () => {
  for (const [stored, language, expected] of [['zh-CN', 'en-US', 'zh-CN'], [undefined, 'zh-TW', 'zh-CN'], [undefined, 'fr-FR', 'en']]) {
    const f = fixture({ url: 'http://127.0.0.1/intro/?x=1#note', stored, language });
    assert.equal(f.document.documentElement.lang, expected);
    assert.equal(f.writes(), 0);
    assert.equal(f.context.location.hash, '#note');
  }
  assert.equal(fixture({ brokenStorage: true }).document.documentElement.lang, 'en');
});

test('all slides, keyboard paging, print, unknown hash and fullscreen failures remain usable in both languages', async () => {
  const f = fixture({ url: 'http://127.0.0.1/en/intro/?x=1#note' });
  assert.equal(f.byId('page-dots').children.length, 10);
  await f.languageLink('zh-CN').click();
  assert.equal(f.context.location.hash, '#note');
  await f.languageLink('en').click();
  await f.document.dispatch('keydown', { key: 'End', target: f.document.body });
  assert.equal(f.byId('current-page').textContent, '10');
  assert.equal(f.byId('next').disabled, true);
  await f.byId('previous').click();
  assert.equal(f.byId('current-page').textContent, '09');
  await f.document.dispatch('keydown', { key: 'Home', target: f.document.body });
  assert.equal(f.byId('previous').disabled, true);
  await f.byId('print-deck').click();
  assert.equal(f.context.printCount, 1);
  f.document.documentElement.requestFullscreen = undefined;
  await f.byId('fullscreen-toggle').click();
  assert.match(f.byId('viewer-message').textContent, /^Fullscreen is unavailable/);
  await f.languageLink('zh-CN').click();
  assert.match(f.byId('viewer-message').textContent, /^此浏览器不支持/);
});

test('sources toggle pre-rendered articles and localized return link without rebuilding content', async () => {
  const f = fixture({ sources: true, url: 'http://127.0.0.1/en/intro/sources.html?x=1#slide-8' });
  const articles = f.elements.filter(el => el.dataset.introSourceLocale);
  assert.equal(articles.find(el => el.dataset.introSourceLocale === 'en').hidden, false);
  await f.languageLink('zh-CN').click();
  assert.equal(articles.find(el => el.dataset.introSourceLocale === 'en').hidden, true);
  assert.equal(articles.find(el => el.dataset.introSourceLocale === 'zh-CN').hidden, false);
  const back = f.elements.find(el => Object.hasOwn(el.attrs, 'data-intro-return'));
  assert.equal(back.href, 'http://127.0.0.1/zh-CN/intro/?x=1#slide-8');
});

test('fallback caption and alt keep historical date when language changes', async () => {
  const f = fixture();
  const image = f.elements.find(el => Object.hasOwn(el.attrs, 'data-world-shot'));
  await image.dispatch('error');
  assert.match(image.alt, /October 23, 2026/);
  await f.languageLink('zh-CN').click();
  assert.match(image.alt, /2026年10月23日/);
  await f.languageLink('en').click();
  assert.match(image.alt, /October 23, 2026/);
});
