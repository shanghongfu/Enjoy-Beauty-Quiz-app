/* Service Worker - Enjoy Beauty v48 — network-first so code pushes propagate
   immediately, with cache fallback for offline. Bumps CACHE name to clear any
   stale app.js that earlier cache-first versions pinned. */
const CACHE = 'enjoy-beauty-v48';

const ASSETS = [
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/i18n.js',
  './js/supabase-config.js',
  './js/jszip.min.js',
  './js/bunny-config.js',
  './js/bunny.js',
  './js/video.js',
  './icons/logo.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(err => console.warn('[SW v48] addAll failed:', err))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => { if (k !== CACHE) return caches.delete(k); }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Let cross-origin (CDN) requests go straight to the network; only manage
  // our own same-origin assets.
  if (url.origin !== self.location.origin) return;

  e.respondWith((async () => {
    try {
      const res = await fetch(e.request);
      // Cache successful same-origin basic responses for offline use.
      if (res && res.status === 200 && res.type === 'basic') {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {});
      }
      return res;
    } catch (err) {
      const cached = await caches.match(e.request);
      if (cached) return cached;
      if (e.request.mode === 'navigate') {
        const offline = await caches.match('./index.html');
        if (offline) return offline;
      }
      throw err;
    }
  })());
});
