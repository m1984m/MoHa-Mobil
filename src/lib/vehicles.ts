import type { GTFS, Stop, Trip } from './gtfs';
import { todayServiceIds, routeColor } from './gtfs';

// Predračunani indeksi GTFS-a za hot path (findTripForLiveBus, klicana enkrat
// per živ bus per poll). Brez indeksa smo vsak klic linearno skenirali 14k+ trip-ov
// in rebuildali stopById map — pri 15+ busih preko 5 ms per klic. Z indeksom
// razrez za routeId je O(#trip-ov na linijo) ≈ 50–200.
export type VehiclesIndexes = {
  stopById: Map<number, Stop>;
  tripsByRoute: Map<number, Trip[]>;
  activeServices: Set<number>;
  routeIdByShort: Map<string, number>;
  dayKey: string; // YYYYMMDD — invalidira ob polnoči
};

// WeakMap cache: pri menjavi GTFS reference (reload) se index avtomatsko sprosti
// z GC-jem. Rebuild: ko dayKey ne ustreza več (polnoč).
const indexCache = new WeakMap<GTFS, VehiclesIndexes>();

function dayKey(when: Date): string {
  return `${when.getFullYear()}${String(when.getMonth() + 1).padStart(2, '0')}${String(when.getDate()).padStart(2, '0')}`;
}

export function precomputeVehiclesIndexes(gtfs: GTFS, when: Date = new Date()): VehiclesIndexes {
  const key = dayKey(when);
  const cached = indexCache.get(gtfs);
  if (cached && cached.dayKey === key) return cached;
  const stopById = new Map(gtfs.stops.map(s => [s.id, s]));
  const tripsByRoute = new Map<number, Trip[]>();
  for (const t of gtfs.trips) {
    const arr = tripsByRoute.get(t.route);
    if (arr) arr.push(t);
    else tripsByRoute.set(t.route, [t]);
  }
  const activeServices = todayServiceIds(gtfs, when);
  const routeIdByShort = new Map(gtfs.routes.map(r => [r.short.toLowerCase(), r.id]));
  const idx: VehiclesIndexes = { stopById, tripsByRoute, activeServices, routeIdByShort, dayKey: key };
  indexCache.set(gtfs, idx);
  return idx;
}

// Heuristic match: poišči aktivni GTFS trip za živi Marprom OBA bus.
// OBA daje LineCode + Headsign + lat/lon; GTFS trips nimajo istega ID-ja.
// Strategija: ista linija + aktivna storitev + trip je v teku (nowSec med prvim
// depom in zadnjim arr) → izberi tisti, katerega ena od postaj je geografsko
// najbližje živemu busu. Headsign ujemanje je dodatni (mehki) filter.
export function findTripForLiveBus(
  live: { lineCode: string; headsign: string; lat: number; lon: number },
  nowSec: number,
  idx: VehiclesIndexes,
): Trip | null {
  const routeId = idx.routeIdByShort.get(live.lineCode.toLowerCase());
  if (routeId == null) return null;
  const routeTrips = idx.tripsByRoute.get(routeId);
  if (!routeTrips) return null;
  const candidates: Trip[] = [];
  for (const t of routeTrips) {
    if (!idx.activeServices.has(t.service)) continue;
    if (t.stops.length < 2) continue;
    const firstDep = t.stops[0][2];
    const lastArr = t.stops[t.stops.length - 1][1];
    // Dodamo 2 min buffer za busove, ki malo zamujajo
    if (nowSec < firstDep - 120 || nowSec > lastArr + 120) continue;
    candidates.push(t);
  }
  if (candidates.length === 0) return null;

  // Preferiraj trip-e, ki so STROGO v teku (brez 2-min buffer okna). Na krožnih
  // linijah (G3) se dva zaporedna trip-a overlapneta v buffer zoni — strogi
  // filter razreši, kateremu trip-u dejansko pripada GPS.
  const strictActive = candidates.filter(t => {
    const firstDep = t.stops[0][2];
    const lastArr = t.stops[t.stops.length - 1][1];
    return nowSec >= firstDep && nowSec <= lastArr;
  });
  const basePool = strictActive.length > 0 ? strictActive : candidates;

  const hs = live.headsign.trim().toLowerCase();
  const byHeadsign = hs ? basePool.filter(t => t.headsign.toLowerCase() === hs) : [];
  const pool = byHeadsign.length > 0 ? byHeadsign : basePool;

  let best: Trip | null = null;
  let bestD = Infinity;
  for (const t of pool) {
    for (const st of t.stops) {
      const s = idx.stopById.get(st[0]);
      if (!s) continue;
      const d = (s.lat - live.lat) ** 2 + (s.lon - live.lon) ** 2;
      if (d < bestD) { bestD = d; best = t; }
    }
  }
  return best;
}

// Index najbližje postaje na tripu glede na lat/lon busa. Če bus ni točno na
// postaji, naslednja postaja = najbližja + 1 (če bus vozi, ne stoji).
export function nearestTripStopIdx(gtfs: GTFS, trip: Trip, lat: number, lon: number): number {
  const stopById = new Map(gtfs.stops.map(s => [s.id, s]));
  let best = 0, bestD = Infinity;
  for (let i = 0; i < trip.stops.length; i++) {
    const s = stopById.get(trip.stops[i][0]);
    if (!s) continue;
    const d = (s.lat - lat) ** 2 + (s.lon - lon) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

export type Vehicle = {
  tripId: number;
  routeId: number;
  routeShort: string;
  headsign: string;
  lat: number;
  lon: number;
  bearing: number;
  color: string;
  nextStopId: number;
  dwelling: boolean;
};

// Sintetične pozicije busov (fallback, ko OBA živi podatki niso na voljo).
// Metoda: stop-snap — pokaži bus TOČNO na zadnji postaji, ki bi jo po voznem
// redu že obiskal (največji j z arr[j] ≤ nowSec). Ikona "preskoči" na naslednjo
// postajo ob času prihoda po GTFS.
//
// Zakaj ne interpolacija med postajami: Marprom GTFS ima mid-stop časovno
// razporeditev pogosto linearno interpolirano (ni real data). Prejšnja
// koda je progress = (nowSec - segStart)/(segEnd - segStart) + pointAtFraction
// po cropShape polyline dajala lažno natančnost — bus na karti je vozil po
// "shape"-u z napačno hitrostjo, ki ni odsevala resničnosti. Stop-snap
// jasno sporoča: "tu je bus po voznem redu", brez fake vmesne interpolacije.
export function activeVehicles(
  gtfs: GTFS,
  when: Date = new Date()
): Vehicle[] {
  const active = todayServiceIds(gtfs, when);
  const nowSec = when.getHours() * 3600 + when.getMinutes() * 60 + when.getSeconds();
  const stopById = new Map(gtfs.stops.map(s => [s.id, s]));
  const routeById = new Map(gtfs.routes.map(r => [r.id, r]));
  const out: Vehicle[] = [];

  for (const t of gtfs.trips) {
    if (!active.has(t.service)) continue;
    if (t.stops.length < 2) continue;
    const firstDep = t.stops[0][2];
    const lastArr = t.stops[t.stops.length - 1][1];
    if (nowSec < firstDep || nowSec > lastArr) continue;

    const route = routeById.get(t.route);
    if (!route) continue;

    // Zadnja že-obiskana postaja: največji j z arr[j] ≤ nowSec (prva postaja ima
    // arr=0, tam uporabimo dep[0]). Bus je "na" j-ti postaji dokler ne prispe na j+1.
    let j = -1;
    for (let i = 0; i < t.stops.length; i++) {
      const ref = t.stops[i][1] || t.stops[i][2];
      if (ref <= nowSec) j = i;
      else break;
    }
    if (j < 0) continue;

    const stop = stopById.get(t.stops[j][0]);
    if (!stop) continue;

    let bearing = 0;
    if (j < t.stops.length - 1) {
      const next = stopById.get(t.stops[j + 1][0]);
      if (next) bearing = Math.atan2(next.lon - stop.lon, next.lat - stop.lat) * 180 / Math.PI;
    }

    out.push({
      tripId: t.id,
      routeId: t.route,
      routeShort: route.short,
      headsign: t.headsign,
      lat: stop.lat,
      lon: stop.lon,
      bearing,
      color: routeColor(t.route),
      nextStopId: j < t.stops.length - 1 ? t.stops[j + 1][0] : t.stops[j][0],
      dwelling: true,
    });
  }
  return out;
}
