/* YouTube Danmaku Player, service worker.
   Bump VERSION on each deploy to invalidate old caches. */
const VERSION = '__BUILD__';   // stamped with the git commit SHA by Netlify at deploy (see netlify.toml)
const SHELL = 'shell-' + VERSION;
const RUNTIME = 'runtime-' + VERSION;

/* Relative to the worker's location, so the app works from a subpath
   (e.g. GitHub Pages project sites) as well as a domain root. */
const APP_SHELL = [
  './', 'index.html', 'styles.css',
  'favicon.svg', 'manifest.webmanifest',
  'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png',
  'app/main.js',
  'app/core/util.js', 'app/core/state.js', 'app/core/yt.js',
  'app/ui/landing.js', 'app/ui/settings.js', 'app/ui/copy.js',
  'app/views/player.js', 'app/views/list.js', 'app/views/danmaku.js',
];

/* Never cache YouTube: the Data API must stay fresh (and errors must not stick),
   and the player loads its own resources. */
const NO_CACHE = /(^|\.)googleapis\.com$|(^|\.)youtube\.com$|(^|\.)ytimg\.com$|(^|\.)ggpht\.com$|(^|\.)googlevideo\.com$/;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (NO_CACHE.test(url.hostname)) return;

  if (url.origin === location.origin) {
    /* App shell: network-first so deploys propagate, cache as offline fallback. */
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(RUNTIME).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html')))
    );
    return;
  }

  /* Fonts + icon CSS from CDNs: cache-first, they are versioned URLs. */
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(RUNTIME).then((c) => c.put(req, copy)); }
      return res;
    }))
  );
});
