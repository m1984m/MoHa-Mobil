/**
 * MoHa Mobil — proxy Worker
 *
 * Rešuje dve težavi hkrati:
 *   1. Marpromov OBA vmesnik (živa vozila, prihodi) ne pošilja CORS glav, zato ga
 *      brskalnik ne sme klicati neposredno. Aplikacija je zato uporabljala javna
 *      posrednika corsproxy.io / allorigins — odvisnost od tretje osebe.
 *   2. Ključ za openrouteservice (pešpoti) se je ob gradnji vstavil kot besedilo v
 *      JavaScript paket in je bil na javni strani berljiv za vsakogar.
 *
 * Worker je edina točka, ki gre navzven: OBA doda CORS in predpomnjenje, ORS pa
 * dobi ključ šele tu, na strežniku.
 *
 * Poti:
 *   GET  /oba/GetLines
 *   GET  /oba/GetActiveDeviceDetails
 *   GET  /oba/GetArrivalsForStopPoint?stopPointId=123
 *   POST /ors/directions/foot-walking/geojson
 *   POST /ors/matrix/foot-walking
 *   GET  /health
 *
 * Tretja naloga (dodano kasneje): alarm za odhod avtobusa. Telefon sme obvestilo
 * prikazati tudi, ko je aplikacija zaprta, samo prek potisne storitve brskalnika
 * — to pa zahteva strežnik, ki ob pravi minuti pošlje potisk. Zato:
 *   POST   /alarms/sync           shrani naročnino + čase zvonjenja
 *   DELETE /alarms/sync           pobriše naročnino
 *   GET    /alarms/status         stanje naročnine + javni ključ VAPID
 * in cron, ki se sproži vsako minuto (glej `scheduled` na dnu).
 *
 * Vse drugo vrne 404. Namerno: Worker ni splošen odprt proxy — brez tega bi ga
 * lahko kdorkoli uporabil za poljubne zahteve na tvoj račun.
 */

import { sendPush } from './push.js';
import { recordUpstream, handleEvent } from './analytics.js';
import { processDue } from './due.js';

// Marprom je dosegljiv NEPOSREDNO samo, kadar Worker nima nastavljenega OBA_RELAY.
// Od 16.09.2026 pozna Cloudflare do tega gostitelja samo tiho zavržene pakete
// (izmerjeno 20.09.2026: z domačega omrežja 200 v 0,11 s, s Cloudflarovega roba 522
// po 19,5 s, enako na vratih 80; gov.si in nap.si s Cloudflara delujeta, Google Cloud
// pa do Marproma pride). Zato gre OBA skozi posrednik na Deno Deploy, glej relay/.
// Ko Marprom odblokira Cloudflare, odstrani spremenljivko OBA_RELAY in vse teče spet
// neposredno — druge spremembe niso potrebne.
const OBA_BASE = 'https://vozniredi.marprom.si/OBA';
const ORS_BASE = 'https://api.openrouteservice.org/v2';

// Dovoljene OBA metode in koliko sekund sme odgovor ležati v predpomnilniku.
// GetLines se spremeni nekajkrat letno; pozicije vozil se osvežujejo ~1×/min,
// zato 20 s pokrije hkratne uporabnike, ne da bi podatek postal zastarel.
const OBA_METHODS = {
  GetLines: 21600,                 // 6 h
  GetActiveDeviceDetails: 20,
  GetArrivalsForStopPoint: 10,
};

// Dovoljeni ORS endpointi (natančno tisti, ki ju kliče aplikacija).
const ORS_PATHS = new Set([
  '/directions/foot-walking/geojson',
  '/matrix/foot-walking',
]);

const MAX_ORS_COORDS = 30;      // matrix pošlje izhodišče + do 25 postaj
const MAX_ORS_BODY = 8 * 1024;  // 8 kB je za te zahteve več kot dovolj
const UPSTREAM_TIMEOUT_MS = 9000;

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

// Vrne glave CORS samo za znane izvore. Neznanemu izvoru ne vrnemo
// Access-Control-Allow-Origin — brskalnik odgovor zavrže.
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const list = allowedOrigins(env);
  const h = { 'Vary': 'Origin' };
  if (origin && list.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'GET, POST, DELETE, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Content-Type';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}

function json(obj, status, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });
}

// Zahteva mora imeti znan Origin. Brskalnik ga pri klicu na tujo domeno vedno
// pošlje, zato to aplikacije ne prizadene — prepreči pa, da bi kdo s `curl`
// brez glave Origin uporabljal Worker (in tvojo ORS kvoto) mimo omejitev.
function isAllowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  return allowedOrigins(env).includes(origin);
}

// Predpomnilnik v pomnilniku izolata. Cloudflare Cache API (`caches.default`) na
// domenah *.workers.dev NE deluje — to je dokumentirana omejitev. Ta Map zato
// poskrbi za združevanje sunkov tudi brez lastne domene; z lastno domeno pa
// spodnji Cache API prevzame delo med izolati in med lokacijami.
const memCache = new Map(); // url -> { body, exp }

function memGet(key) {
  const hit = memCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) { memCache.delete(key); return null; }
  return hit.body;
}

function memPut(key, body, ttlSec) {
  // Zgornja meja vnosov, da izolat ne raste v nedogled (postaj je ~460).
  if (memCache.size > 600) memCache.clear();
  memCache.set(key, { body, exp: Date.now() + ttlSec * 1000 });
}

async function fetchUpstream(url, init = {}) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
}

// ── OBA ───────────────────────────────────────────────────────────────────────
async function handleOba(request, env, ctx, path, cors) {
  const method = path.replace(/^\/oba\//, '');
  const ttl = OBA_METHODS[method];
  if (ttl === undefined) return json({ error: 'unknown method' }, 404, cors);

  // Stetje gre skozi isto pot kot odgovor; `stej` se poklice pri vsakem izhodu.
  const zacetek = Date.now();
  const drzava = (request.cf && request.cf.country) || '';
  const stej = (izid, status, preko) => recordUpstream(env, {
    storitev: 'oba', metoda: method, izid, status, preko, drzava, ms: Date.now() - zacetek,
  });

  const inUrl = new URL(request.url);
  const upstream = new URL(`${OBA_BASE}/${method}`);

  // Prepišemo samo pričakovane parametre — nič drugega ne gre naprej.
  if (method === 'GetArrivalsForStopPoint') {
    const id = inUrl.searchParams.get('stopPointId');
    if (!/^\d{1,7}$/.test(id ?? '')) return json({ error: 'bad stopPointId' }, 400, cors);
    upstream.searchParams.set('stopPointId', id);
  }

  // Ključ predpomnilnika je upstream URL, zato si zadetek delijo vsi uporabniki:
  // ob 50 hkratnih uporabnikih Marprom dobi 1 zahtevo na 20 s namesto 50.
  const cacheKeyUrl = upstream.toString();

  const mem = memGet(cacheKeyUrl);
  if (mem !== null) {
    stej('cache', 200, 'mem');
    return new Response(mem, {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Proxy-Cache': 'HIT-MEM', ...cors },
    });
  }

  const cacheKey = new Request(cacheKeyUrl, { method: 'GET' });
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) {
    stej('cache', 200, 'edge');
    const r = new Response(hit.body, hit);
    r.headers.set('X-Proxy-Cache', 'HIT');
    for (const [k, v] of Object.entries(cors)) r.headers.set(k, v);
    return r;
  }

  // Kljub posredniku ostane ključ predpomnilnika Marpromov naslov: ob menjavi ali
  // odstranitvi posrednika shranjeni odgovori ostanejo veljavni.
  const relay = String(env.OBA_RELAY ?? '').replace(/\/$/, '');
  let fetchUrl = upstream.toString();
  const fetchHeaders = {
    'Accept': 'application/json',
    'User-Agent': 'MoHaMobil/1.0 (+github.com/m1984m/MoHa-Mobil)',
  };
  if (relay) {
    const viaRelay = new URL(relay + '/oba/' + method);
    for (const [k, v] of upstream.searchParams) viaRelay.searchParams.set(k, v);
    fetchUrl = viaRelay.toString();
    fetchHeaders['x-relay-key'] = String(env.RELAY_KEY ?? '');
  }

  let res;
  try {
    res = await fetchUpstream(fetchUrl, { headers: fetchHeaders });
  } catch (e) {
    stej('nedosegljiv', 502, relay ? 'relay' : 'direct');
    return json({ error: 'upstream unreachable', detail: String(e?.name ?? e), via: relay ? 'relay' : 'direct' }, 502, cors);
  }
  if (!res.ok) {
    stej('napaka', res.status, relay ? 'relay' : 'direct');
    return json({ error: 'upstream ' + res.status, via: relay ? 'relay' : 'direct' }, 502, cors);
  }

  const body = await res.text();
  const out = new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${ttl}`,
      'X-Proxy-Cache': 'MISS',
    },
  });
  stej('ok', 200, relay ? 'relay' : 'direct');
  memPut(cacheKeyUrl, body, ttl);
  // Shrani v predpomnilnik brez blokiranja odgovora uporabniku. Na *.workers.dev
  // je to tiho brez učinka (glej opombo pri memCache) — zato zgornji memPut.
  ctx.waitUntil(cache.put(cacheKey, out.clone()));
  for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
  return out;
}

// ── ORS ───────────────────────────────────────────────────────────────────────
async function handleOrs(request, env, ctx, path, cors) {
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405, cors);
  if (!env.ORS_KEY) return json({ error: 'ORS_KEY ni nastavljen' }, 503, cors);

  const sub = path.replace(/^\/ors/, '');
  if (!ORS_PATHS.has(sub)) return json({ error: 'unknown endpoint' }, 404, cors);

  const raw = await request.text();
  if (raw.length > MAX_ORS_BODY) return json({ error: 'body too large' }, 413, cors);

  let payload;
  try { payload = JSON.parse(raw); } catch { return json({ error: 'bad json' }, 400, cors); }

  // Omejitev velikosti zahteve — brez tega bi lahko kdo z eno zahtevo
  // požrl dnevno kvoto ORS.
  const coords = payload.coordinates ?? payload.locations;
  if (!Array.isArray(coords) || coords.length < 2 || coords.length > MAX_ORS_COORDS) {
    return json({ error: 'bad coordinates' }, 400, cors);
  }
  for (const c of coords) {
    if (!Array.isArray(c) || c.length !== 2 || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) {
      return json({ error: 'bad coordinates' }, 400, cors);
    }
  }

  const zacetekOrs = Date.now();
  const drzavaOrs = (request.cf && request.cf.country) || '';
  const stejOrs = (izid, status) => recordUpstream(env, {
    storitev: 'ors', metoda: sub.replace(/^\//, ''), izid, status, preko: 'direct',
    drzava: drzavaOrs, ms: Date.now() - zacetekOrs,
  });

  let res;
  try {
    res = await fetchUpstream(`${ORS_BASE}${sub}`, {
      method: 'POST',
      headers: {
        'Authorization': env.ORS_KEY,   // ključ ostane tu, v paket ne gre nikoli
        'Content-Type': 'application/json',
        'Accept': 'application/json, application/geo+json',
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    stejOrs('nedosegljiv', 502);
    return json({ error: 'upstream unreachable', detail: String(e?.name ?? e) }, 502, cors);
  }
  stejOrs(res.ok ? 'ok' : 'napaka', res.status);

  const body = await res.text();
  const out = new Response(body, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/json' },
  });
  for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
  return out;
}

// ── Alarmi za odhod avtobusa ──────────────────────────────────────────────────
//
// Zakaj sploh strežnik: telefon sme obvestilo prikazati z zaprto aplikacijo samo
// prek potisne storitve brskalnika, `setTimeout` v zavihku pa umre takoj, ko
// uporabnik zavihek zapre. Odjemalec zato Workerju pove, KDAJ naj zazvoni, in
// Worker to enkrat na minuto preveri.

// Meje za POST /alarms/sync. Brez njih bi lahko kdo z eno zahtevo napolnil KV.
const ALARM_MAX_BODY = 256 * 1024;                  // 256 kB celotnega telesa
const ALARM_MAX_OCCURRENCES = 500;
const ALARM_MAX_AHEAD_MS = 120 * 24 * 3600 * 1000;  // 120 dni naprej
const ALARM_MAX_TEXT = 200;                         // znakov za title in body
const ALARM_MAX_ID = 100;
const ALARM_MAX_URL = 500;
const ALARM_MAX_ENDPOINT = 1000;

// Koliko zahtev na /alarms/* sme en naslov IP na uro. Odjemalec sinhronizira
// ob odprtju in ob spremembi alarma — 60 je zanj ogromno, za zlorabo pa nič.
const ALARM_RATE_LIMIT = 60;
const ALARM_RATE_WINDOW_S = 3600;

// Naročnina, ki je nihče ne osveži, po tem času sama izgine iz KV — sicer bi se
// zapisi odjavljenih naprav nabirali za vedno. 130 dni je okno zvonjenj (120)
// plus rezerva.
const ALARM_SUB_TTL_S = 130 * 24 * 3600;

// Meji enega zagona crona. Worker ima omejen čas izvajanja; raje pustimo ostanek
// naslednji minuti, kot da nas okolje prekine sredi pisanja v KV.
const CRON_MAX_SENDS = 200;
const CRON_MAX_MS = 25_000;

// Endpoint naročnine sme kazati samo na znano potisno storitev. Brez tega bi bil
// /alarms/sync orodje, s katerim bi kdorkoli pošiljal poljubne zahteve z naslova
// Cloudflara (in v tvojem imenu).
const PUSH_HOSTS = [
  'push.services.mozilla.com',    // Firefox
  'fcm.googleapis.com',           // Chrome, Brave, Opera, novi Edge
  'android.googleapis.com',       // starejši Chrome
  'notify.windows.com',           // Windows / stari Edge (WNS)
  'push.services.microsoft.com',
  'push.apple.com',               // Safari — web.push.apple.com in regijske različice
];

function isKnownPushHost(host) {
  return PUSH_HOSTS.some(h => host === h || host.endsWith('.' + h));
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Ključ v KV je izpeljan iz endpointa, ne naključen: odjemalec lahko isto
// naročnino pove večkrat, pa ne nastane podvojen zapis. Endpoint sam v ključu ne
// leži (vsebuje žeton naprave), 32 šestnajstiških znakov = 128 bitov je proti
// trkom več kot dovolj.
async function subIdFor(endpoint) {
  return (await sha256Hex(endpoint)).slice(0, 32);
}

const B64URL = /^[A-Za-z0-9_-]+$/;

/** Vrne besedilo napake ali null, če je naročnina v redu. */
function validateSubscription(sub) {
  if (!sub || typeof sub !== 'object') return 'manjka subscription';
  if (typeof sub.endpoint !== 'string' || !sub.endpoint || sub.endpoint.length > ALARM_MAX_ENDPOINT) {
    return 'neveljaven endpoint';
  }
  let u;
  try { u = new URL(sub.endpoint); } catch { return 'endpoint ni veljaven URL'; }
  if (u.protocol !== 'https:') return 'endpoint mora biti https';
  if (!isKnownPushHost(u.hostname)) return 'endpoint ni znana potisna storitev';

  const k = sub.keys;
  if (!k || typeof k !== 'object') return 'manjkajo keys';
  // p256dh je 65 B nestisnjene točke P-256 → 87–88 znakov base64url,
  // auth je 16 B skrivnosti → 22–24 znakov.
  if (typeof k.p256dh !== 'string' || k.p256dh.length < 87 || k.p256dh.length > 88 || !B64URL.test(k.p256dh)) {
    return 'neveljaven p256dh';
  }
  if (typeof k.auth !== 'string' || k.auth.length < 22 || k.auth.length > 24 || !B64URL.test(k.auth)) {
    return 'neveljaven auth';
  }
  return null;
}

/** Vrne `{ list }` ali `{ error }`. Prepiše samo znana polja — nič drugega v KV ne gre. */
function validateOccurrences(arr, now) {
  if (!Array.isArray(arr)) return { error: 'occurrences mora biti polje' };
  if (arr.length > ALARM_MAX_OCCURRENCES) {
    return { error: 'preveč vnosov (največ ' + ALARM_MAX_OCCURRENCES + ')' };
  }
  const out = [];
  let skipped = 0;
  for (const o of arr) {
    if (!o || typeof o !== 'object') return { error: 'vnos ni objekt' };
    const fireAt = Number(o.fireAt);
    if (!Number.isFinite(fireAt)) return { error: 'fireAt ni število' };
    if (fireAt > now + ALARM_MAX_AHEAD_MS) return { error: 'fireAt je več kot 120 dni naprej' };
    // Pretekel vnos tiho preskočimo in ga ne štejemo. Odjemalec te tekme ne more
    // dobiti — vnos lahko poteče med letom zahteve — zavrnitev celotne
    // sinhronizacije pa bi pomenila, da naprava zaradi enega poteklega alarma
    // izgubi tudi vse veljavne.
    if (fireAt <= now) { skipped++; continue; }
    if (typeof o.id !== 'string' || !o.id || o.id.length > ALARM_MAX_ID) return { error: 'neveljaven id' };
    if (typeof o.title !== 'string' || o.title.length > ALARM_MAX_TEXT) return { error: 'neveljaven title' };
    if (typeof o.body !== 'string' || o.body.length > ALARM_MAX_TEXT) return { error: 'neveljaven body' };
    if (o.tag !== undefined && (typeof o.tag !== 'string' || o.tag.length > ALARM_MAX_ID)) {
      return { error: 'neveljaven tag' };
    }
    if (o.url !== undefined && (typeof o.url !== 'string' || o.url.length > ALARM_MAX_URL)) {
      return { error: 'neveljaven url' };
    }
    out.push({ id: o.id, fireAt, title: o.title, body: o.body, tag: o.tag || o.id, url: o.url || '' });
  }
  out.sort((a, b) => a.fireAt - b.fireAt);
  return { list: out, skipped };
}

// Seznama naročnin NE vzdržujemo sami. Prejšnja različica je imela polje id-jev
// pod ključem `index`, a KV nima transakcij: cron je indeks prebral na začetku
// in na koncu zapisal svojo različico, s čimer je vsako napravo, ki se je
// sinhronizirala med tekom, izbrisal iz seznama. Njen `sub:<id>` je ostal v KV,
// cron je ni pogledal nikoli več, `/alarms/status` pa je še vedno javljal
// `subscribed: true` — alarm je tiho obmolknil in se ni popravil sam.
// Delovni seznam zato dobimo iz `ALARMS_KV.list({ prefix: 'sub:' })`, ki je
// vedno popoln in ga ni treba vzdrževati.

// Števec na hashiran IP z eno urno okno. Shranjen je samo števec in samo uro —
// nič, kar bi napravo prepoznalo, ne preživi okna. Napaka KV nikoli ne zavrne
// zahteve: omejevalnik je varovalo, ne funkcija, na katero se odjemalec zanaša.
async function alarmRateLimited(request, env) {
  try {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const hour = Math.floor(Date.now() / (ALARM_RATE_WINDOW_S * 1000));
    const key = 'rl:' + (await sha256Hex(ip + ':' + hour)).slice(0, 16);
    const current = Number(await env.ALARMS_KV.get(key)) || 0;
    if (current >= ALARM_RATE_LIMIT) return true;
    await env.ALARMS_KV.put(key, String(current + 1), { expirationTtl: ALARM_RATE_WINDOW_S });
    return false;
  } catch {
    return false;
  }
}

async function alarmsSync(request, env, cors) {
  const raw = await request.text();
  if (raw.length > ALARM_MAX_BODY) return json({ error: 'body too large' }, 413, cors);

  let payload;
  try { payload = JSON.parse(raw); } catch { return json({ error: 'bad json' }, 400, cors); }

  const subErr = validateSubscription(payload && payload.subscription);
  if (subErr) return json({ error: subErr }, 400, cors);

  const now = Date.now();
  const occ = validateOccurrences(payload.occurrences, now);
  if (occ.error) return json({ error: occ.error }, 400, cors);

  const sub = payload.subscription;
  const id = await subIdFor(sub.endpoint);
  await env.ALARMS_KV.put('sub:' + id, JSON.stringify({
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    occurrences: occ.list,
    updatedAt: now,
  }), { expirationTtl: ALARM_SUB_TTL_S });

  return json({
    ok: true,
    count: occ.list.length,
    until: occ.list.length ? occ.list[occ.list.length - 1].fireAt : null,
  }, 200, cors);
}

async function alarmsUnsync(request, env, cors) {
  const raw = await request.text();
  if (raw.length > 4096) return json({ error: 'body too large' }, 413, cors);

  let payload;
  try { payload = JSON.parse(raw || '{}'); } catch { return json({ error: 'bad json' }, 400, cors); }

  const endpoint = payload && payload.endpoint;
  if (typeof endpoint !== 'string' || !endpoint || endpoint.length > ALARM_MAX_ENDPOINT) {
    return json({ error: 'manjka endpoint' }, 400, cors);
  }

  const id = await subIdFor(endpoint);
  await env.ALARMS_KV.delete('sub:' + id);

  // Odjava je idempotentna: da naročnine ni bilo, ni napaka — odjemalec, ki
  // odjavo ponovi po izpadu omrežja, ne sme dobiti napake.
  return json({ ok: true }, 200, cors);
}

/** Prebere zapis naročnine iz KV; vrne null, če ga ni ali je pokvarjen. */
async function readSub(env, id) {
  try {
    const doc = JSON.parse(await env.ALARMS_KV.get('sub:' + id) || 'null');
    return (doc && doc.endpoint && doc.keys) ? doc : null;
  } catch {
    return null;
  }
}

/**
 * Združi zvonjenja dveh zapisov brez podvajanja po `id`.
 * Ob istem `id` obvelja vnos iz zapisa z novejšim `updatedAt` — brskalnik je
 * med zamenjavo naročnine morda oba zapisa pustil za sabo, novejši pa nosi
 * tisto, kar je uporabnik nazadnje res nastavil.
 */
function mergeOccurrences(...docs) {
  const ordered = docs.filter(Boolean)
    .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0)); // novejši prvi
  const byId = new Map();
  for (const doc of ordered) {
    const occ = Array.isArray(doc.occurrences) ? doc.occurrences : [];
    for (const o of occ) {
      if (!o || typeof o.id !== 'string') continue;
      if (!byId.has(o.id)) byId.set(o.id, o);   // prvi videni (iz novejšega zapisa) obvelja
    }
  }
  return Array.from(byId.values())
    .sort((a, b) => (Number(a.fireAt) || 0) - (Number(b.fireAt) || 0))
    .slice(0, ALARM_MAX_OCCURRENCES);
}

/**
 * Brskalnik sme naročnino zamenjati sam (dogodek `pushsubscriptionchange` v
 * service workerju) — takrat je stari endpoint mrtev, uporabnik pa o tem ne ve
 * nič. Brez te poti bi mu alarmi tiho nehali zvoniti.
 */
async function alarmsResubscribe(request, env, cors) {
  const raw = await request.text();
  if (raw.length > ALARM_MAX_BODY) return json({ error: 'body too large' }, 413, cors);

  let payload;
  try { payload = JSON.parse(raw); } catch { return json({ error: 'bad json' }, 400, cors); }

  const subErr = validateSubscription(payload && payload.subscription);
  if (subErr) return json({ error: subErr }, 400, cors);

  // Manjkajoč ali neveljaven `oldEndpoint` NI napaka: service worker ga ob
  // `pushsubscriptionchange` pogosto ne more prebrati, ker je stara naročnina
  // že izginila. Takrat to obravnavamo kot navaden vpis nove naročnine —
  // zavrnitev bi pomenila, da naprava po rotaciji endpointa tiho obmolkne.
  const oldEndpoint = payload.oldEndpoint;
  const hasOld = typeof oldEndpoint === 'string' && oldEndpoint !== ''
    && oldEndpoint.length <= ALARM_MAX_ENDPOINT;

  const sub = payload.subscription;
  const newId = await subIdFor(sub.endpoint);
  const oldId = hasOld ? await subIdFor(oldEndpoint) : null;

  const newDoc = await readSub(env, newId);
  // Če je stari endpoint enak novemu, zapisa NE smemo izbrisati — brskalnik je
  // javil zamenjavo, ki naslova ni zares spremenila. Brisanje bi tu pomenilo
  // izgubo vseh alarmov.
  const oldDoc = (oldId && oldId !== newId) ? await readSub(env, oldId) : null;

  const occurrences = mergeOccurrences(newDoc, oldDoc);
  await env.ALARMS_KV.put('sub:' + newId, JSON.stringify({
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    occurrences,
    updatedAt: Date.now(),
  }), { expirationTtl: ALARM_SUB_TTL_S });

  if (oldDoc) await env.ALARMS_KV.delete('sub:' + oldId);

  // `moved` je true samo, kadar so zvonjenja res prišla z DRUGEGA, zdaj
  // izbrisanega zapisa — ne ob navadni posodobitvi istega endpointa.
  return json({ ok: true, moved: !!oldDoc, count: occurrences.length }, 200, cors);
}

async function alarmsStatus(request, env, cors) {
  const endpoint = new URL(request.url).searchParams.get('endpoint');

  // Brez parametra: odjemalec samo sprašuje po javnem ključu, ki ga potrebuje
  // za `pushManager.subscribe({ applicationServerKey })`.
  if (!endpoint) return json({ vapidPublic: env.VAPID_PUBLIC }, 200, cors);
  if (endpoint.length > ALARM_MAX_ENDPOINT) return json({ error: 'endpoint too long' }, 400, cors);

  const id = await subIdFor(endpoint);
  let doc = null;
  try { doc = JSON.parse(await env.ALARMS_KV.get('sub:' + id) || 'null'); } catch { doc = null; }
  const list = (doc && Array.isArray(doc.occurrences)) ? doc.occurrences : [];

  return json({
    subscribed: !!doc,
    count: list.length,
    until: list.length ? Math.max(...list.map(o => Number(o.fireAt) || 0)) : null,
    vapidPublic: env.VAPID_PUBLIC,
  }, 200, cors);
}

async function handleAlarms(request, env, ctx, path, cors) {
  if (!env.ALARMS_KV) return json({ error: 'ALARMS_KV ni vezan' }, 503, cors);
  // Zavrnemo tudi, kadar manjka SAMO zasebni ključ. Brez njega bi odjemalec
  // dobil `ok: true` in mislil, da so alarmi nastavljeni, cron pa ne bi mogel
  // poslati ničesar — med namestitvijo po README (javni ključ je v gitu,
  // skrivnost se nastavi posebej) je to povsem verjetno vmesno stanje.
  if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE) {
    return json({ error: 'VAPID ključa nista nastavljena' }, 503, cors);
  }

  // Branje stanja ne piše v KV in gre mimo omejevalnika.
  if (path === '/alarms/status' && request.method === 'GET') return alarmsStatus(request, env, cors);

  const mutating =
    (path === '/alarms/sync' && (request.method === 'POST' || request.method === 'DELETE')) ||
    (path === '/alarms/resubscribe' && request.method === 'POST');
  // Neznano pot zavrnemo PRED omejevalnikom — sicer bi vsaka smetna zahteva
  // pod /alarms stala eno pisanje v KV.
  if (!mutating) return json({ error: 'not found' }, 404, cors);

  // Omejevalnik teče samo pred spreminjajočimi zahtevami. Vsak njegov klic je
  // pisanje v KV, brezplačna meja pa je 1.000 pisanj na dan; če bi štel še
  // branja stanja in neznane poti, bi protizlorabni števec pojedel kvoto,
  // ki jo potrebujejo naročnine same.
  if (await alarmRateLimited(request, env)) return json({ error: 'preveč zahtev' }, 429, cors);

  if (path === '/alarms/sync' && request.method === 'POST') return alarmsSync(request, env, cors);
  if (path === '/alarms/sync' && request.method === 'DELETE') return alarmsUnsync(request, env, cors);
  return alarmsResubscribe(request, env, cors);
}

// ── Cron: pošlji, kar je zapadlo ──────────────────────────────────────────────

// Kaj dobi service worker kot JSON v dogodku `push`.
function alarmPayload(occ) {
  return {
    id: occ.id,
    title: occ.title || 'MoHa Mobil',
    body: occ.body || '',
    tag: occ.tag || occ.id,
    url: occ.url || '',
    fireAt: occ.fireAt,
  };
}

async function runDueAlarms(env) {
  if (!env.ALARMS_KV) { console.log('alarms cron: ALARMS_KV ni vezan — preskočeno'); return; }
  if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE) {
    console.log('alarms cron: manjka ključ VAPID — preskočeno');
    return;
  }

  const started = Date.now();
  const budget = { left: CRON_MAX_SENDS };
  let subs = 0, sent = 0, failed = 0, dropped = 0, expired = 0, removed = 0, errors = 0;
  let stopped = false;
  let cursor;

  // Delovni seznam beremo iz KV samega. `list` vrne strani po največ 1.000
  // ključev, zato se vrtimo, dokler je kaj naprej.
  strani:
  for (;;) {
    let page;
    try {
      page = await env.ALARMS_KV.list({ prefix: 'sub:', cursor });
    } catch (e) {
      errors++;
      break;
    }

    for (const entry of page.keys) {
      if (Date.now() - started > CRON_MAX_MS || budget.left <= 0) { stopped = true; break strani; }
      const key = entry.name;

      // Napaka KV pri eni naročnini ne sme ustaviti vseh preostalih. Vrstni red
      // ključev je stalen, zato bi sicer vsakič odpadli isti uporabniki.
      try {
        let doc = null;
        try { doc = JSON.parse(await env.ALARMS_KV.get(key) || 'null'); } catch { doc = null; }

        // Zapis je medtem potekel (TTL) — ni ga treba brisati, ga ni več.
        if (!doc) continue;
        // Zapis je pokvarjen: brez endpointa ali ključev z njim ni kaj početi.
        if (!doc.endpoint || !doc.keys) { await env.ALARMS_KV.delete(key); removed++; continue; }
        subs++;

        const res = await processDue(doc, Date.now(), (d, occ) =>
          sendPush({ endpoint: d.endpoint, keys: d.keys }, alarmPayload(occ), env), budget);

        sent += res.sent;
        failed += res.failed;
        dropped += res.dropped;
        expired += res.expired;

        if (res.dead) {
          // 404/410: naprava je odjavljena ali je naročnina potekla.
          await env.ALARMS_KV.delete(key);
          removed++;
          continue;
        }
        // Zapišemo nazaj samo ob dejanski spremembi — vsak put v KV nekaj stane.
        if (res.changed) {
          await env.ALARMS_KV.put(key, JSON.stringify({
            ...doc,
            occurrences: res.occurrences,
            updatedAt: Date.now(),
          }), { expirationTtl: ALARM_SUB_TTL_S });
        }
      } catch (e) {
        errors++;
        continue;
      }
    }

    if (page.list_complete || !page.cursor) break;
    cursor = page.cursor;
  }

  console.log(
    `alarms cron: naročnin=${subs} poslano=${sent} spodletelo=${failed} ` +
    `odpadlo=${dropped} zamujeno=${expired} odjavljenih=${removed} napakKV=${errors}` +
    `${stopped ? ' PREKINJENO(kvota/čas)' : ''} ${Date.now() - started}ms`);
}

// ── Vstopna točka ─────────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (path === '/health') {
      return json({
        ok: true,
        orsConfigured: !!env.ORS_KEY,
        allowedOrigins: allowedOrigins(env).length,
        obaVia: env.OBA_RELAY ? 'relay' : 'direct',
        relayKeyConfigured: !!env.RELAY_KEY,
        analytics: !!env.ANALYTICS,
      }, 200, cors);
    }

    if (!isAllowedOrigin(request, env)) return json({ error: 'origin not allowed' }, 403, cors);

    if (path === '/ev') return handleEvent(request, env, cors);
    if (path.startsWith('/oba/')) return handleOba(request, env, ctx, path, cors);
    if (path.startsWith('/ors/')) return handleOrs(request, env, ctx, path, cors);
    if (path.startsWith('/alarms/')) return handleAlarms(request, env, ctx, path, cors);

    return json({ error: 'not found' }, 404, cors);
  },

  // Cron (glej [triggers] v wrangler.toml): enkrat na minuto pošlje zapadla
  // obvestila. Delo gre v `waitUntil`, ker sme izvajanje teči tudi po vrnitvi
  // iz `scheduled`; `await` istega obljubka poskrbi, da napaka ne izgine tiho.
  async scheduled(event, env, ctx) {
    const work = runDueAlarms(env).catch(e => {
      console.log('alarms cron: nepričakovana napaka — ' + String(e && e.message ? e.message : e));
    });
    ctx.waitUntil(work);
    await work;
  },
};
