/**
 * MoHa Mobil — rezervni posrednik za Marpromov OBA (Vercel, regija arn1 Stockholm)
 *
 * Isto kot relay/oba-relay.ts (Deno Deploy), le na drugem ponudniku: Worker ga
 * kliče, kadar Deno odpove ali porabi kvoto (septembra 2026 se je zgodilo po
 * dveh dneh). Marprom tiho zavrže promet s Cloudflara in tudi z AWS Frankfurt
 * (fra1, izmerjeno 05.10.2026: 3/3 časovna omejitev), iz Stockholma (arn1) pa
 * odgovori v 0,1–0,4 s — zato je regija v vercel.json zaklenjena na arn1.
 *
 * NEUMNA cev: preverjanje izvorov, CORS in predpomnjenje za odjemalce ostanejo
 * v Workerju. Tu samo skupna skrivnost (x-relay-key), tri dovoljene metode in
 * kratek predpomnilnik v toplem primerku funkcije.
 *
 * ORS (12.10.2026): tudi openrouteservice tiho zavrže promet s Cloudflara, zato
 * posrednik nosi še pešpoti — POST na natanko dve poti (prepisa v vercel.json
 * ju pripeljeta sem kot ?ors=directions | matrix), telo in ključ ORS (glava
 * x-ors-key) pošlje Worker. Odgovor ORS gre nazaj nespremenjen, brez
 * predpomnjenja, z oznako X-Relay-Ors.
 */

const OBA_BASE = 'https://vozniredi.marprom.si/OBA';
const ORS_BASE = 'https://api.openrouteservice.org/v2';

// Ime iz prepisa → pot pri ORS. Map: nič drugega (tudi podedovana imena) ne gre skozi.
const ORS_POTI = new Map([
  ['directions', '/directions/foot-walking/geojson'],
  ['matrix', '/matrix/foot-walking'],
]);
const ORS_NAJVEC_TELO = 8 * 1024; // enako kot MAX_ORS_BODY v Workerju
// Worker da posredniku pri ORS vsaj 2,35 s (preostanek do 5,5 s, razdeljen med
// posrednike); posrednik mora odnehati prej, da Worker pravočasno gre naprej.
const ORS_TIMEOUT_MS = 2000;

// Enako kot v Deno posredniku: metoda → koliko sekund sme odgovor ležati tu.
const METHODS = {
  GetLines: 21600,
  GetActiveDeviceDetails: 15,
  GetArrivalsForStopPoint: 8,
};

// Worker čaka na posrednika 4 s in po 0,8 s isti klic pošlje še drugemu
// posredniku. Posrednik mora zato odnehati prej (tudi z 502), da Worker izve za
// napako, preden prekine sam. Iz arn1 Marprom odgovori v 0,1–0,4 s.
const UPSTREAM_TIMEOUT_MS = 3500;

const cache = new Map();

// Primerjava ključa, ki po času izvajanja ne izda, koliko znakov se ujema
// (enako kot enakaKljuca v worker/src/stat.js).
function enakaKljuca(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Marprom tudi napako vrne s statusom 200 in jo zapiše v telo
// ({"Response":{"Status":-1,...}}). Enako kot razvrstiOdgovor v worker/src/oba.js:
//   'ok'      Status 1 (pri GetLines še neprazen seznam linij) — gre v predpomnilnik
//   'prazno'  živa metoda s Status -1: ni podatkov (ponoči pravilno) — gre naprej,
//             a NE v predpomnilnik; kako dolgo ga hraniti, odloči Worker
//   'neznano' Status ni ne 1 ne -1 — 502 z X-Relay-Razlog: neznano, da Worker to
//             v statistiki pokaže posebej
//   'napaka'  HTML, prazno ali neveljavno telo, GetLines brez Status 1 — 502
function razvrsti(method, body) {
  let j;
  try { j = JSON.parse(body); } catch { return 'napaka'; }
  const status = j && j.Response ? j.Response.Status : undefined;
  if (status === 1) {
    if (method === 'GetLines' && !(Array.isArray(j.Lines) && j.Lines.length > 0)) return 'napaka';
    return 'ok';
  }
  if (status === -1) return method !== 'GetLines' ? 'prazno' : 'napaka';
  return status === undefined ? 'napaka' : 'neznano';
}

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) { cache.delete(key); return null; }
  return hit.body;
}

function cachePut(key, body, ttlSec) {
  if (cache.size > 600) cache.clear();
  cache.set(key, { body, exp: Date.now() + ttlSec * 1000 });
}

function json(res, status, data, extra = {}) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  res.status(status).send(JSON.stringify(data));
}

// Telo zahteve kot besedilo. Vercelovi pomočniki (privzeto vklopljeni) tok preberejo
// že pred klicem funkcije in JSON razčlenijo v req.body; brez njih beremo tok sami.
async function beriTelo(req) {
  const b = req.body;
  if (typeof b === 'string') return b;
  if (Buffer.isBuffer(b)) return b.toString('utf8');
  if (b && typeof b === 'object') return JSON.stringify(b);
  const deli = [];
  let n = 0;
  for await (const d of req) {
    n += d.length;
    if (n > ORS_NAJVEC_TELO) throw new RangeError('body too large');
    deli.push(Buffer.from(d));
  }
  return Buffer.concat(deli).toString('utf8');
}

// POST ?ors=<ime> → ORS. Status, telo in Content-Type gredo nazaj nespremenjeni;
// oznaka X-Relay-Ors Workerju pove, da je odgovor dal ORS (tudi 4xx) in ne
// posrednik. Ključa ORS posrednik ne hrani in ne beleži — pride z vsako zahtevo.
async function orsNaprej(req, res, ime) {
  const pot = ORS_POTI.get(ime);
  if (!pot) return json(res, 404, { error: 'unknown endpoint' });
  const orsKljuc = req.headers['x-ors-key'];
  if (typeof orsKljuc !== 'string' || !orsKljuc) return json(res, 400, { error: 'missing x-ors-key' });
  if (Number(req.headers['content-length'] ?? 0) > ORS_NAJVEC_TELO) return json(res, 413, { error: 'body too large' });
  let telo;
  try {
    telo = await beriTelo(req);
  } catch (e) {
    // RangeError: tok brez Content-Length je presegel mejo; sicer neveljaven JSON
    // (pomočniki Vercela ob branju req.body vržejo).
    return e instanceof RangeError ? json(res, 413, { error: 'body too large' }) : json(res, 400, { error: 'bad body' });
  }
  if (telo.length > ORS_NAJVEC_TELO) return json(res, 413, { error: 'body too large' });

  let r, body;
  try {
    r = await fetch(ORS_BASE + pot, {
      method: 'POST',
      headers: { Authorization: orsKljuc, 'Content-Type': 'application/json', Accept: 'application/json, application/geo+json' },
      body: telo,
      signal: AbortSignal.timeout(ORS_TIMEOUT_MS),
    });
    body = await r.text(); // še pod isto mejo časa
  } catch (e) {
    return json(res, 502, { error: 'upstream unreachable', detail: String(e?.name ?? e) });
  }
  res.setHeader('Content-Type', r.headers.get('content-type') ?? 'application/json');
  res.setHeader('X-Relay-Ors', '1');
  return res.status(r.status).send(body);
}

export default async function handler(req, res) {
  const RELAY_KEY = process.env.RELAY_KEY ?? '';
  const url = new URL(req.url, 'http://x');
  const method = url.searchParams.get('m') ?? '';
  const orsIme = url.searchParams.get('ors');

  if (method === '__health') return json(res, 200, { ok: true, keyConfigured: RELAY_KEY.length > 0, region: process.env.VERCEL_REGION });

  // OBA samo GET, ORS samo POST.
  if (req.method !== (orsIme !== null ? 'POST' : 'GET')) return json(res, 405, { error: 'method not allowed' });

  // Brez skupne skrivnosti bi bil to odprt proxy na Marpromov račun.
  if (!RELAY_KEY || !enakaKljuca(req.headers['x-relay-key'], RELAY_KEY)) return json(res, 403, { error: 'forbidden' });

  if (orsIme !== null) return orsNaprej(req, res, orsIme);

  // Object.hasOwn: podedovana imena (toString, constructor …) bi sicer prišla
  // mimo seznama metod in vsako bi pomenilo klic na Marprom.
  if (!Object.hasOwn(METHODS, method)) return json(res, 404, { error: 'unknown method' });
  const ttl = METHODS[method];

  const upstream = new URL(`${OBA_BASE}/${method}`);
  if (method === 'GetArrivalsForStopPoint') {
    const id = url.searchParams.get('stopPointId') ?? '';
    if (!/^\d{1,7}$/.test(id)) return json(res, 400, { error: 'bad stopPointId' });
    upstream.searchParams.set('stopPointId', id);
  }

  const key = upstream.toString();
  const hit = cacheGet(key);
  if (hit !== null) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Relay-Cache', 'HIT');
    return res.status(200).send(hit);
  }

  let r;
  try {
    r = await fetch(key, {
      headers: { Accept: 'application/json', 'User-Agent': 'MoHaMobil/1.0 (+github.com/m1984m/MoHa-Mobil)' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (e) {
    return json(res, 502, { error: 'upstream unreachable', detail: String(e?.name ?? e) });
  }
  if (!r.ok) return json(res, 502, { error: 'upstream ' + r.status });

  // Branje telesa je še pod isto mejo časa; prekinitev tu ne sme uiti kot izjema.
  let body;
  try {
    body = await r.text();
  } catch (e) {
    return json(res, 502, { error: 'upstream unreachable', detail: String(e?.name ?? e) });
  }
  const vrsta = razvrsti(method, body);
  if (vrsta === 'napaka') return json(res, 502, { error: 'invalid upstream body' });
  if (vrsta === 'neznano') return json(res, 502, { error: 'unknown upstream status' }, { 'X-Relay-Razlog': 'neznano' });
  if (vrsta === 'ok') cachePut(key, body, ttl);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Relay-Cache', 'MISS');
  return res.status(200).send(body);
}
