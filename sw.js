// MoHa Mobil — service worker
// Generated from scripts/sw.template.js by scripts/build-sw.mjs.
// Do not edit public/sw.js directly — edit this template instead.
//
// Strategy:
//   - GTFS JSON:    stale-while-revalidate (fast, updates in background)
//   - MapLibre tiles / basemap style: cache-first with fallback to network
//   - Same-origin static (html/js/css/svg): stale-while-revalidate
//   - Navigation (SPA): network-first, fallback to cached index.html

const VERSION = '0.6.0-e161cc6';
const APP_CACHE = `mm-app-${VERSION}`;
const GTFS_CACHE = `mm-gtfs-${VERSION}`;
const TILES_CACHE = `mm-tiles-${VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.svg',
  './icon-512.svg',
  './icon-maskable.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP_CACHE).then(c => c.addAll(APP_SHELL)).catch(() => {}));
  // Ne kličemo skipWaiting() avtomatsko — pustimo da uporabnik sam tapne "Osveži zdaj"
  // v UpdateToast. Če klienta ni (prva instalacija), se install in activate zgodita takoj.
});

// Prejmi ukaz iz strani: preklopi nov SW v active brez čakanja.
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => ![APP_CACHE, GTFS_CACHE, TILES_CACHE].includes(k)).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function staleWhileRevalidate(req, cacheName) {
  return caches.open(cacheName).then(async (cache) => {
    const cached = await cache.match(req);
    const net = fetch(req).then((resp) => {
      if (resp && resp.ok) cache.put(req, resp.clone());
      return resp;
    }).catch(() => cached);
    return cached || net;
  });
}

function cacheFirst(req, cacheName) {
  return caches.open(cacheName).then(async (cache) => {
    const cached = await cache.match(req);
    if (cached) return cached;
    const resp = await fetch(req);
    if (resp && resp.ok) cache.put(req, resp.clone());
    return resp;
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // SPA navigation
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // GTFS data
  if (url.pathname.includes('/gtfs/') && url.pathname.endsWith('.json')) {
    event.respondWith(staleWhileRevalidate(req, GTFS_CACHE));
    return;
  }

  // Basemap tiles and style (CARTO + Esri satelit)
  if (url.hostname.includes('basemaps.cartocdn.com') ||
      url.hostname.includes('server.arcgisonline.com')) {
    event.respondWith(cacheFirst(req, TILES_CACHE));
    return;
  }

  // OSRM hodilne poti — stale-while-revalidate (koristno offline za predhodno zahtevane poti)
  if (url.hostname === 'router.project-osrm.org') {
    event.respondWith(staleWhileRevalidate(req, APP_CACHE));
    return;
  }

  // Same-origin static assets
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req, APP_CACHE));
    return;
  }
});
