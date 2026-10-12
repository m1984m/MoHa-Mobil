// MoHa Mobil — service worker
// Generated from scripts/sw.template.js by scripts/build-sw.mjs.
// Do not edit public/sw.js directly — edit this template instead.
//
// Strategy:
//   - GTFS JSON z ?v= (različica voznega reda): cache-first, stare različice se počistijo
//   - meta.json / GTFS brez različice: stale-while-revalidate
//   - MapLibre tiles / basemap style: cache-first with fallback to network
//   - Same-origin static (html/js/css/svg): stale-while-revalidate
//   - Navigation (SPA): network-first, fallback to cached index.html

const VERSION = '__SW_VERSION__';
// Alarmi: SW nima dostopa do import.meta.env, zato vrednosti vstavi build-sw.mjs
// (iz process.env ob gradnji). Če nista nastavljeni, ostaneta prazna niza in
// obnovitev naročnine spodaj se tiho preskoči.
const VAPID_PUBLIC = '__VAPID_PUBLIC__';
const ALARM_API = '__ALARM_API__';
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
  // cache: 'reload' — mimo HTTP predpomnilnika brskalnika: GitHub Pages pošilja
  // max-age=600, zato je nov SW lahko shranil PREJŠNJI index.html, ki kaže na že
  // izbrisane datoteke; zagon brez povezave je dal prazno stran (pregled 12.10.2026).
  e.waitUntil(caches.open(APP_CACHE)
    .then(c => c.addAll(APP_SHELL.map(u => new Request(u, { cache: 'reload' }))))
    .catch(() => {}));
  // Ne kličemo skipWaiting() avtomatsko — pustimo da uporabnik sam tapne "Osveži zdaj"
  // v UpdateToast. Če klienta ni (prva instalacija), se install in activate zgodita takoj.
});

// Prejmi ukaz iz strani: preklopi nov SW v active brez čakanja. GET_VERSION: stran
// vpraša čakajoči SW za njegovo različico — obvestilo o posodobitvi je prej kazalo
// različico paketa, ki že teče, ne nove.
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data && e.data.type === 'GET_VERSION' && e.ports && e.ports[0]) e.ports[0].postMessage(VERSION);
  // Prvi obisk: paket in vozni red sta se naložila, preden je SW prevzel stran, zato ju ni
  // v predpomnilnikih in drugi zagon brez povezave je bil prazen. Stran pošlje svoje že
  // naložene datoteke (main.ts), shranimo samo pakete (/assets/) in vozni red (/gtfs/).
  if (e.data && e.data.type === 'CACHE_URLS' && Array.isArray(e.data.urls)) {
    e.waitUntil((async () => {
      const app = await caches.open(APP_CACHE);
      const gtfs = await caches.open(GTFS_CACHE);
      for (const u of e.data.urls.slice(0, 100)) {
        try {
          const url = new URL(u);
          if (url.origin !== self.location.origin) continue;
          const isGtfs = url.pathname.includes('/gtfs/') && url.pathname.endsWith('.json');
          if (!isGtfs && !url.pathname.includes('/assets/')) continue;
          const c = isGtfs ? gtfs : app;
          if (!(await c.match(url.href))) await c.add(url.href);
        } catch { /* ena datoteka ne sme ustaviti ostalih */ }
      }
    })());
  }
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => ![APP_CACHE, GTFS_CACHE, TILES_CACHE].includes(k)).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// `event` (neobvezno): osvežitev v ozadju gre pod waitUntil, da je brskalnik ne prekine,
// ko je odgovor iz predpomnilnika že vrnjen.
function staleWhileRevalidate(req, cacheName, event) {
  return caches.open(cacheName).then(async (cache) => {
    const cached = await cache.match(req);
    const net = fetch(req).then((resp) => {
      if (resp && resp.ok) return cache.put(req, resp.clone()).then(() => resp, () => resp);
      return resp;
    }).catch(() => cached);
    if (cached && event) event.waitUntil(net.catch(() => {}));
    return cached || net;
  });
}

// Vozni red z različico v naslovu (trips.json?v=…) se ne spreminja: najprej iz
// predpomnilnika. Ob prvem prenosu nove različice se stare različice iste datoteke
// izbrišejo, da predpomnilnik ne raste z vsako objavo.
function gtfsVersioned(req, event) {
  return caches.open(GTFS_CACHE).then(async (cache) => {
    const cached = await cache.match(req, { ignoreVary: true });
    if (cached) return cached;
    let resp = null;
    try { resp = await fetch(req); } catch { resp = null; }
    if (resp && resp.ok) {
      const path = new URL(req.url).pathname;
      event.waitUntil(cache.put(req, resp.clone()).then(async () => {
        for (const k of await cache.keys()) {
          const u = new URL(k.url);
          if (u.pathname === path && k.url !== req.url) await cache.delete(k);
        }
      }).catch(() => {}));
      return resp;
    }
    // Brez povezave: katerakoli shranjena različica iste datoteke. Star paket (index.html
    // iz predpomnilnika) po objavi novega voznega reda sicer ni naložil ničesar, ker je
    // nova različica staro že izbrisala (pregled 12.10.2026). Oblika podatkov je enaka.
    const any = await cache.match(req, { ignoreSearch: true, ignoreVary: true });
    if (any) return any;
    return resp || Response.error();
  });
}

// trimTo: mehka zgornja meja števila vnosov (FIFO — Cache API vrača keys v
// vrstnem redu vstavljanja). Brez nje tiles cache raste neomejeno.
// ignoreVary: datoteke z zgoščeno vsebino (/assets/, ploščice) so enake ne glede na glave
// zahteve. Brez tega strežnik z »Vary: Origin« (vite preview) ni ujel modulov, ki jih je SW
// shranil sam (CACHE_URLS, brez glave Origin) — zagon brez povezave je ostal prazen.
function cacheFirst(req, cacheName, trimTo) {
  return caches.open(cacheName).then(async (cache) => {
    const cached = await cache.match(req, { ignoreVary: true });
    if (cached) return cached;
    const resp = await fetch(req);
    if (resp && resp.ok) {
      cache.put(req, resp.clone());
      if (trimTo) trimCache(cache, trimTo); // fire-and-forget
    }
    return resp;
  });
}

async function trimCache(cache, max) {
  try {
    const keys = await cache.keys();
    if (keys.length <= max) return;
    for (const k of keys.slice(0, keys.length - max)) await cache.delete(k);
  } catch {}
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // SPA navigation
  // Uspešno naložen index.html (koren aplikacije) se shrani: zagon brez povezave tako
  // odpre zadnji paket, katerega datoteke so že v predpomnilniku, ne paketa ob namestitvi SW.
  if (req.mode === 'navigate') {
    const scopePath = new URL(self.registration.scope).pathname;
    const isRoot = url.pathname === scopePath || url.pathname === scopePath + 'index.html';
    event.respondWith(
      fetch(req).then((resp) => {
        if (isRoot && resp && resp.ok) {
          const copy = resp.clone();
          event.waitUntil(caches.open(APP_CACHE).then(c => c.put('./index.html', copy)).catch(() => {}));
        }
        return resp;
      }).catch(() => caches.match('./index.html', { ignoreVary: true }))
    );
    return;
  }

  // GTFS data
  if (url.pathname.includes('/gtfs/') && url.pathname.endsWith('.json')) {
    event.respondWith(url.searchParams.has('v')
      ? gtfsVersioned(req, event)
      : staleWhileRevalidate(req, GTFS_CACHE, event));
    return;
  }

  // Basemap tiles, style in glyph fonti (CARTO + Esri satelit + OpenMapTiles).
  // Glyphs prej niso bili pokriti → offline karta brez imen postaj in puščic.
  if (url.hostname.includes('basemaps.cartocdn.com') ||
      url.hostname.includes('server.arcgisonline.com') ||
      url.hostname === 'fonts.openmaptiles.org') {
    event.respondWith(cacheFirst(req, TILES_CACHE, 500));
    return;
  }

  // OSRM hodilne poti — stale-while-revalidate (koristno offline za predhodno zahtevane poti)
  if (url.hostname === 'router.project-osrm.org') {
    event.respondWith(staleWhileRevalidate(req, APP_CACHE));
    return;
  }

  // Hashirani build asseti (/assets/index-[hash].js) so immutable — cache-first.
  // SWR jih je ob vsakem zagonu po nepotrebnem re-prenašal (~430 KB gzip).
  if (url.origin === self.location.origin && url.pathname.includes('/assets/')) {
    event.respondWith(cacheFirst(req, APP_CACHE));
    return;
  }

  // Same-origin static assets
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req, APP_CACHE));
    return;
  }
});

// ── Alarmi za odhod (potisna obvestila) ──────────────────────────────────────

// Vse poti so relativne na scope registracije — v produkciji je to
// https://…/MoHa-Mobil/, zato absolutna '/pot' ne sme nikoli mimo.
function scopedUrl(path) {
  try {
    return new URL(String(path || './').replace(/^\/+/, '') || './', self.registration.scope).href;
  } catch {
    return self.registration.scope;
  }
}

function urlB64ToUint8Array(base64) {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// KV na Cloudflaru ni močno konsistenten: cron lahko do približno minute bere zastarel
// seznam in isto zvonjenje pošlje dvakrat. Na strežniku se tega brez Durable Objecta
// ne da odpraviti, zato ublažimo tu.
const STALE_MS = 2 * 60 * 1000;

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  if (!data || typeof data !== 'object') data = {};
  const tag = data.tag || 'mm-alarm';
  const url = data.url || './';
  // Zasilno besedilo: obvestilo brez vsebine je za uporabnika brez pomena,
  // brskalnik pa ob userVisibleOnly naročnini tako ali tako zahteva prikaz.
  let title = data.title || 'Čas za odhod';
  let body = data.body || 'Avtobus kmalu odpelje s tvoje postaje.';
  let vibrate = [200, 100, 200];

  // Brez fireAt (staro obvestilo v vrsti potisne storitve) se obnašamo kot doslej.
  const fireAt = Number(data.fireAt);
  const stale = isFinite(fireAt) && fireAt > 0 && Date.now() - fireAt > STALE_MS;
  if (stale) {
    // showNotification ni neobvezen — ob izpuščenem klicu brskalnik pokaže svoje
    // splošno obvestilo. Zato pokažemo kratko in pošteno: naslov pove, da je
    // opozorilo zamujeno, telo pa ohrani podatek o odhodu. Oznake linije ni kot
    // ločenega polja (Worker prepušča le id/fireAt/title/body/tag/url), izluščiti
    // je iz naslova pa ne gre zanesljivo — zato raje izvirno telo kot ugibanje.
    title = 'Zamujeno opozorilo';
    body = data.body || 'Opozorilo je prišlo prepozno.';
    vibrate = [];
  }

  event.waitUntil(self.registration.showNotification(title, {
    body,
    tag,
    // tag je unikaten na ponovitev, zato podvojeno zvonjenje samo tiho posodobi
    // obstoječe obvestilo namesto da bi zazvonilo še enkrat.
    renotify: false,
    icon: scopedUrl('./icon-192.svg'),
    badge: scopedUrl('./icon-maskable.svg'),
    vibrate,
    data: { url, fireAt: isFinite(fireAt) ? fireAt : null, stale },
    requireInteraction: false,
    // Privzeto že false; izrecno, da noben brskalnik opomnika ne prikaže tiho.
    silent: false,
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = scopedUrl((event.notification.data && event.notification.data.url) || './');
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (!c.url.startsWith(self.registration.scope)) continue;
      await c.focus();
      return;
    }
    await self.clients.openWindow(target);
  })());
});

// Brskalnik zna naročnino zavreči in jo zamenjati (rotacija endpointa). Takrat se
// naročimo znova in javimo strežniku; če to ne uspe, popravek ujame ensureSubscribed
// ob naslednjem zagonu aplikacije.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    if (!VAPID_PUBLIC) return;
    const oldEndpoint = (event.oldSubscription && event.oldSubscription.endpoint)
      || (event.newSubscription && event.newSubscription.endpoint)
      || null;
    try {
      let sub = await self.registration.pushManager.getSubscription();
      if (!sub) {
        sub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC),
        });
      }
      if (!ALARM_API || !sub) return;
      const j = sub.toJSON();
      await fetch(`${ALARM_API}/resubscribe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          oldEndpoint,
          subscription: { endpoint: j.endpoint, keys: j.keys },
        }),
      });
    } catch {}
  })());
});
