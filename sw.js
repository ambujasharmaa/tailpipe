// Bump VERSION on every deploy that changes a shell file, so clients pick up the new shell.
const VERSION = 'v5';
const SHELL_CACHE = `devfeed-shell-${VERSION}`;
const API_CACHE = 'devfeed-api';     // survives shell upgrades so offline still has a feed
const FONT_CACHE = 'devfeed-fonts';
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'sources.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];
const API_HOSTS = ['hacker-news.firebaseio.com', 'dev.to', 'api.github.com', 'huggingface.co'];

self.addEventListener('install', e => {
  // cache:'reload' bypasses the HTTP cache so a new deploy really fetches fresh files
  e.waitUntil(caches.open(SHELL_CACHE)
    .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys
      .filter(k => k.startsWith('devfeed-shell-') && k !== SHELL_CACHE)
      .map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function networkFirst(req) {
  const cache = await caches.open(API_CACHE);
  try {
    const res = await fetch(req);
    if (!res.ok) throw new Error(res.status);   // e.g. GitHub 403 rate limit -> use last good copy
    cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    // same-origin data snapshots (e.g. data/lobsters.json) are network-first, the shell is cache-first
    if (url.pathname.includes('/data/')) return e.respondWith(networkFirst(req));
    return e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req)));
  }
  if (API_HOSTS.includes(url.hostname)) return e.respondWith(networkFirst(req));
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONT_CACHE).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      c.put(req, res.clone());
      return res;
    }));
  }
});
