import type { GTFS, Stop, Trip, Route } from './gtfs';
import { dist, todayServiceIds } from './gtfs';
import { getWalkMps } from './settings';
import { nowMb } from './clock';

export type WalkLeg = {
  kind: 'walk';
  fromLat: number; fromLon: number;
  toLat: number; toLon: number;
  // Čas in razdalja, s katerima je računal načrtovalnik (obvoz ali matrika ORS), ne zračna
  // črta. Ob izpadu ORS odsek obdrži te vrednosti in »Kreni ob« se računa iz njih — prej je
  // bila tu zračna črta, avtobus pa izbran z obvozom, zato je »Kreni ob« zamujal do 5 min
  // (998 m do postaje: kreni 07:08, na postaji 07:28, avtobus ob 07:23; pregled 12.10.2026).
  sec: number; meters: number;
  toStop?: Stop;
  fromStop?: Stop;
};
export type BusLeg = {
  kind: 'bus';
  route: Route;
  tripId: number;
  headsign: string;
  from: Stop; to: Stop;
  depSec: number; arrSec: number;
  stopCount: number;
  shapeId: number | null;
};
export type PlanLeg = WalkLeg | BusLeg;
export type Plan = {
  legs: PlanLeg[];
  // Kdaj potnik krene od izhodišča: odhod prvega avtobusa minus hoja do postaje, pri poti
  // samo peš začetek hoje. Prej je bil to čas iskanja — »Prihod do« je zato kazal avtobuse,
  // ki so že odpeljali, in trajanje skupaj s čakanjem doma (pregled 12.10.2026).
  depSec: number;
  arrSec: number;
  walkMeters: number;
  transfers: number;  // 0 = pure walk or single bus
  // Pot z avtobusom, ki je počasnejša od hoje, a hojo bistveno skrajša (glej planAll).
  lessWalk?: boolean;
  // Dan iskanja (YYYYMMDD po uri Maribora): sekunde so od njegove polnoči, tudi jutrišnje
  // poti (+ 24 h). PlanSteps po njem odšteva, ko je pot odprta čez polnoč.
  baseDay?: number;
  // Peš odseki prikazane poti so ocena (ORS ni odgovoril). Opozorilo na karti velja za to
  // pot, ne za zadnji klic ORS kjerkoli v aplikaciji (pregled 12.10.2026).
  walkEstimated?: boolean;
};

// Dan po uri Maribora kot število YYYYMMDD (za Plan.baseDay).
export function dayNumber(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

// Prihod po dejanski pešpoti, ko imajo peš odseki že `sec` iz openrouteservice (ob izbiri
// poti), ne po oceni iz zračne razdalje: kartica poti je sicer v glavi kazala 13 min, pri
// hoji pa 14 min (922 m; ponovna ocena 05.10.2026). Na prihod vplivajo samo peš odseki za
// zadnjim avtobusom (lahko sta dva: prehod do druge postaje in hoja do cilja), na odhod
// (depSec) pa hoja pred prvim avtobusom, da je »Odhod« enak »Kreni ob« v korakih poti.
export function syncArrivalWithWalks(p: Plan): void {
  const walkSec = (a: number, b: number) =>
    p.legs.slice(a, b).reduce((s, l) => s + (l.kind === 'walk' ? l.sec : 0), 0);
  let first = -1, last = -1;
  p.legs.forEach((l, i) => { if (l.kind === 'bus') { if (first < 0) first = i; last = i; } });
  const firstBus = p.legs[first], lastBus = p.legs[last];
  if (!firstBus || firstBus.kind !== 'bus' || !lastBus || lastBus.kind !== 'bus') {
    p.arrSec = p.depSec + walkSec(0, p.legs.length);      // samo peš
    return;
  }
  p.depSec = firstBus.depSec - walkSec(0, first);
  p.arrSec = lastBus.arrSec + walkSec(last + 1, p.legs.length);
}

// Hitrost se bere dinamično iz nastavitev — getWalkMps()
const MAX_ACCESS_M = 1000;
const MAX_TRANSFER_M = 400;
const MAX_ROUNDS = 3;
// Psihološka kazen za prestop — v rundah ≥2 mora boarding time biti vsaj
// TRANSFER_PENALTY_SEC za arrAt, kar simulira ne-instantni prestop in prepreči,
// da 2-busna pot s trivialno boljšim arrival time-om zmaga nad direktno.
const TRANSFER_PENALTY_SEC = 180;
// Mestni detour faktor: haversine (zračna razdalja) podcenjuje realno pešhojo
// zaradi rek, železnice, enosmernih poti in blokov. 1.35 je tipična vrednost za
// urbano območje (Maribor). Uporabi se kot fallback ko OSRM matrika manjka.
const URBAN_DETOUR = 1.35;

export type WalkEntry = { sec: number; meters: number };
export type WalkMap = Map<number, WalkEntry>;

// Oznaka postaje v krogu RAPTOR (krog = največ toliko avtobusov). Oznake se ne spreminjajo:
// izboljšava ustvari novo, ki kaže na oznako, iz katere je potnik vstopil ali odšel peš, in
// rekonstrukcija sledi tem kazalcem. Prej je sledila zadnji oznaki postaje v zemljevidu, ki
// jo je isti krog že prepisal, vstop pa je bral oznake tekočega kroga — tako sta se dva
// avtobusa verižila v enem krogu brez kazni za prestop (»G4 07:01–07:02, 23 m peš, G4
// 07:05«) in pot je dobila odvečen prvi avtobus (69 od 725 poti; pregled 12.10.2026).
type Label = {
  time: number;        // prihod na postajo
  stop: number;
  // Linija zadnjega avtobusa, ki vozi naprej: nanjo se ne vstopa znova (-1 = ni omejitve).
  route: number;
  leave: number;       // kdaj potnik krene od izhodišča (znano ob prvem avtobusu)
  walk: number;        // sekunde hoje do te postaje
  round: number;
  prev: Prev;
};
type PrevOrigin = { kind: 'origin'; sec: number; meters: number };
type PrevTransfer = { kind: 'walk'; from: Label; sec: number; meters: number };
type PrevBus = { kind: 'bus'; from: Label; trip: Trip; boardIdx: number; alightIdx: number };
type Prev = PrevOrigin | PrevTransfer | PrevBus;

// Nova oznaka zamenja staro, če pride prej. Ob enakem prihodu v istem krogu (isti avtobus z
// različnih postaj) zmaga tista, ki krene pozneje, a vsaka sekunda dodatne hoje mora prinesti
// vsaj sekundo poznejšega odhoda — sicer bi zmagala 430 m daljša hoja za 48 s kasnejši
// odhod. Oznaka iz prejšnjega kroga ob enakem prihodu ostane: manj prestopov.
function improves(time: number, score: number, round: number, cur: Label | undefined): boolean {
  return !cur || time < cur.time || (time === cur.time && cur.round === round && score > cur.leave - cur.walk);
}

type Egress = { id: number; sec: number; meters: number };
type Candidate = { arr: number; label: Label; egress: Egress };

// Cache teže izračunanih indeksov — se invalidira avtomatsko, ko se GTFS objekt zamenja.
// `tripsByBoardStop` hrani VSE vožnje (brez filtriranja po aktivnih servisih) — filter
// po `active.has(trip.service)` se izvede šele ob uporabi, ker je dnevno odvisen.
type PlannerIndexes = {
  nearByStop: Map<number, { id: number; m: number }[]>;
  tripsByBoardStop: Map<number, { trip: Trip; idx: number }[]>;
};

const indexesCache = new WeakMap<GTFS, PlannerIndexes>();

export function precomputePlannerIndexes(gtfs: GTFS): PlannerIndexes {
  const cached = indexesCache.get(gtfs);
  if (cached) return cached;

  const tripsByBoardStop = new Map<number, { trip: Trip; idx: number }[]>();
  for (const t of gtfs.trips) {
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

  const result = { nearByStop, tripsByBoardStop };
  indexesCache.set(gtfs, result);
  return result;
}

// Returns up to 3 plans: [fewest-transfers-fastest, fastest, middle-ground]
// `opts.maxAccessM` omeji hojo do prve in od zadnje postaje; `opts.raw` vrne poti z
// avtobusom brez filtra hoje (za iskanje možnosti »manj hoje«).
export function planAll(
  gtfs: GTFS,
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  depSec: number,
  when: Date = nowMb(),
  accessMap?: WalkMap,
  egressMap?: WalkMap,
  opts: { maxAccessM?: number; raw?: boolean } = {},
): Plan[] {
  const WALK_MPS = getWalkMps();
  const maxAccessM = opts.maxAccessM ?? MAX_ACCESS_M;
  const active = todayServiceIds(gtfs, when);
  const stopById = new Map(gtfs.stops.map(s => [s.id, s]));
  const routeById = new Map(gtfs.routes.map(r => [r.id, r]));

  const { nearByStop, tripsByBoardStop } = precomputePlannerIndexes(gtfs);

  // Per-round labels
  const labelsByRound: Map<number, Label>[] = [];
  const origin0 = new Map<number, Label>();
  for (const s of gtfs.stops) {
    const m = dist(from, s);
    if (m > maxAccessM) continue;
    const hit = accessMap?.get(s.id);
    const sec = hit ? hit.sec : (m * URBAN_DETOUR) / WALK_MPS;
    const meters = hit ? hit.meters : m * URBAN_DETOUR;
    origin0.set(s.id, { time: depSec + sec, stop: s.id, route: -1, leave: depSec, walk: sec, round: 0, prev: { kind: 'origin', sec, meters } });
  }
  if (origin0.size === 0) return [];
  labelsByRound.push(origin0);

  const egress: Egress[] = [];
  for (const s of gtfs.stops) {
    const m = dist(s, to);
    if (m > maxAccessM) continue;
    const hit = egressMap?.get(s.id);
    const sec = hit ? hit.sec : (m * URBAN_DETOUR) / WALK_MPS;
    egress.push({ id: s.id, sec, meters: hit ? hit.meters : m * URBAN_DETOUR });
  }

  let marked: Iterable<number> = origin0.keys();
  let prevRoundLabels = origin0;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const roundLabels = new Map<number, Label>(prevRoundLabels);
    // Postaje, kamor je ta krog pripeljal avtobus — od tod gredo prehodi peš.
    const busLabels = new Map<number, Label>();

    for (const sid of marked) {
      // Vstop iz oznake PREJŠNJEGA kroga: oznaka tega kroga je lahko že prihod z drugim
      // avtobusom, prestop nanj pa bi obšel kazen za prestop.
      const cur = prevRoundLabels.get(sid);
      if (!cur) continue;
      const minBoardTime = cur.prev.kind === 'origin' ? cur.time : cur.time + TRANSFER_PENALTY_SEC;
      const boards = tripsByBoardStop.get(sid);
      if (!boards) continue;
      for (const { trip, idx } of boards) {
        if (!active.has(trip.service)) continue;
        // Iste linije zapored ne, v nobeni smeri in tudi ne prek prehoda peš: »P18 do
        // Bezjakove, 171 m peš, P18 nazaj« ali »P10, 20 m, P10 naprej« — na avtobusu se ostane.
        if (trip.route === cur.route) continue;
        const boardDep = trip.stops[idx][2];
        if (boardDep < minBoardTime) continue;
        const leave = cur.prev.kind === 'origin' ? boardDep - cur.prev.sec : cur.leave;
        const score = leave - cur.walk;
        for (let j = idx + 1; j < trip.stops.length; j++) {
          const alightId = trip.stops[j][0];
          const alightArr = trip.stops[j][1];
          if (!improves(alightArr, score, round, roundLabels.get(alightId))) continue;
          // Na končni postaji vožnje se na isto linijo sme naprej: krožna G3 na Taboru,
          // P10 in P15 na Avtobusni postaji. Tam ostati na avtobusu po voznem redu ne gre,
          // prepoved pa je vzela tudi edine poti (8 od 300 iskanj pozneje, eno brez poti).
          const route = j === trip.stops.length - 1 ? -1 : trip.route;
          const lbl: Label = { time: alightArr, stop: alightId, route, leave, walk: cur.walk, round, prev: { kind: 'bus', from: cur, trip, boardIdx: idx, alightIdx: j } };
          roundLabels.set(alightId, lbl);
          busLabels.set(alightId, lbl);
        }
      }
    }

    // Prehod peš z istim obvozom kot hoja do prve postaje: brez njega je »ena postaja z
    // avtobusom + 301 m peš« premagala hojo naravnost do postaje druge linije (427 m).
    const nextMarked = new Set<number>(busLabels.keys());
    for (const [sid, bl] of busLabels) {
      for (const { id: nid, m } of nearByStop.get(sid) || []) {
        const sec = (m * URBAN_DETOUR) / WALK_MPS;
        const t = bl.time + sec;
        const walk = bl.walk + sec;
        if (!improves(t, bl.leave - walk, round, roundLabels.get(nid))) continue;
        roundLabels.set(nid, { time: t, stop: nid, route: bl.route, leave: bl.leave, walk, round, prev: { kind: 'walk', from: bl, sec, meters: m * URBAN_DETOUR } });
        nextMarked.add(nid);
      }
    }

    labelsByRound.push(roundLabels);
    if (nextMarked.size === 0) break;
    marked = nextMarked;
    prevRoundLabels = roundLabels;
  }

  // For each round (= max #buses used), find best egress
  const candidates: Candidate[] = [];
  for (let round = 1; round < labelsByRound.length; round++) {
    const L = labelsByRound[round];
    let best: Candidate | null = null;
    for (const e of egress) {
      const lbl = L.get(e.id);
      if (!lbl || lbl.prev.kind === 'origin') continue;
      const arrAtDest = lbl.time + e.sec;
      if (!best || arrAtDest < best.arr
        || (arrAtDest === best.arr && lbl.leave - lbl.walk - e.sec > best.label.leave - best.label.walk - best.egress.sec)) {
        best = { arr: arrAtDest, label: lbl, egress: e };
      }
    }
    if (best) candidates.push(best);
  }

  // Pure walk baseline — uporabljamo URBAN_DETOUR (1.35×), ker je haversine zračna
  // razdalja in v mestu podcenjuje realno hojo zaradi rek, križanj, enosmernih poti.
  const walkDirectM = dist(from, to);
  const walkDirectSec = (walkDirectM * URBAN_DETOUR) / WALK_MPS;
  const walkDirectArr = depSec + walkDirectSec;
  let plans: Plan[] = [];

  // Always include walk baseline if it's reasonable (<2 km ali <30 min)
  const walkPlan: Plan | null = walkDirectM < 2000 || walkDirectSec < 30 * 60
    ? {
        legs: [{
          kind: 'walk',
          fromLat: from.lat, fromLon: from.lon,
          toLat: to.lat, toLon: to.lon,
          sec: walkDirectSec,
          meters: walkDirectM * URBAN_DETOUR,
        }],
        depSec, arrSec: walkDirectArr, walkMeters: walkDirectM * URBAN_DETOUR, transfers: 0,
      }
    : null;

  // Reconstruct plan for each candidate (fewest-transfers first, then more but faster)
  // Pareto: keep only candidates that are faster than previous. Ker TRANSFER_PENALTY_SEC
  // že kaznuje dodatne prestope pri RAPTOR labelingu, tukaj zadostuje ≥60 s izboljšava.
  const pareto: Candidate[] = [];
  let bestSoFar = Infinity;
  for (const c of candidates) {
    if (c.arr < bestSoFar - 60) {
      pareto.push(c);
      bestSoFar = c.arr;
    }
  }

  for (const c of pareto) plans.push(reconstruct(c, stopById, routeById, from, to));
  if (opts.raw) return plans;

  // Walk-dominance filter: če transit plan ne prihrani vsaj 2 min vs. direktna hoja,
  // ga ne kažemo — uporabnik raje hodi kot da po nesmiselni zanki išče postajo.
  // Primer nesmisla: peš 8 min do postaje + avtobus 5 min nazaj + peš 2 min = 15 min,
  // ko bi peš naravnost trajalo 12 min. Izjema: ko je hoja daljša od 30 min (nad 2.5 km),
  // uporabnik pogosto raje seda v avtobus tudi če je marginalno podoben čas.
  const walkIsLong = walkDirectSec > 30 * 60;
  const MIN_TRANSIT_SAVING_SEC = 120;
  // Avtobus kot druga možnost, kadar je hoja hitrejša (evalvacija 04.10.2026, N4): za
  // Glavni trg → Europark (900 m) je bila edina možnost hoja — slepa ulica za starejše,
  // ob dežju ali s prtljago. Ostane najhitrejša pot z avtobusom, ki hojo skrajša vsaj
  // za tretjino in pride največ 15 min za hojo; zgornja nesmiselna zanka še vedno odpade.
  // Najhitrejše poti iz prvega izračuna pogosto začnejo z dolgo hojo do »hitrejše«
  // postaje (v 68 od 85 časov ni bilo nobene ustrezne; pregled 05.10.), zato se ob
  // neuspehu izračun ponovi s hojo do postaje največ 400 m. Pod 400 m naravnost ne.
  let lessWalk: Plan | null = null;
  if (!walkIsLong) {
    const all = plans;
    plans = plans.filter(p => p.arrSec + MIN_TRANSIT_SAVING_SEC < walkDirectArr);
    if (plans.length === 0 && walkDirectM >= 400) {
      const walkSec = (p: Plan) => p.legs.reduce((s, l) => s + (l.kind === 'walk' ? l.sec : 0), 0);
      const ok = (p: Plan) => walkSec(p) <= walkDirectSec * 0.67 && p.arrSec <= walkDirectArr + 15 * 60;
      const best = (list: Plan[]) => list.filter(ok).sort((a, b) => a.arrSec - b.arrSec)[0] ?? null;
      lessWalk = best(all)
        ?? best(planAll(gtfs, from, to, depSec, when, accessMap, egressMap, { maxAccessM: 400, raw: true }));
    }
  }

  // »Manj hoje« brez prestopa, ki pride celo prej kot hoja, je boljša na obeh merilih (in ni
  // zanka iz filtra zgoraj): postane navaden predlog in s tem priporočena, hoja ostane kot
  // možnost. Prej je bila »priporočena« počasnejša hoja (ponovna ocena 05.10.2026). S
  // prestopom ostane druga možnost z oznako, ker razvrstitev da prednost manj prestopom.
  let keepWalk = false;
  if (lessWalk && lessWalk.transfers === 0 && lessWalk.arrSec <= walkDirectArr) {
    plans = [lessWalk];
    lessWalk = null;
    keepWalk = true;
  }

  if (walkPlan && !plans.some(p => p.transfers === 0 && p.legs.length === 1)) {
    // Only insert walk plan if it wins on time vs fastest transit plan
    if (!plans.length || keepWalk || walkDirectArr < plans[0].arrSec) plans.unshift(walkPlan);
  }

  if (plans.length === 0 && walkPlan) plans.push(walkPlan);

  // Sort: primary by transfers asc, secondary by arrSec asc
  plans.sort((a, b) => a.transfers - b.transfers || a.arrSec - b.arrSec);

  // Dedup: if two plans have same transfers & arrSec, keep one
  const seen = new Set<string>();
  const out: Plan[] = [];
  for (const p of plans) {
    // Hoja ima svoj ključ: povišana »manj hoje« pride v isti minuti kot hoja in bi jo
    // sicer izrinila (pregled kode 05.10.2026: v 13 od 72 primerov).
    const walkOnly = p.legs.length === 1 && p.legs[0].kind === 'walk';
    const k = walkOnly ? 'walk' : `${p.transfers}|${Math.round(p.arrSec / 60)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
    if (out.length >= 3) break;
  }
  if (lessWalk) out.push({ ...lessWalk, lessWalk: true });
  return out;
}

// Pot iz verige oznak. Peš odseki dobijo čas in razdaljo, s katerima je računal krog
// (obvoz ali matrika ORS), zato se »Kreni ob« ujema z avtobusom, ki ga je planer izbral.
function reconstruct(
  c: Candidate,
  stopById: Map<number, Stop>,
  routeById: Map<number, Route>,
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
): Plan {
  const legs: PlanLeg[] = [];
  let busCount = 0;
  let lbl = c.label;
  let p = lbl.prev;
  while (p.kind !== 'origin') {
    if (p.kind === 'bus') {
      const fromS = stopById.get(p.trip.stops[p.boardIdx][0])!;
      const toS = stopById.get(p.trip.stops[p.alightIdx][0])!;
      legs.unshift({
        kind: 'bus',
        route: routeById.get(p.trip.route)!,
        tripId: p.trip.id,
        headsign: p.trip.headsign,
        from: fromS, to: toS,
        depSec: p.trip.stops[p.boardIdx][2],
        arrSec: p.trip.stops[p.alightIdx][1],
        stopCount: p.alightIdx - p.boardIdx,
        shapeId: p.trip.shape,
      });
      busCount++;
    } else {
      const a = stopById.get(p.from.stop)!;
      const b = stopById.get(lbl.stop)!;
      legs.unshift({
        kind: 'walk',
        fromLat: a.lat, fromLon: a.lon,
        toLat: b.lat, toLon: b.lon,
        sec: p.sec, meters: p.meters,
        fromStop: a, toStop: b,
      });
    }
    lbl = p.from;
    p = lbl.prev;
  }

  const firstStop = stopById.get(lbl.stop)!;
  legs.unshift({
    kind: 'walk',
    fromLat: from.lat, fromLon: from.lon,
    toLat: firstStop.lat, toLon: firstStop.lon,
    sec: p.sec, meters: p.meters,
    toStop: firstStop,
  });

  const lastStop = stopById.get(c.label.stop)!;
  legs.push({
    kind: 'walk',
    fromLat: lastStop.lat, fromLon: lastStop.lon,
    toLat: to.lat, toLon: to.lon,
    sec: c.egress.sec, meters: c.egress.meters,
    fromStop: lastStop,
  });

  const walkMeters = legs.reduce((acc, l) => acc + (l.kind === 'walk' ? l.meters : 0), 0);
  return { legs, depSec: c.label.leave, arrSec: c.arr, walkMeters, transfers: Math.max(0, busCount - 1) };
}

// Izbrani čas (»Odhod ob« / »Prihod do«), ki je več kot 15 min mimo, pomeni jutri: večerno
// iskanje za 07:00 je prej iskalo po današnjem, že preteklem voznem redu, v petek zvečer celo
// po delavniškem namesto po sobotnem. Do 15 min mimo pomeni od zdaj (pregled 12.10.2026).
const PAST_MEANS_TOMORROW_SEC = 15 * 60;
export function searchDay(chosenSec: number, nowSec: number): 'today' | 'now' | 'tomorrow' {
  if (chosenSec >= nowSec) return 'today';
  return nowSec - chosenSec > PAST_MEANS_TOMORROW_SEC ? 'tomorrow' : 'now';
}

// Pot za jutri: vsi časi + 24 h, kot v GTFS (24:10 je 00:10 naslednji dan). Odštevanje
// »Kreni čez …« in opozorilo »Ta odhod je mimo« (koraki poti, branje na glas) tako računata
// od zdaj pravilno, ura pa se izpiše enako, ker fmtClock vzame ostanek pri 24 h.
export const DAY_SEC = 24 * 3600;
export function shiftPlan(p: Plan, sec: number): Plan {
  return {
    ...p,
    depSec: p.depSec + sec,
    arrSec: p.arrSec + sec,
    legs: p.legs.map(l => (l.kind === 'bus' ? { ...l, depSec: l.depSec + sec, arrSec: l.arrSec + sec } : l)),
  };
}

// »Prihod do«: najpoznejši odhodi, ki še pridejo pravočasno. Iskanje gre od ciljnega časa
// nazaj po 20 min, a nikoli pred `earliestSec` (zdaj). Prej je segalo uro v preteklost in je
// ob 09:50 za »Prihod do 10:20« ponudilo »P17 ob 09:33«; ista vožnja iz več iskanj je bila
// v seznamu dvakrat ali trikrat, trajanje pa šteto od časa iskanja (pregled 12.10.2026).
// Zdaj je ena vožnja en predlog (linija, vožnja in postaja vstopa), razvrščeno po tem, kdaj
// je treba kreniti, najpoznejši prvi.
export function planArriveBy(
  gtfs: GTFS,
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  targetSec: number,
  earliestSec: number,
  when: Date = nowMb(),
  accessMap?: WalkMap,
  egressMap?: WalkMap,
): Plan[] {
  const STEP_SEC = 20 * 60, SPAN_SEC = 180 * 60, GRACE_SEC = 60;
  const byTrips = new Map<string, Plan>();
  for (let back = STEP_SEC; back <= SPAN_SEC; back += STEP_SEC) {
    const ds = Math.max(targetSec - back, earliestSec);
    for (const p of planAll(gtfs, from, to, ds, when, accessMap, egressMap)) {
      if (p.arrSec > targetSec) continue;
      const buses = p.legs.filter((l): l is BusLeg => l.kind === 'bus');
      // Samo peš ni vezano na vozni red: krene se tako, da pride ob izbranem času.
      const q = buses.length ? p : { ...p, depSec: targetSec - (p.arrSec - p.depSec), arrSec: targetSec };
      if (q.depSec < earliestSec - GRACE_SEC) continue;
      const key = buses.length ? buses.map(b => `${b.route.id}:${b.tripId}:${b.from.id}`).join('+') : 'walk';
      const seen = byTrips.get(key);
      if (!seen || q.arrSec < seen.arrSec) byTrips.set(key, q);
    }
    if (byTrips.size >= 3 || ds <= earliestSec) break;
  }
  return [...byTrips.values()]
    .sort((a, b) => b.depSec - a.depSec || a.arrSec - b.arrSec || a.transfers - b.transfers)
    .slice(0, 3);
}

// Backwards-compat wrapper — returns first (fewest-transfers) plan
export function plan(
  gtfs: GTFS,
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  depSec: number,
  when: Date = nowMb()
): Plan | null {
  const all = planAll(gtfs, from, to, depSec, when);
  return all[0] ?? null;
}
