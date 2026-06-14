// Cranbrook S&C Hub — Service Worker v1
const CACHE = 'crk-hub-v2';
const PRECACHE = [
  '/cranbrook-sc-hub/athlete.html',
  '/cranbrook-sc-hub/manifest.json',
  '/cranbrook-sc-hub/icon-180.png',
  '/cranbrook-sc-hub/icon-192.png',
  '/cranbrook-sc-hub/icon-512.png',
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
  // Only cache same-origin GET requests
  if (e.request.method !== 'GET') return;
  if (!e.request.url.startsWith(self.location.origin)) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
