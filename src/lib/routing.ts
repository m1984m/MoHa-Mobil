// OpenRouteService foot-walking routing with in-memory cache + straight-line fallback.
// Free tier: 2000 directions/day, 500 matrix/day, 40 req/min.
// https://openrouteservice.org/dev/#/api-docs/v2
//
// Za razliko od javnega OSRM foot profila (ki včasih vodi pešce po hitri cesti/primary cestah),
// ORS foot-walking striktno preferira pešpoti, pločnike in tiha območja.

import { getWalkMps } from './settings';

type LL = { lat: number; lon: number };
export type WalkRoute = { coords: [number, number][]; meters: number; sec: number };

const ORS_KEY = (import.meta.env.VITE_ORS_KEY as string | undefined) ?? '';
const ORS_BASE = 'https://api.openrouteservice.org/v2';

const cache = new Map<string, WalkRoute>();
const key = (a: LL, b: LL, mps: number) => `${a.lat.toFixed(5)},${a.lon.toFixed(5)}|${b.lat.toFixed(5)},${b.lon.toFixed(5)}|${mps.toFixed(3)}`;

export async function walkRoute(from: LL, to: LL): Promise<WalkRoute> {
  const WALK_MPS = getWalkMps();
  const k = key(from, to, WALK_MPS);
  const hit = cache.get(k);
  if (hit) return hit;

  const straight: WalkRoute = {
    coords: [[from.lon, from.lat], [to.lon, to.lat]],
    meters: haversine(from, to),
    sec: haversine(from, to) / WALK_MPS,
  };

  if (straight.meters < 5) {
    cache.set(k, straight);
    return straight;
  }

  if (!ORS_KEY) {
    cache.set(k, straight);
    return straight;
  }

  try {
    const url = `${ORS_BASE}/directions/foot-walking/geojson`;
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(url, {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        'Authorization': ORS_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json, application/geo+json',
      },
      body: JSON.stringify({
        coordinates: [[from.lon, from.lat], [to.lon, to.lat]],
      }),
    });
    clearTimeout(tm);
    if (!r.ok) throw new Error('ors ' + r.status);
    const j = await r.json();
    const feat = j?.features?.[0];
    const coords = feat?.geometry?.coordinates as [number, number][] | undefined;
    const summary = feat?.properties?.summary;
    if (!coords?.length || !summary) throw new Error('empty');
    const wr: WalkRoute = {
      coords,
      meters: Math.round(summary.distance),
      sec: Math.round(summary.distance / WALK_MPS),
    };
    cache.set(k, wr);
    return wr;
  } catch {
    cache.set(k, straight);
    return straight;
  }
}

function haversine(a: LL, b: LL): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ORS /matrix — od enega izhodišča do N ciljev v enem klicu.
// Uporablja se za pre-fetch realnih časov hoje od izhodišča do bližnjih postaj
// pred izvedbo RAPTOR algoritma — da planer izbere pravo prvo postajo, ne le
// zračno najbližje (rešuje problem hoje čez reko, železnico, itd.).
const matrixCache = new Map<string, { sec: number; meters: number }>();
const mKey = (a: LL, b: LL) => `${a.lat.toFixed(5)},${a.lon.toFixed(5)}|${b.lat.toFixed(5)},${b.lon.toFixed(5)}`;

// Priročen helper za planer: za dano točko vrne map stopId -> {sec,meters}
// samo za N najbližjih postaj v radiju (privzeto 1200 m — ujema se z MAX_ACCESS_M).
// ORS /matrix se pokliče le za te izbrance (ne za vse postaje v mestu).
export async function walkMapForStops(
  from: LL,
  stops: { id: number; lat: number; lon: number }[],
  radiusM = 1200,
  maxN = 25,
): Promise<Map<number, { sec: number; meters: number }>> {
  const within = stops
    .map(s => ({ s, m: haversine(from, s) }))
    .filter(x => x.m <= radiusM)
    .sort((a, b) => a.m - b.m)
    .slice(0, maxN);
  if (within.length === 0) return new Map();
  const res = await walkMatrix(from, within.map(x => x.s));
  const out = new Map<number, { sec: number; meters: number }>();
  within.forEach((x, i) => { const v = res[i]; if (v) out.set(x.s.id, v); });
  return out;
}

export async function walkMatrix(from: LL, tos: LL[]): Promise<({ sec: number; meters: number } | null)[]> {
  const WALK_MPS = getWalkMps();
  const out: ({ sec: number; meters: number } | null)[] = tos.map(t => matrixCache.get(mKey(from, t)) ?? null);
  const missing: number[] = [];
  for (let i = 0; i < out.length; i++) if (!out[i]) missing.push(i);
  if (missing.length === 0) return out;
  if (!ORS_KEY) return out;

  // ORS matrix dovoli do ~50 lokacij naenkrat, a za zanesljivost sekamo po 25 destinacij.
  const CHUNK = 25;
  for (let s = 0; s < missing.length; s += CHUNK) {
    const slice = missing.slice(s, s + CHUNK);
    const dests = slice.map(i => tos[i]);
    const locations = [from, ...dests].map(p => [p.lon, p.lat]);
    const destIdx = dests.map((_, i) => i + 1);
    try {
      const url = `${ORS_BASE}/matrix/foot-walking`;
      const ctl = new AbortController();
      const tm = setTimeout(() => ctl.abort(), 8000);
      const r = await fetch(url, {
        method: 'POST',
        signal: ctl.signal,
        headers: {
          'Authorization': ORS_KEY,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          locations,
          sources: [0],
          destinations: destIdx,
          metrics: ['distance'],
        }),
      });
      clearTimeout(tm);
      if (!r.ok) throw new Error('ors matrix ' + r.status);
      const j = await r.json();
      const dists: (number | null)[] | undefined = j?.distances?.[0];
      if (!dists) throw new Error('ors matrix empty');
      slice.forEach((origIdx, i) => {
        const m = dists[i];
        if (m != null && isFinite(m)) {
          const val = { sec: Math.round(m / WALK_MPS), meters: Math.round(m) };
          matrixCache.set(mKey(from, tos[origIdx]), val);
          out[origIdx] = val;
        }
      });
    } catch {
      // pusti null za neuspele — caller padne nazaj na haversine
    }
  }
  return out;
}
