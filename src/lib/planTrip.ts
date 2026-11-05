// Skupno jedro načrtovanja poti: načrtovalnik (PlannerModal), shranjene poti in povezave
// (App.buildAndShowPlan) računajo enako, tudi medkrajevno. Prej sta shranjena pot in
// povezava klicali samo mestni načrtovalnik z Marpromovim voznim redom, zato pot do Kopra
// ali Ljubljane od tam ni delovala (evalvacija 05.11.2026, F11).
import type { GTFS } from './gtfs';
import { cropShape, loadShapes, routeColor, dist } from './gtfs';
import { planAll, planArriveBy, searchDay, shiftPlan, DAY_SEC, syncArrivalWithWalks, dayNumber, type Plan, type WalkMap } from './planner';
import { walkRoute, walkMapForStops, walkRoutingDegraded } from './routing';
import { nowMb, nowSecMb } from './clock';
import { tr } from './i18n';
import { EXT, loadIjppSi, mergedGtfs, ijppCoversDate, outsideMaribor, modeOpts, type Mode } from './ijppPlan';

/** Vrsta kraja v predlogih: železniška ali avtobusna postaja, postajališče, kraj, naslov. */
export type PlaceKind = 'rail' | 'busStation' | 'stop' | 'town' | 'addr';
export type Place = { lat: number; lon: number; name: string; kind?: PlaceKind; town?: string };
export type TimeMode = 'now' | 'depart' | 'arrive';

export function parseHM(s: string): number {
  const [h, m] = s.split(':').map(x => parseInt(x, 10));
  if (!isFinite(h) || !isFinite(m)) return 0;
  return h * 3600 + m * 60;
}
// Datum za vozni red jutri: opoldne, da dan s premikom ure (23 ali 25 h) ne zamakne datuma.
export function tomorrowNoon(): Date {
  const n = nowMb();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 12, 0, 0);
}

export type TripQuery = {
  gtfs: GTFS;
  from: Place; to: Place;
  mode?: Mode;
  timeMode?: TimeMode;
  timeStr?: string;
  signal?: AbortSignal;
};
export type TripResult =
  | { ok: true; plans: Plan[]; tomorrow: boolean; lateTime: string | null; isInter: boolean }
  | { ok: false; error: string; aborted?: boolean };

const ABORTED: TripResult = { ok: false, error: '', aborted: true };

/** Poti od `from` do `to` z izbranim časom in načinom; za medkrajevno doda vozni red IJPP. */
export async function planTrip(q: TripQuery): Promise<TripResult> {
  const { gtfs, from, to, signal } = q;
  const mode: Mode = q.mode ?? 'all';
  const timeMode: TimeMode = q.timeMode ?? 'now';
  const timeStr = q.timeStr ?? '';
  const isInter = outsideMaribor(from) || outsideMaribor(to);

  // Stenski čas Maribora (clock.ts), ne ura telefona. Izbrani čas, ki je več kot 15 min
  // mimo, se išče za jutri (z jutrišnjim voznim redom, tudi sobotnim v petek zvečer); do
  // 15 min mimo od zdaj.
  const nowSec = nowSecMb();
  let day = timeMode === 'now' ? 'today' : searchDay(parseHM(timeStr), nowSec);
  let tomorrow = day === 'tomorrow';
  let when = tomorrow ? tomorrowNoon() : nowMb();
  let timeSec = timeMode === 'now' || day === 'now' ? nowSec : parseHM(timeStr);

  const network = async (w: Date): Promise<GTFS | string> => {
    if (!isInter) return gtfs;
    const si = await loadIjppSi(w);
    if (!si) return tr('Medkrajevnega voznega reda ni bilo mogoče naložiti. Preveri povezavo.');
    if (!ijppCoversDate(si, w)) return tr('Medkrajevni vozni red za ta dan še ni na voljo.');
    return mergedGtfs(gtfs, si, w);
  };
  let net0 = await network(when);
  if (signal?.aborted) return ABORTED;
  if (typeof net0 === 'string') return { ok: false, error: net0 };
  let net: GTFS = net0;

  const interOpts = isInter ? { maxRounds: 5, ...modeOpts(mode) } : {};
  // Matrike hoje za dostop in odhod: enkrat pred vsemi iteracijami »Prihod do«.
  const [accessMap, egressMap] = await Promise.all([
    walkMapForStops(from, net.stops, 1200, 25, signal),
    walkMapForStops(to, net.stops, 1200, 25, signal),
  ]);
  if (signal?.aborted) return ABORTED;

  const search = (n: GTFS, t: number, w: Date, tmrw: boolean): { plans: Plan[]; late: string | null } => {
    let plans: Plan[];
    let late: string | null = null;
    if (timeMode === 'arrive' && day !== 'now') {
      // Najpoznejši odhodi, ki pridejo do izbrane ure; danes nobeden pred zdaj.
      plans = planArriveBy(n, from, to, t, tmrw ? 0 : nowSec, w, accessMap, egressMap,
        isInter ? { ...interOpts, spanSec: 8 * 3600 } : {});
    } else {
      plans = planAll(n, from, to, t, w, accessMap, egressMap, interOpts);
      if (timeMode === 'arrive') late = timeStr;
    }
    if (isInter) {
      // Medkrajevno odloča prihod; prestop šteje kot 10 min, da pot z enim prestopom manj ne
      // izgubi zaradi nekaj minut. Čakanje na prestop nad 1 h šteje dvojno, da ponoči
      // čakanje na postaji (npr. Ljubljana 01:04 → 04:30) ni priporočeno samo zaradi
      // nekaj zgodnejšega prihoda.
      const maxWait = (p: Plan) => {
        let w = 0, prevArr: number | null = null;
        for (const l of p.legs) {
          if (l.kind !== 'bus') continue;
          if (prevArr != null) w = Math.max(w, l.depSec - prevArr);
          prevArr = l.arrSec;
        }
        return w;
      };
      const score = (p: Plan) => p.arrSec + p.transfers * 600 + Math.max(0, maxWait(p) - 3600);
      plans = plans
        .map(p => tightenAccess(p, gtfs, from, tmrw ? 0 : nowSec, w, accessMap))
        .sort((a, b) => score(a) - score(b));
    }
    return { plans, late };
  };

  let { plans, late: lateTime } = search(net, timeSec, when, tomorrow);

  // Medkrajevno »Zdaj« brez rezultata: prve jutrišnje povezave z oznako »jutri« (F5).
  if (isInter && timeMode === 'now' && plans.length === 0) {
    const w2 = tomorrowNoon();
    const n2 = await network(w2);
    if (signal?.aborted) return ABORTED;
    if (typeof n2 !== 'string') {
      day = 'tomorrow'; tomorrow = true; when = w2; timeSec = 0; net = n2;
      ({ plans, late: lateTime } = search(net, timeSec, when, true));
    }
  }

  // Jutrišnji časi + 24 h: odštevanje »Kreni čez …« in »Ta odhod je mimo« tako veljata.
  if (tomorrow) plans = plans.map(p => shiftPlan(p, DAY_SEC));
  if (signal?.aborted) return ABORTED;

  if (plans.length === 0) {
    // Razčlenjena diagnoza po razdalji do postajališč, ne po matrikah ORS (te so ob izpadu prazne).
    const nearStop = (p: { lat: number; lon: number }) => net.stops.some(s => dist(p, s) <= 1200);
    const error = !nearStop(from)
      ? tr('Izhodišče je predaleč od najbližjega postajališča (več kot 1,2 km). Izberi bližjo točko.')
      : !nearStop(to)
        ? tr('Cilj je predaleč od najbližjega postajališča (več kot 1,2 km). Izberi bližjo točko.')
        : isInter && mode !== 'all'
          ? tr('S tem načinom prevoza ni povezave — izberi »Vse« ali drug čas.')
          : tr('Ob izbranem času ni povezave — poskusi drug čas odhoda.');
    return { ok: false, error };
  }
  const baseDay = dayNumber(nowMb());
  return { ok: true, plans: plans.map(p => ({ ...p, baseDay })), tomorrow, lateTime, isInter };
}

// RAPTOR išče najzgodnejši prihod, zato vzame prvi mestni avtobus do postaje, tudi če vlak
// odpelje šele čez ure. Mestni del do prvega medkrajevnega vozila se zato izračuna nazaj od
// njegovega odhoda (5 min rezerve), z Marpromovim voznim redom dneva tega odhoda (pri
// jutrišnji vožnji jutrišnjim, časi + 24 h). Če to ne uspe, pot ostane, kot je.
const ACCESS_BUFFER_SEC = 5 * 60;
function tightenAccess(p: Plan, city: GTFS, from: Place, earliest: number, when: Date, accessMap: WalkMap): Plan {
  const k = p.legs.findIndex(l => l.kind === 'bus' && l.route.id >= EXT);
  if (k <= 0) return p;
  const ext = p.legs[k];
  if (ext.kind !== 'bus') return p;
  const off = ext.depSec >= DAY_SEC ? DAY_SEC : 0;
  const day = off ? new Date(when.getFullYear(), when.getMonth(), when.getDate() + 1, 12) : when;
  const target = ext.depSec - ACCESS_BUFFER_SEC;
  const access = planArriveBy(city, from, { lat: ext.from.lat, lon: ext.from.lon }, target - off, Math.max(0, earliest - off), day, accessMap);
  const best = access[0] && off ? shiftPlan(access[0], off) : access[0];
  if (!best || best.arrSec > target || best.depSec <= p.depSec) return p;
  const legs = [...best.legs, ...p.legs.slice(k)];
  const buses = legs.filter(l => l.kind === 'bus').length;
  return {
    ...p, legs, depSec: best.depSec,
    walkMeters: legs.reduce((a, l) => a + (l.kind === 'walk' ? l.meters : 0), 0),
    transfers: Math.max(0, buses - 1),
  };
}

/** Prestop, ki z dejansko pešpotjo (ORS) ni več izvedljiv. */
export type TransferIssue = { stop: string; needMin: number; haveMin: number };

export type Materialized = { shown: Plan; geoms: any[]; issues: TransferIssue[] };

/**
 * Izbrana pot s pešpotmi iz ORS in geometrijo za karto. Po zamenjavi ocenjene hoje se vsak
 * prestop preveri znova: prihod + hoja mora biti pred odhodom naslednjega vozila (F4).
 */
export async function materializePlan(chosen: Plan, signal?: AbortSignal): Promise<Materialized | null> {
  const shMap = await loadShapes();
  if (signal?.aborted) return null;
  // Kopija: seznam predlogov ostane pri ocenah, izbrana pot dobi pešpoti.
  const shown: Plan = { ...chosen, legs: chosen.legs.map(l => ({ ...l })) };
  const walks = await Promise.all(shown.legs.map(l => l.kind === 'walk'
    ? walkRoute({ lat: l.fromLat, lon: l.fromLon }, { lat: l.toLat, lon: l.toLon }, signal)
    : Promise.resolve(null)));
  if (signal?.aborted) return null;
  const geoms = shown.legs.map((leg, i) => {
    if (leg.kind === 'walk') {
      const wr = walks[i]!;
      // Zračna črta ob izpadu ORS je krajša od ocene načrtovalnika z obvozom — ta ostane.
      if (!wr.estimated) { leg.meters = wr.meters; leg.sec = wr.sec; }
      return { kind: 'walk' as const, coords: wr.coords, color: '#6B7280' };
    }
    const shape = leg.shapeId != null ? shMap.get(leg.shapeId) : null;
    const coords: [number, number][] = shape
      ? cropShape(shape, leg.from, leg.to).map(([lat, lon]) => [lon, lat])
      : leg.path && leg.path.length > 1
        ? leg.path.map(([lat, lon]) => [lon, lat] as [number, number])
        : [[leg.from.lon, leg.from.lat], [leg.to.lon, leg.to.lat]];
    return { kind: 'bus' as const, coords, color: routeColor(leg.route.id) };
  });
  shown.walkMeters = shown.legs.reduce((a, l) => a + (l.kind === 'walk' ? l.meters : 0), 0);
  // Odhod (Kreni ob) in prihod se poravnata s pešpotmi.
  syncArrivalWithWalks(shown);
  shown.walkEstimated = walks.some(w => !!w?.estimated);
  walkRoutingDegraded.set(shown.walkEstimated);
  return { shown, geoms, issues: transferIssues(shown) };
}

export function transferIssues(p: Plan): TransferIssue[] {
  const out: TransferIssue[] = [];
  let prevBus = -1;
  p.legs.forEach((l, i) => {
    if (l.kind !== 'bus') return;
    if (prevBus >= 0) {
      const prev = p.legs[prevBus];
      if (prev.kind === 'bus') {
        const walk = p.legs.slice(prevBus + 1, i).reduce((s, w) => s + (w.kind === 'walk' ? w.sec : 0), 0);
        if (prev.arrSec + walk > l.depSec) {
          out.push({ stop: l.from.name, needMin: Math.ceil(walk / 60), haveMin: Math.max(0, Math.floor((l.depSec - prev.arrSec) / 60)) });
        }
      }
    }
    prevBus = i;
  });
  return out;
}
