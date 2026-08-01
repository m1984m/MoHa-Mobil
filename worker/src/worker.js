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
 * Vse drugo vrne 404. Namerno: Worker ni splošen odprt proxy — brez tega bi ga
 * lahko kdorkoli uporabil za poljubne zahteve na tvoj račun.
 */

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
    h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
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
    return new Response(mem, {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Proxy-Cache': 'HIT-MEM', ...cors },
    });
  }

  const cacheKey = new Request(cacheKeyUrl, { method: 'GET' });
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) {
    const r = new Response(hit.body, hit);
    r.headers.set('X-Proxy-Cache', 'HIT');
    for (const [k, v] of Object.entries(cors)) r.headers.set(k, v);
    return r;
  }

  let res;
  try {
    res = await fetchUpstream(upstream.toString(), {
      headers: { 'Accept': 'application/json', 'User-Agent': 'MoHaMobil/1.0 (+github.com/m1984m/MoHa-Mobil)' },
    });
  } catch (e) {
    return json({ error: 'upstream unreachable', detail: String(e?.name ?? e) }, 502, cors);
  }
  if (!res.ok) return json({ error: 'upstream ' + res.status }, 502, cors);

  const body = await res.text();
  const out = new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${ttl}`,
      'X-Proxy-Cache': 'MISS',
    },
  });
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
    return json({ error: 'upstream unreachable', detail: String(e?.name ?? e) }, 502, cors);
  }

  const body = await res.text();
  const out = new Response(body, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/json' },
  });
  for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
  return out;
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
      }, 200, cors);
    }

    if (!isAllowedOrigin(request, env)) return json({ error: 'origin not allowed' }, 403, cors);

    if (path.startsWith('/oba/')) return handleOba(request, env, ctx, path, cors);
    if (path.startsWith('/ors/')) return handleOrs(request, env, ctx, path, cors);

    return json({ error: 'not found' }, 404, cors);
  },
};
