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
 */

const OBA_BASE = 'https://vozniredi.marprom.si/OBA';

// Enako kot v Deno posredniku: metoda → koliko sekund sme odgovor ležati tu.
const METHODS = {
  GetLines: 21600,
  GetActiveDeviceDetails: 15,
  GetArrivalsForStopPoint: 8,
};

const UPSTREAM_TIMEOUT_MS = 8000;

const cache = new Map();

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

export default async function handler(req, res) {
  const RELAY_KEY = process.env.RELAY_KEY ?? '';
  const url = new URL(req.url, 'http://x');
  const method = url.searchParams.get('m') ?? '';

  if (method === '__health') return json(res, 200, { ok: true, keyConfigured: RELAY_KEY.length > 0, region: process.env.VERCEL_REGION });

  if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });

  // Brez skupne skrivnosti bi bil to odprt proxy na Marpromov račun.
  if (!RELAY_KEY || req.headers['x-relay-key'] !== RELAY_KEY) return json(res, 403, { error: 'forbidden' });

  const ttl = METHODS[method];
  if (ttl === undefined) return json(res, 404, { error: 'unknown method' });

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

  const body = await r.text();
  cachePut(key, body, ttl);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Relay-Cache', 'MISS');
  return res.status(200).send(body);
}
