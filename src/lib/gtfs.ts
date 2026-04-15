export type Stop = { id: number; name: string; lat: number; lon: number; code: string | null };
export type Route = { id: number; short: string; long: string; type: number };
export type Trip = { id: number; route: number; service: number; headsign: string; short: string; dir: number; shape: number | null; stops: [number, number, number][] };
export type Service = { id: number; days: number[]; start: string; end: string };

export type GTFS = { stops: Stop[]; routes: Route[]; trips: Trip[]; services: Service[]; exceptions: { service: number; date: string; type: number }[] };
export type Shape = { id: number; pts: [number, number][] };

const BASE = import.meta.env.BASE_URL + 'gtfs';

let shapesCached: Map<number, Shape> | null = null;
let shapesLoading: Promise<Map<number, Shape>> | null = null;

export function loadShapes(): Promise<Map<number, Shape>> {
  if (shapesCached) return Promise.resolve(shapesCached);
  if (shapesLoading) return shapesLoading;
  shapesLoading = fetch(`${BASE}/shapes.json`).then(r => r.json()).then((arr: Shape[]) => {
    shapesCached = new Map(arr.map(s => [s.id, s]));
    return shapesCached;
  });
  return shapesLoading;
}

// Unique (shape, route) combos for all trips that serve a given stop.
export function shapesForStop(gtfs: GTFS, stopId: number): { shape: number; route: number }[] {
  const seen = new Set<string>();
  const out: { shape: number; route: number }[] = [];
  for (const t of gtfs.trips) {
    if (t.shape == null) continue;
    for (const st of t.stops) {
      if (st[0] === stopId) {
        const k = `${t.shape}|${t.route}`;
        if (!seen.has(k)) { seen.add(k); out.push({ shape: t.shape, route: t.route }); }
        break;
      }
    }
  }
  return out;
}

// Curated high-contrast palette (24 distinct hues) — zagotavlja razlikovanje
// tudi pri sosednjih linijah kot sta P16 in G3.
const ROUTE_PALETTE = [
  '#E53935', '#1E88E5', '#43A047', '#FB8C00', '#8E24AA', '#00ACC1',
  '#C62828', '#6D4C41', '#3949AB', '#7CB342', '#D81B60', '#00897B',
  '#5E35B1', '#C0CA33', '#F4511E', '#546E7A', '#AB47BC', '#26A69A',
  '#EC407A', '#66BB6A', '#FFA726', '#42A5F5', '#EF5350', '#5C6BC0',
];
// Deterministic color per route id; multiplier 17 razprši sosednje ID-je.
export function routeColor(routeId: number): string {
  const idx = ((routeId * 17) % ROUTE_PALETTE.length + ROUTE_PALETTE.length) % ROUTE_PALETTE.length;
  return ROUTE_PALETTE[idx];
}

// Crop a shape polyline to the segment between two stops by nearest-point snapping.
export function cropShape(shape: Shape, from: { lat: number; lon: number }, to: { lat: number; lon: number }): [number, number][] {
  let iFrom = 0, iTo = 0, dF = Infinity, dT = Infinity;
  for (let i = 0; i < shape.pts.length; i++) {
    const p = shape.pts[i];
    const df = (p[0] - from.lat) ** 2 + (p[1] - from.lon) ** 2;
    const dt = (p[0] - to.lat) ** 2 + (p[1] - to.lon) ** 2;
    if (df < dF) { dF = df; iFrom = i; }
    if (dt < dT) { dT = dt; iTo = i; }
  }
  const [lo, hi] = iFrom <= iTo ? [iFrom, iTo] : [iTo, iFrom];
  const seg = shape.pts.slice(lo, hi + 1);
  return iFrom <= iTo ? seg : seg.reverse();
}

let cached: GTFS | null = null;
let loading: Promise<GTFS> | null = null;

export function loadGTFS(): Promise<GTFS> {
  if (cached) return Promise.resolve(cached);
  if (loading) return loading;
  loading = (async () => {
    const [stops, routes, trips, service] = await Promise.all([
      fetch(`${BASE}/stops.json`).then(r => r.json()),
      fetch(`${BASE}/routes.json`).then(r => r.json()),
      fetch(`${BASE}/trips.json`).then(r => r.json()),
      fetch(`${BASE}/service.json`).then(r => r.json()),
    ]);
    cached = { stops, routes, trips, services: service.services, exceptions: service.exceptions };
    return cached;
  })();
  return loading;
}

// Haversine in meters
export function dist(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function nearestStops(stops: Stop[], origin: { lat: number; lon: number }, k = 8): (Stop & { d: number })[] {
  return stops
    .map(s => ({ ...s, d: dist(origin, s) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, k);
}

export function todayServiceIds(gtfs: GTFS, when: Date = new Date()): Set<number> {
  const wd = (when.getDay() + 6) % 7; // 0=Mon
  const yyyymmdd = `${when.getFullYear()}${String(when.getMonth() + 1).padStart(2, '0')}${String(when.getDate()).padStart(2, '0')}`;
  const active = new Set<number>();
  for (const s of gtfs.services) {
    if (s.start <= yyyymmdd && yyyymmdd <= s.end && s.days[wd] === 1) active.add(s.id);
  }
  for (const e of gtfs.exceptions) {
    if (e.date === yyyymmdd) {
      if (e.type === 1) active.add(e.service);
      else active.delete(e.service);
    }
  }
  return active;
}

// Vse odhode za dano postajo in dan (služba). Uporabljeno za klasičen vozni red.
export type DayKind = 'weekday' | 'saturday' | 'sunday';
export function dayKindToDate(kind: DayKind, base: Date = new Date()): Date {
  const d = new Date(base);
  const target = kind === 'weekday' ? 2 : kind === 'saturday' ? 6 : 0; // Tue, Sat, Sun
  const cur = d.getDay();
  d.setDate(d.getDate() + ((target - cur + 7) % 7));
  return d;
}

export function allDeparturesForStop(
  gtfs: GTFS,
  stopId: number,
  when: Date,
): { trip: Trip; route: Route; depSec: number }[] {
  const active = todayServiceIds(gtfs, when);
  const routeById = new Map(gtfs.routes.map(r => [r.id, r]));
  const out: { trip: Trip; route: Route; depSec: number }[] = [];
  for (const t of gtfs.trips) {
    if (!active.has(t.service)) continue;
    for (const st of t.stops) {
      if (st[0] !== stopId) continue;
      out.push({ trip: t, route: routeById.get(t.route)!, depSec: st[2] });
      break;
    }
  }
  out.sort((a, b) => a.depSec - b.depSec);
  return out;
}

// Vse odhode linije v izbrano smer na dan. Group po trip.
export function allTripsForRouteDirection(
  gtfs: GTFS,
  routeId: number,
  dir: number,
  when: Date,
): Trip[] {
  const active = todayServiceIds(gtfs, when);
  return gtfs.trips.filter(t => t.route === routeId && t.dir === dir && active.has(t.service))
    .sort((a, b) => (a.stops[0]?.[2] ?? 0) - (b.stops[0]?.[2] ?? 0));
}

// Upcoming departures from a stop today, sorted asc. Returns up to `k` entries.
export function upcomingDepartures(
  gtfs: GTFS,
  stopId: number,
  when: Date = new Date(),
  k = 10
): { trip: Trip; route: Route; depSec: number; minutesFromNow: number }[] {
  const active = todayServiceIds(gtfs, when);
  const nowSec = when.getHours() * 3600 + when.getMinutes() * 60 + when.getSeconds();
  const routeById = new Map(gtfs.routes.map(r => [r.id, r]));
  const out: { trip: Trip; route: Route; depSec: number; minutesFromNow: number }[] = [];
  for (const t of gtfs.trips) {
    if (!active.has(t.service)) continue;
    for (const st of t.stops) {
      if (st[0] !== stopId) continue;
      const dep = st[2];
      if (dep < nowSec) break; // stops of a trip are chronological
      out.push({ trip: t, route: routeById.get(t.route)!, depSec: dep, minutesFromNow: Math.round((dep - nowSec) / 60) });
      break;
    }
  }
  out.sort((a, b) => a.depSec - b.depSec);
  return out.slice(0, k);
}
