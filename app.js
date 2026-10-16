import { SOURCES, interleave, normalizeUrl } from './sources.js';

const PAGE = 4;
const SEEN_CAP = 500;
const $ = s => document.querySelector(s);
const enabled = SOURCES.filter(s => s.enabled);
const bySource = Object.fromEntries(SOURCES.map(s => [s.key, s]));

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('devfeed.' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('devfeed.' + k, JSON.stringify(v)); } catch {} },
};

let seen = store.get('seen', []);            // ordered list of "source:id", newest last
let seenAtLoad = new Set(seen);               // snapshot, so dimming mid-session doesn't move the divider
let saved = store.get('saved', {});           // "source:id" -> item
let filter = store.get('filter', 'all');
if (filter !== 'all' && filter !== 'saved' && !enabled.some(s => s.key === filter)) filter = 'all';

let gen = 0;                                  // bumps on reset; stale responses are dropped
let loading = false, done = false, shownAny = false, sawUnseen = false, dividerShown = false;
let pages, exhausted, shownUrls;

// ---------- tiny DOM helper ----------
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true && !k.startsWith('aria-') ? '' : v);
  }
  el.append(...kids.flat().filter(k => k != null && k !== false));
  return el;
}

const count = (n, unit) => `${fmt(n)} ${n === 1 ? unit.replace(/s$/, '') : unit}`;
const key = it => `${it.source}:${it.id}`;
const fmt = n => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n));
function ago(ms) {
  const m = Math.max(1, Math.round((Date.now() - ms) / 6e4));
  if (m < 60) return m + 'm';
  if (m < 1440) return Math.round(m / 60) + 'h';
  return Math.round(m / 1440) + 'd';
}

// ---------- rendering ----------
function card(it) {
  const src = bySource[it.source];
  const k = key(it);
  const isSaved = k in saved;
  const el = h('article', { class: 'card' + (seen.includes(k) ? ' seen' : ''), 'data-src': it.source });
  const markSeen = () => {
    if (!seen.includes(k)) { seen.push(k); seen = seen.slice(-SEEN_CAP); store.set('seen', seen); }
    el.classList.add('seen');
  };
  const save = h('button', { class: 'save', 'aria-pressed': isSaved, 'aria-label': 'Save for later', onclick() {
    if (k in saved) delete saved[k]; else saved[k] = it;
    store.set('saved', saved);
    save.setAttribute('aria-pressed', k in saved);
    if (filter === 'saved' && !(k in saved)) el.remove();
  } });
  save.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 3.5h12v17l-6-4.2-6 4.2z"/></svg>';

  const comments = count(it.comments, src.units[1]);
  el.append(
    h('a', { class: 'title', href: it.url, target: '_blank', rel: 'noopener noreferrer', onclick: markSeen, onauxclick: markSeen }, it.title),
    it.summary ? h('p', { class: 'summary' }, it.summary) : '',
    h('div', { class: 'meta' },
      h('span', { class: 'src' }, src.label), ` · ${it.domain} · ${ago(it.time)}`, it.tag ? ` · ${it.tag}` : ''),
    h('div', { class: 'actions' },
      h('span', { class: 'stat' }, count(it.points, src.units[0])),
      // the comment count doubles as the discussion link
      it.discussionUrl
        ? h('a', { class: 'stat', href: it.discussionUrl, target: '_blank', rel: 'noopener noreferrer', onclick: markSeen }, comments)
        : h('span', { class: 'stat' }, comments),
      save));
  return el;
}

const skeletons = () => Array.from({ length: PAGE }, () => h('div', { class: 'card skeleton' },
  h('div', { class: 'sk', style: 'width:90%;height:16px;margin-bottom:6px' }),
  h('div', { class: 'sk', style: 'width:60%;height:16px;margin-bottom:10px' }),
  h('div', { class: 'sk', style: 'width:45%;height:10px;margin-bottom:24px' })));

function append(items) {
  const feed = $('#feed');
  for (const it of items) {
    const isSeen = seenAtLoad.has(key(it));
    if (!isSeen) sawUnseen = true;
    else if (sawUnseen && !dividerShown && filter !== 'saved') {
      dividerShown = true;
      feed.append(h('div', { class: 'caught-up' }, 'Seen before'));
    }
    feed.append(card(it));
    shownAny = true;
  }
}

function renderChips() {
  const chips = [['all', 'All'], ...enabled.map(s => [s.key, s.label]), ['saved', 'Saved']];
  $('#chips').replaceChildren(...chips.map(([k, label]) =>
    h('button', { class: 'chip', 'aria-pressed': k === filter, onclick() { setFilter(k); } }, label)));
}

function setFilter(k) {
  filter = k; store.set('filter', k);
  renderChips();
  reset();
}

// ---------- loading ----------
function reset() {
  gen++;
  loading = false; done = false; shownAny = false; sawUnseen = false; dividerShown = false;
  pages = {}; exhausted = new Set(); shownUrls = new Set();
  seenAtLoad = new Set(seen);
  $('#feed').replaceChildren();
  $('#notices').replaceChildren();
  enabled.forEach(s => s.reset?.());
  if (filter === 'saved') return showSaved();
  loadMore();
}

function showSaved() {
  const items = Object.values(saved).reverse();
  done = true;
  if (!items.length) return $('#feed').append(h('div', { class: 'empty' }, 'Nothing saved yet.'));
  $('#feed').append(...items.map(card));
}

async function loadMore() {
  if (loading || done) return;
  const myGen = gen;
  loading = true;
  const active = enabled.filter(s => (filter === 'all' || filter === s.key) && !exhausted.has(s.key));
  if (!active.length) { loading = false; done = true; return; }

  const sk = skeletons();
  $('#feed').append(...sk);
  $('#notices').replaceChildren();
  $('#refresh').classList.add('spin');

  const results = await Promise.allSettled(active.map(s => s.fetchPage(pages[s.key] ?? 0, PAGE)));
  if (myGen !== gen) return;                  // filter changed or refreshed while we waited
  sk.forEach(el => el.remove());
  $('#refresh').classList.remove('spin');

  const lists = [], failed = [];
  results.forEach((r, i) => {
    const s = active[i];
    if (r.status === 'rejected') return failed.push(s);
    pages[s.key] = (pages[s.key] ?? 0) + 1;
    if (!r.value.length) exhausted.add(s.key);
    lists.push(r.value);
  });

  const fresh = interleave(lists).filter(it => {
    if (!it.url) return false;
    const u = normalizeUrl(it.url);
    if (shownUrls.has(u)) return false;
    shownUrls.add(u);
    return true;
  });
  append(fresh);

  for (const s of failed) {
    $('#notices').append(h('div', { class: 'notice' }, `${s.name} didn't load.`,
      h('button', { onclick() { loadMore(); } }, 'Retry')));
  }
  if (!shownAny && failed.length === active.length) {
    $('#feed').append(h('div', { class: 'empty' },
      navigator.onLine ? "Nothing loaded." : "Offline, and nothing cached yet.",
      h('button', { onclick: reset }, 'Retry')));
  }
  if (!failed.length && !active.some(s => !exhausted.has(s.key))) done = true;

  loading = false;
  // Without failures, re-arm the observer in case the sentinel is still on screen.
  if (!failed.length && !done) { io.unobserve($('#sentinel')); io.observe($('#sentinel')); }
}

const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) loadMore(); }, { rootMargin: '600px' });

// ---------- theme & view (applyTheme lives in index.html so it runs before first paint) ----------
const THEMES = ['auto', 'light', 'oxford', 'plum'];
const THEME_NAMES = { auto: 'Auto', light: 'Light', oxford: 'Oxford', plum: 'Plum' };
$('#theme').addEventListener('click', () => {
  const next = THEMES[(THEMES.indexOf(store.get('theme', 'auto')) + 1) % THEMES.length];
  store.set('theme', next);
  applyTheme();
  $('#theme').setAttribute('aria-label', `Theme: ${THEME_NAMES[next]}`);
});
$('#view').addEventListener('click', () => {
  const next = store.get('view', 'rich') === 'rich' ? 'compact' : 'rich';
  store.set('view', next);
  applyTheme();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// ---------- wordmark: random glyphs settle into "Tailpipe", left to right ----------
const GLYPHS = '!<>_/\\[]{}=+*^?#$%&01abcdefxz';
const logoSlots = (() => {
  const mk = c => h('span', { class: 'ch', 'aria-hidden': 'true' }, c);
  const dev = [...'Tail'].map(mk), feed = [...'pipe'].map(mk);
  $('#logo').replaceChildren(...dev, h('span', { class: 'feed' }, ...feed));
  return [...dev, ...feed].map(el => ({ el, final: el.textContent }));
})();
let scrambleTimer;
function scramble() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  clearInterval(scrambleTimer);
  const settleAt = logoSlots.map((_, i) => 6 + i * 3 + Math.floor(Math.random() * 3)); // in ticks
  let tick = 0;
  scrambleTimer = setInterval(() => {
    tick++;
    logoSlots.forEach((s, i) => {
      const done = tick >= settleAt[i];
      s.el.textContent = done ? s.final : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      s.el.classList.toggle('wild', !done);
    });
    if (tick >= settleAt.at(-1)) clearInterval(scrambleTimer);
  }, 45);
}

// ---------- boot ----------
$('#refresh').addEventListener('click', () => { scramble(); reset(); });
scramble();
const syncOffline = () => { $('#offline').hidden = navigator.onLine; };
addEventListener('online', syncOffline);
addEventListener('offline', syncOffline);
syncOffline();
renderChips();
reset();
io.observe($('#sentinel'));

if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js', { scope: './' });
  // A new deploy takes over immediately; reload once so the page matches the new shell.
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) location.reload(); });
}
