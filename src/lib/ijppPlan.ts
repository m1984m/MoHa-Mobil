// Načrtovanje poti po vsej Sloveniji: Marpromov vozni red + ves medkrajevni promet (IJPP:
// Arriva, Nomago, AP Murska Sobota, ostali prevozniki in vlaki SŽ; brez LPP).
//
// Vir je public/gtfs/ijpp-si.json (scripts/fetch-ijpp.mjs, npm run gtfs:ijpp), ~425 kB
// stisnjeno, naloži se šele ob prvem medkrajevnem iskanju. Za izbrani dan se medkrajevne
// vožnje pretvorijo v obliko Marpromovega GTFS (gtfs.ts) in združijo z njim, tako da isti
// načrtovalnik (planner.ts, RAPTOR) najde pot »mestni avtobus → vlak → avtobus → peš«.
//
// Številke: postajališča, linije in vožnje IJPP dobijo id od EXT naprej, da se ne
// prekrivajo z Marpromovimi. Medkrajevna služba je ena sama (EXT_SERVICE), ki velja vedno:
// katere vožnje vozijo, je odločeno že ob združevanju za izbrani dan.
import type { GTFS, Route, Stop, Trip } from './gtfs';
import { setExtRouteColor } from './gtfs';
import { dist } from './gtfs';

export const EXT = 1_000_000;
const EXT_SERVICE = 999_999;
// Območje Marproma: znotraj njega zadošča mestni načrtovalnik (hitrejši, brez prenosa).
const MB_CENTER = { lat: 46.5576, lon: 15.6456 };
const MB_RADIUS_M = 9000;

type Raw = {
  meta: { built: string; source: string; feedVersion?: string };
  start: string;
  agencies: [string, string][];
  routes: [number, string, number][];
  stops: [string, number, number][];
  heads: string[];
  days: string[];
  pats: number[][];
  trips: number[][];
};

export type Mode = 'all' | 'bus' | 'rail' | 'busRail';

export type IjppRouteInfo = { agency: string; rail: boolean; color: string };
const routeInfo = new Map<number, IjppRouteInfo>();
export function ijppRouteInfo(routeId: number): IjppRouteInfo | undefined {
  return routeInfo.get(routeId);
}
export const isExtRoute = (routeId: number) => routeId >= EXT;

let cached: Raw | null = null;
let loading: Promise<Raw | null> | null = null;

export function loadIjppSi(): Promise<Raw | null> {
  if (cached) return Promise.resolve(cached);
  if (loading) return loading;
  loading = fetch(import.meta.env.BASE_URL + 'gtfs/ijpp-si.json')
    .then(r => { if (!r.ok) throw new Error('ijpp-si.json ' + r.status); return r.json(); })
    .then((j: Raw) => { cached = j; return j; })
    .catch(() => { loading = null; return null; });
  return loading;
}

// »SŽ - Potniški promet, d.o.o.« → »SŽ«, »Arriva d.o.o.« → »Arriva«.
const shortAgency = (n: string) => n.split(/\s+-\s+|,/)[0].replace(/\s+d\.o\.o\.$/i, '').trim();

const ymd = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
function dayIndex(start: string, when: Date): number {
  const s = Date.UTC(+start.slice(0, 4), +start.slice(4, 6) - 1, +start.slice(6, 8));
  const w = Date.UTC(when.getFullYear(), when.getMonth(), when.getDate());
  return Math.round((w - s) / 86400000);
}

/** Ali je medkrajevni vozni red za ta dan na voljo (okno je 60 dni od gradnje). */
export function ijppCoversDate(j: Raw, when: Date): boolean {
  const i = dayIndex(j.start, when);
  return i >= 0 && i < (j.days[0]?.length ?? 0);
}

/** Zunaj mestnega območja (potrebuje medkrajevni promet). */
export function outsideMaribor(p: { lat: number; lon: number }): boolean {
  return dist(p, MB_CENTER) > MB_RADIUS_M;
}

const mergedCache = new Map<string, GTFS>();

/**
 * Marpromov GTFS + medkrajevne vožnje, ki vozijo na dan `when` (in vožnje prejšnjega dne
 * po polnoči, premaknjene za −24 h). Rezultat je predpomnjen po dnevu.
 */
export function mergedGtfs(gtfs: GTFS, j: Raw, when: Date): GTFS {
  const key = `${ymd(when)}|${j.meta.built}|${gtfs.trips.length}`;
  const hit = mergedCache.get(key);
  if (hit) return hit;

  const stops: Stop[] = gtfs.stops.slice();
  for (let i = 0; i < j.stops.length; i++) {
    const [name, lat, lon] = j.stops[i];
    stops.push({ id: EXT + i, name, lat, lon, code: null });
  }
  const routes: Route[] = gtfs.routes.slice();
  for (let i = 0; i < j.routes.length; i++) {
    const [ag, short, type] = j.routes[i];
    const [agName, agColor] = j.agencies[ag];
    const rail = type === 2;
    const color = rail ? '#1F6FB2' : (agColor || '#5B6770');
    // Avtobus železnice (nadomestni prevoz SŽ) ne sme izgledati kot vlak.
    const agShort = shortAgency(agName);
    const label = rail ? short : (agShort === 'SŽ' ? 'SŽ bus' : agShort);
    routes.push({ id: EXT + i, short: label, long: agShort, type });
    routeInfo.set(EXT + i, { agency: shortAgency(agName), rail, color });
    setExtRouteColor(EXT + i, color);
  }

  const today = dayIndex(j.start, when);
  const trips: Trip[] = gtfs.trips.slice();
  for (let ti = 0; ti < j.trips.length; ti++) {
    const row = j.trips[ti];
    const [ri, di, hi, pi, t0] = row;
    const bits = j.days[di];
    // Vožnja tega dne, ali vožnja prejšnjega dne, ki po polnoči še vozi.
    for (const [d, shift] of [[today, 0], [today - 1, -1440]] as const) {
      if (d < 0 || d >= bits.length || bits[d] !== '1') continue;
      const pat = j.pats[pi];
      const st: [number, number, number][] = [];
      let t = t0 + shift;
      for (let k = 0; k < pat.length; k++) {
        if (k > 0) t += row[4 + k];
        const sec = t * 60;
        st.push([EXT + pat[k], sec, sec]);
      }
      if (shift && st[st.length - 1][1] < 0) continue;
      trips.push({
        id: EXT + ti * 2 + (shift ? 1 : 0),
        route: EXT + ri, service: EXT_SERVICE, headsign: j.heads[hi],
        short: routes[gtfs.routes.length + ri].short, dir: 0, shape: null, stops: st,
      });
    }
  }

  const merged: GTFS = {
    stops, routes, trips,
    services: [...gtfs.services, { id: EXT_SERVICE, days: [1, 1, 1, 1, 1, 1, 1], start: '00000000', end: '99999999' }],
    exceptions: gtfs.exceptions,
  };
  mergedCache.clear();
  mergedCache.set(key, merged);
  return merged;
}

/** Filter voženj za izbran način. Marpromovi avtobusi so dovoljeni vedno (dostop do postaje). */
export function tripFilter(mode: Mode): ((t: Trip) => boolean) | undefined {
  if (mode === 'all' || mode === 'busRail') return undefined;
  if (mode === 'rail') return t => t.route < EXT || routeInfo.get(t.route)?.rail === true;
  return t => t.route < EXT || routeInfo.get(t.route)?.rail !== true;
}

/** »Avtobus + vlak«: pot mora imeti vsaj en vlak in vsaj en medkrajevni avtobus. */
export function planMatchesMode(legs: { kind: string; route?: Route }[], mode: Mode): boolean {
  const ext = legs.filter(l => l.kind === 'bus' && l.route && l.route.id >= EXT);
  if (mode === 'busRail') {
    return ext.some(l => routeInfo.get(l.route!.id)?.rail) && ext.some(l => !routeInfo.get(l.route!.id)?.rail);
  }
  return true;
}

/** Postajališča IJPP za iskanje cilja po imenu (»Koper AP«, »Ljubljana«). */
export function searchIjppStops(j: Raw, q: string, k = 6): { name: string; lat: number; lon: number }[] {
  const n = q.trim().toLowerCase();
  if (n.length < 2) return [];
  const seen = new Set<string>();
  const out: { name: string; lat: number; lon: number; score: number }[] = [];
  for (const [name, lat, lon] of j.stops) {
    const l = name.toLowerCase();
    const i = l.indexOf(n);
    if (i < 0 || seen.has(l)) continue;
    seen.add(l);
    out.push({ name, lat, lon, score: (i === 0 ? 0 : 1) * 1000 + name.length });
  }
  return out.sort((a, b) => a.score - b.score).slice(0, k);
}
