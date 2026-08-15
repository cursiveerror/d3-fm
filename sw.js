const CACHE_NAME = 'd3fm-v1.4';
const ASSETS = [
  './',
  './index.html',
  './assets/style.css',
  './assets/app.js',
  './manifest.json',
  './assets/logo.svg',
  './assets/favicon.svg',
  './assets/logo-black.svg',
  './assets/vinyl.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Only intercept same-origin requests to allow Radio-Browser API to work normally
  if (e.request.url.startsWith(self.location.origin)) {
    e.respondWith(
      caches.match(e.request).then((response) => {
        return response || fetch(e.request);
      })
    );
  }
});
