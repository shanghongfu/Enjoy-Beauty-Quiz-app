/* Service Worker - Enjoy Beauty v47 — app.v2.js new path, force cache bypass */
const CACHE = 'enjoy-beauty-v47';

const ASSETS = [
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.v2.js',
  './js/i18n.js',
  './js/supabase-config.js',
  './js/jszip.min.js',
  './icons/logo.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(err => console.warn('[SW v47] addAll failed:', err))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    Promise.all([
      caches.keys().then(keys => Promise.all(keys.map(k => {
        console.log('[SW v47] Clearing cache:', k);
        return caches.delete(k);
      }))),
      self.clients.claim()
    ])
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then(r => {
      if (r) return r;
      return fetch(e.request).then(res => {
        if (!res || res.status !== 200 || res.type !== 'basic') return res;
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {});
        return res;
      });
    }).catch(() => caches.match('./index.html'))
  );
});
