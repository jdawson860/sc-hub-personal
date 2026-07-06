// S&C Hub — Service Worker v1
const CACHE = 'sc-hub-v1';
const PRECACHE = [
  '/sc-hub-personal/dashboard/dashboard.html',
  '/sc-hub-personal/dashboard/logger.html',
  '/sc-hub-personal/manifest.json',
  '/sc-hub-personal/icon-180.png',
  '/sc-hub-personal/icon-192.png',
  '/sc-hub-personal/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first strategy — always try live, fall back to cache
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (!e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(e.request).then(res => {
      const resClone = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, resClone));
      return res;
    }).catch(() => caches.match(e.request))
  );
});
