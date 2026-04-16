import type { GTFS, Shape, Trip } from './gtfs';
import { cropShape, todayServiceIds, routeColor } from './gtfs';

// Heuristic match: poišči aktivni GTFS trip za živi Marprom OBA bus.
// OBA daje LineCode + Headsign + lat/lon; GTFS trips nimajo istega ID-ja.
// Strategija: ista linija + aktivna storitev + trip je v teku (nowSec med prvim
// depom in zadnjim arr) → izberi tisti, katerega ena od postaj je geografsko
// najbližje živemu busu. Headsign ujemanje je dodatni (mehki) filter.
export function findTripForLiveBus(
  gtfs: GTFS,
  live: { lineCode: string; headsign: string; lat: number; lon: number },
  nowSec: number,
  routeIdByShort: Map<string, number>,
): Trip | null {
  const routeId = routeIdByShort.get(live.lineCode.toLowerCase());
  if (routeId == null) return null;
  const active = todayServiceIds(gtfs, new Date());
  const candidates: Trip[] = [];
  for (const t of gtfs.trips) {
    if (t.route !== routeId) continue;
    if (!active.has(t.service)) continue;
    if (t.stops.length < 2) continue;
    const firstDep = t.stops[0][2];
    const lastArr = t.stops[t.stops.length - 1][1];
    // Dodamo 2 min buffer za busove, ki malo zamujajo
    if (nowSec < firstDep - 120 || nowSec > lastArr + 120) continue;
    candidates.push(t);
  }
  if (candidates.length === 0) return null;

  const hs = live.headsign.trim().toLowerCase();
  const byHeadsign = hs ? candidates.filter(t => t.headsign.toLowerCase() === hs) : [];
  const pool = byHeadsign.length > 0 ? byHeadsign : candidates;

  const stopById = new Map(gtfs.stops.map(s => [s.id, s]));
  let best: Trip | null = null;
  let bestD = Infinity;
  for (const t of pool) {
    for (const st of t.stops) {
      const s = stopById.get(st[0]);
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

export function activeVehicles(
  gtfs: GTFS,
  shapesMap: Map<number, Shape>,
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
    const color = routeColor(t.route);

    let placed = false;
    for (let i = 0; i < t.stops.length - 1; i++) {
      const segStart = t.stops[i][2];
      const segEnd = t.stops[i + 1][1];
      if (nowSec >= segStart && nowSec <= segEnd) {
        const progress = segEnd > segStart ? (nowSec - segStart) / (segEnd - segStart) : 0;
        const fromS = stopById.get(t.stops[i][0])!;
        const toS = stopById.get(t.stops[i + 1][0])!;
        let lat: number, lon: number, bearing = 0;
        const shape = t.shape != null ? shapesMap.get(t.shape) : null;
        if (shape) {
          const cropped = cropShape(shape, fromS, toS);
          const pt = pointAtFraction(cropped, progress);
          lat = pt[0]; lon = pt[1]; bearing = pt[2];
        } else {
          lat = fromS.lat + (toS.lat - fromS.lat) * progress;
          lon = fromS.lon + (toS.lon - fromS.lon) * progress;
          bearing = Math.atan2(toS.lon - fromS.lon, toS.lat - fromS.lat) * 180 / Math.PI;
        }
        out.push({
          tripId: t.id, routeId: t.route, routeShort: route.short, headsign: t.headsign,
          lat, lon, bearing, color, nextStopId: t.stops[i + 1][0], dwelling: false,
        });
        placed = true;
        break;
      }
      // Dwell at stop i+1 (between arrival and next departure)
      if (i + 1 < t.stops.length - 1) {
        const dwellEnd = t.stops[i + 1][2];
        if (nowSec > segEnd && nowSec < dwellEnd) {
          const s = stopById.get(t.stops[i + 1][0])!;
          out.push({
            tripId: t.id, routeId: t.route, routeShort: route.short, headsign: t.headsign,
            lat: s.lat, lon: s.lon, bearing: 0, color, nextStopId: t.stops[i + 1][0], dwelling: true,
          });
          placed = true;
          break;
        }
      }
    }
    void placed;
  }
  return out;
}

function pointAtFraction(pts: [number, number][], f: number): [number, number, number] {
  if (pts.length === 0) return [0, 0, 0];
  if (pts.length === 1) return [pts[0][0], pts[0][1], 0];
  const lens: number[] = [0];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const dLat = pts[i][0] - pts[i - 1][0];
    const dLon = pts[i][1] - pts[i - 1][1];
    total += Math.sqrt(dLat * dLat + dLon * dLon);
    lens.push(total);
  }
  if (total === 0) return [pts[0][0], pts[0][1], 0];
  const target = Math.max(0, Math.min(1, f)) * total;
  let i = 1;
  while (i < pts.length && lens[i] < target) i++;
  if (i >= pts.length) i = pts.length - 1;
  const segLen = lens[i] - lens[i - 1];
  const segFrac = segLen > 0 ? (target - lens[i - 1]) / segLen : 0;
  const lat = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * segFrac;
  const lon = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * segFrac;
  const bearing = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]) * 180 / Math.PI;
  return [lat, lon, bearing];
}
