// OSRM public foot routing with in-memory cache + straight-line fallback.
// https://router.project-osrm.org/ — non-commercial, rate-limited, but fine for single-user PWA.

import { getWalkMps } from './settings';

type LL = { lat: number; lon: number };
export type WalkRoute = { coords: [number, number][]; meters: number; sec: number };

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

  // Very short / zero distance — skip API
  if (straight.meters < 5) {
    cache.set(k, straight);
    return straight;
  }

  try {
    const url = `https://router.project-osrm.org/route/v1/foot/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson`;
    const ctl = new AbortController();
    const timeout = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(timeout);
    if (!r.ok) throw new Error('osrm ' + r.status);
    const j = await r.json();
    const route = j.routes?.[0];
    if (!route?.geometry?.coordinates?.length) throw new Error('empty');
    const wr: WalkRoute = {
      coords: route.geometry.coordinates as [number, number][], // [lon,lat]
      meters: Math.round(route.distance),
      sec: Math.round(route.distance / WALK_MPS),
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
