import type { GTFS, Stop, Trip, Route } from './gtfs';
import { dist, todayServiceIds } from './gtfs';
import { getWalkMps } from './settings';

export type WalkLeg = {
  kind: 'walk';
  fromLat: number; fromLon: number;
  toLat: number; toLon: number;
  sec: number; meters: number;
  toStop?: Stop;
  fromStop?: Stop;
};
export type BusLeg = {
  kind: 'bus';
  route: Route;
  headsign: string;
  from: Stop; to: Stop;
  depSec: number; arrSec: number;
  stopCount: number;
  shapeId: number | null;
};
export type PlanLeg = WalkLeg | BusLeg;
export type Plan = {
  legs: PlanLeg[];
  depSec: number;
  arrSec: number;
  walkMeters: number;
  transfers: number;  // 0 = pure walk or single bus
};

// Hitrost se bere dinamično iz nastavitev — getWalkMps()
const MAX_ACCESS_M = 1000;
const MAX_TRANSFER_M = 400;
const MAX_ROUNDS = 3;

type PrevOrigin = { kind: 'origin' };
type PrevTransfer = { kind: 'walk'; fromStop: number };
type PrevBus = { kind: 'bus'; trip: Trip; boardIdx: number; alightIdx: number };
type Prev = PrevOrigin | PrevTransfer | PrevBus;

// Per-round labels: labelsAt[k][stopId] = { time, prev }
type Label = { time: number; prev: Prev };

// Returns up to 3 plans: [fewest-transfers-fastest, fastest, middle-ground]
export function planAll(
  gtfs: GTFS,
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  depSec: number,
  when: Date = new Date()
): Plan[] {
  const WALK_MPS = getWalkMps();
  const active = todayServiceIds(gtfs, when);
  const stopById = new Map(gtfs.stops.map(s => [s.id, s]));
  const routeById = new Map(gtfs.routes.map(r => [r.id, r]));

  const tripsByBoardStop = new Map<number, { trip: Trip; idx: number }[]>();
  for (const t of gtfs.trips) {
    if (!active.has(t.service)) continue;
    for (let i = 0; i < t.stops.length - 1; i++) {
      const sid = t.stops[i][0];
      let arr = tripsByBoardStop.get(sid);
      if (!arr) { arr = []; tripsByBoardStop.set(sid, arr); }
      arr.push({ trip: t, idx: i });
    }
  }

  const nearByStop = new Map<number, { id: number; m: number }[]>();
  for (const a of gtfs.stops) {
    const arr: { id: number; m: number }[] = [];
    for (const b of gtfs.stops) {
      if (a.id === b.id) continue;
      const m = dist(a, b);
      if (m <= MAX_TRANSFER_M) arr.push({ id: b.id, m });
    }
    nearByStop.set(a.id, arr);
  }

  // Per-round labels
  const labelsByRound: Map<number, Label>[] = [];
  const origin0 = new Map<number, Label>();
  for (const s of gtfs.stops) {
    const m = dist(from, s);
    if (m > MAX_ACCESS_M) continue;
    const t = depSec + m / WALK_MPS;
    origin0.set(s.id, { time: t, prev: { kind: 'origin' } });
  }
  if (origin0.size === 0) return [];
  labelsByRound.push(origin0);

  const egress: { id: number; m: number }[] = [];
  for (const s of gtfs.stops) {
    const m = dist(s, to);
    if (m <= MAX_ACCESS_M) egress.push({ id: s.id, m });
  }

  let marked = new Set<number>(origin0.keys());
  let prevRoundLabels = origin0;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const roundLabels = new Map<number, Label>(prevRoundLabels);
    const nextMarked = new Set<number>();

    for (const sid of marked) {
      const cur = roundLabels.get(sid);
      if (!cur) continue;
      const arrAt = cur.time;
      const boards = tripsByBoardStop.get(sid);
      if (!boards) continue;
      for (const { trip, idx } of boards) {
        const boardDep = trip.stops[idx][2];
        if (boardDep < arrAt) continue;
        for (let j = idx + 1; j < trip.stops.length; j++) {
          const alightId = trip.stops[j][0];
          const alightArr = trip.stops[j][1];
          const lbl = roundLabels.get(alightId);
          if (!lbl || alightArr < lbl.time) {
            roundLabels.set(alightId, { time: alightArr, prev: { kind: 'bus', trip, boardIdx: idx, alightIdx: j } });
            nextMarked.add(alightId);
          }
        }
      }
    }

    const snapshot = [...nextMarked];
    for (const sid of snapshot) {
      const at = roundLabels.get(sid)!.time;
      const near = nearByStop.get(sid) || [];
      for (const { id: nid, m } of near) {
        const t = at + m / WALK_MPS;
        const lbl = roundLabels.get(nid);
        if (!lbl || t < lbl.time) {
          roundLabels.set(nid, { time: t, prev: { kind: 'walk', fromStop: sid } });
          nextMarked.add(nid);
        }
      }
    }

    labelsByRound.push(roundLabels);
    if (nextMarked.size === 0) break;
    marked = nextMarked;
    prevRoundLabels = roundLabels;
  }

  // For each round (= max #buses used), find best egress
  type Candidate = { round: number; arr: number; stopId: number };
  const candidates: Candidate[] = [];
  for (let round = 1; round < labelsByRound.length; round++) {
    const L = labelsByRound[round];
    let best: Candidate | null = null;
    for (const e of egress) {
      const lbl = L.get(e.id);
      if (!lbl || lbl.prev.kind === 'origin') continue;
      const arrAtDest = lbl.time + e.m / WALK_MPS;
      if (!best || arrAtDest < best.arr) best = { round, arr: arrAtDest, stopId: e.id };
    }
    if (best) candidates.push(best);
  }

  // Pure walk baseline
  const walkDirectM = dist(from, to);
  const walkDirectArr = depSec + walkDirectM / WALK_MPS;
  const plans: Plan[] = [];

  // Always include walk baseline if it's reasonable (<30 min or <2 km)
  const walkPlan: Plan | null = walkDirectM < 2000 || walkDirectArr <= (candidates[0]?.arr ?? Infinity) + 600
    ? {
        legs: [{
          kind: 'walk',
          fromLat: from.lat, fromLon: from.lon,
          toLat: to.lat, toLon: to.lon,
          sec: walkDirectM / WALK_MPS,
          meters: walkDirectM,
        }],
        depSec, arrSec: walkDirectArr, walkMeters: walkDirectM, transfers: 0,
      }
    : null;

  // Reconstruct plan for each candidate (fewest-transfers first, then more but faster)
  // Pareto: keep only candidates that are faster than previous (more transfers → must be meaningfully faster)
  const pareto: Candidate[] = [];
  let bestSoFar = Infinity;
  for (const c of candidates) {
    if (c.arr < bestSoFar - 120) { // require at least 2-min improvement for extra transfer
      pareto.push(c);
      bestSoFar = c.arr;
    }
  }

  for (const c of pareto) {
    const p = reconstruct(labelsByRound[c.round], c.stopId, stopById, routeById, from, to, depSec, c.arr);
    if (p) plans.push(p);
  }

  if (walkPlan && !plans.some(p => p.transfers === 0 && p.legs.length === 1)) {
    // Only insert walk plan if it wins on time vs fastest transit plan
    if (!plans.length || walkDirectArr < plans[0].arrSec) plans.unshift(walkPlan);
  }

  if (plans.length === 0 && walkPlan) plans.push(walkPlan);

  // Sort: primary by transfers asc, secondary by arrSec asc
  plans.sort((a, b) => a.transfers - b.transfers || a.arrSec - b.arrSec);

  // Dedup: if two plans have same transfers & arrSec, keep one
  const seen = new Set<string>();
  const out: Plan[] = [];
  for (const p of plans) {
    const k = `${p.transfers}|${Math.round(p.arrSec / 60)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
    if (out.length >= 3) break;
  }
  return out;
}

function reconstruct(
  labels: Map<number, Label>,
  egressStopId: number,
  stopById: Map<number, Stop>,
  routeById: Map<number, Route>,
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  depSec: number,
  arrAtDest: number,
): Plan | null {
  const WALK_MPS = getWalkMps();
  const legs: PlanLeg[] = [];
  let cursor = egressStopId;
  let busCount = 0;
  let safety = 20;
  while (safety-- > 0) {
    const lbl = labels.get(cursor);
    if (!lbl) return null;
    const p = lbl.prev;
    if (p.kind === 'bus') {
      const fromS = stopById.get(p.trip.stops[p.boardIdx][0])!;
      const toS = stopById.get(p.trip.stops[p.alightIdx][0])!;
      legs.unshift({
        kind: 'bus',
        route: routeById.get(p.trip.route)!,
        headsign: p.trip.headsign,
        from: fromS, to: toS,
        depSec: p.trip.stops[p.boardIdx][2],
        arrSec: p.trip.stops[p.alightIdx][1],
        stopCount: p.alightIdx - p.boardIdx,
        shapeId: p.trip.shape,
      });
      cursor = fromS.id;
      busCount++;
    } else if (p.kind === 'walk') {
      const a = stopById.get(p.fromStop)!;
      const b = stopById.get(cursor)!;
      const m = dist(a, b);
      legs.unshift({
        kind: 'walk',
        fromLat: a.lat, fromLon: a.lon,
        toLat: b.lat, toLon: b.lon,
        sec: m / WALK_MPS, meters: m,
        fromStop: a, toStop: b,
      });
      cursor = a.id;
    } else {
      break;
    }
  }

  const firstStop = stopById.get(cursor)!;
  const leadingM = dist(from, firstStop);
  legs.unshift({
    kind: 'walk',
    fromLat: from.lat, fromLon: from.lon,
    toLat: firstStop.lat, toLon: firstStop.lon,
    sec: leadingM / WALK_MPS, meters: leadingM,
    toStop: firstStop,
  });

  const lastStop = stopById.get(egressStopId)!;
  const trailingM = dist(lastStop, to);
  legs.push({
    kind: 'walk',
    fromLat: lastStop.lat, fromLon: lastStop.lon,
    toLat: to.lat, toLon: to.lon,
    sec: trailingM / WALK_MPS, meters: trailingM,
    fromStop: lastStop,
  });

  const walkMeters = legs.reduce((acc, l) => acc + (l.kind === 'walk' ? l.meters : 0), 0);
  return { legs, depSec, arrSec: arrAtDest, walkMeters, transfers: Math.max(0, busCount - 1) };
}

// Backwards-compat wrapper — returns first (fewest-transfers) plan
export function plan(
  gtfs: GTFS,
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  depSec: number,
  when: Date = new Date()
): Plan | null {
  const all = planAll(gtfs, from, to, depSec, when);
  return all[0] ?? null;
}
