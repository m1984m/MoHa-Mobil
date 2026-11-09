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
import { setExtRouteColor, todayServiceIds } from './gtfs';
import { dist } from './gtfs';
import { EXT, ijppRouteInfo, setIjppRouteInfo } from './ijppInfo';

// EXT, ijppRouteInfo in isExtRoute živijo v ijppInfo.ts (majhen modul za začetni paket);
// od tu so izvoženi naprej za kodo načrtovalnika.
export { EXT, ijppRouteInfo, isExtRoute, type IjppRouteInfo } from './ijppInfo';
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


let cached: Raw | null = null;
let loading: Promise<Raw | null> | null = null;

// Različica v naslovu kot pri Marpromovih podatkih (gtfs.ts): service worker datoteke z `?v=`
// streže iz predpomnilnika samo za isto različico, brez nje pa je star medkrajevni vozni red
// ostal do konca seje (evalvacija 05.11.2026, F14). ijpp-si.json se objavi skupaj s paketom
// aplikacije, zato je različica paket (različica + SHA gradnje).
const IJPP_VER: string = [
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '',
  typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : '',
  typeof __GTFS_VER__ === 'string' ? __GTFS_VER__ : '',
].filter(Boolean).join('-');
const ijppUrl = (bust?: string) => {
  const base = import.meta.env.BASE_URL + 'gtfs/ijpp-si.json';
  const v = bust ?? IJPP_VER;
  return v ? `${base}?v=${encodeURIComponent(v)}` : base;
};

function fetchIjpp(url: string, init?: RequestInit): Promise<Raw> {
  return fetch(url, init)
    .then(r => { if (!r.ok) throw new Error('ijpp-si.json ' + r.status); return r.json(); });
}

/**
 * Medkrajevni vozni red. Z `forDate` se preveri, ali pokriva ta dan; če ne, se enkrat prenese
 * svež (mimo predpomnilnika brskalnika in service workerja), preden načrtovalnik odneha.
 */
export function loadIjppSi(forDate?: Date): Promise<Raw | null> {
  const base: Promise<Raw | null> = cached ? Promise.resolve(cached) : (loading ??= fetchIjpp(ijppUrl())
    .then((j: Raw) => { cached = j; return j; })
    .catch(() => { loading = null; return null; }));
  if (!forDate) return base;
  return base.then(async j => {
    if (j && ijppCoversDate(j, forDate)) return j;
    try {
      const fresh = await fetchIjpp(ijppUrl(`${IJPP_VER || 'r'}-${Date.now()}`), { cache: 'reload' });
      if (!j || fresh.meta.built !== j.meta.built) { cached = fresh; loading = Promise.resolve(fresh); }
      return fresh;
    } catch { return j; }
  });
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

// Službe Marproma za jutrišnje kopije voženj: vedno veljavna, kot EXT_SERVICE.
const MB_NEXT_TRIP = 3_000_000;

/**
 * Marpromov GTFS + medkrajevne vožnje, ki vozijo na dan `when`, vožnje prejšnjega dne po
 * polnoči (−24 h) in vožnje naslednjega dne (+24 h), skupaj z Marpromovimi vožnjami
 * naslednjega dne. Brez naslednjega dne večerno iskanje ni našlo poti, ki potrebuje prvo
 * jutranjo vožnjo (evalvacija 05.11.2026, F5). Rezultat je predpomnjen po dnevu.
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
    setIjppRouteInfo(EXT + i, { agency: shortAgency(agName), rail, color });
    setExtRouteColor(EXT + i, color);
  }

  const today = dayIndex(j.start, when);
  const trips: Trip[] = gtfs.trips.slice();
  for (let ti = 0; ti < j.trips.length; ti++) {
    const row = j.trips[ti];
    const [ri, di, hi, pi, t0] = row;
    const bits = j.days[di];
    // Vožnja tega dne, vožnja prejšnjega dne, ki po polnoči še vozi, in vožnja naslednjega dne.
    // Id: EXT + ti * 3 + (0 danes, 1 včeraj, 2 jutri).
    for (const [d, shift, slot] of [[today, 0, 0], [today - 1, -1440, 1], [today + 1, 1440, 2]] as const) {
      if (d < 0 || d >= bits.length || bits[d] !== '1') continue;
      const pat = j.pats[pi];
      const st: [number, number, number][] = [];
      let t = t0 + shift;
      for (let k = 0; k < pat.length; k++) {
        if (k > 0) t += row[4 + k];
        const sec = t * 60;
        st.push([EXT + pat[k], sec, sec]);
      }
      if (shift < 0 && st[st.length - 1][1] < 0) continue;
      trips.push({
        id: EXT + ti * 3 + slot,
        route: EXT + ri, service: EXT_SERVICE, headsign: j.heads[hi],
        short: routes[gtfs.routes.length + ri].short, dir: 0, shape: null, stops: st,
      });
    }
  }

  // Marpromove vožnje naslednjega dne (+24 h) za dostop do jutranjega vlaka ali avtobusa in
  // za mestni del po prihodu. Služba je vedno veljavna, izbor je narejen tu.
  const next = new Date(when.getFullYear(), when.getMonth(), when.getDate() + 1, 12);
  const nextActive = todayServiceIds(gtfs, next);
  for (let i = 0; i < gtfs.trips.length; i++) {
    const t = gtfs.trips[i];
    if (!nextActive.has(t.service)) continue;
    trips.push({
      ...t, id: MB_NEXT_TRIP + i, service: EXT_SERVICE,
      stops: t.stops.map(([s, a, d]) => [s, a + 86400, d + 86400] as [number, number, number]),
    });
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
  if (mode === 'rail') return t => t.route < EXT || ijppRouteInfo(t.route)?.rail === true;
  return t => t.route < EXT || ijppRouteInfo(t.route)?.rail !== true;
}

// Vrsta prevoza vožnje za stanje iskanja (planner.ts, opts.tripBits): vlak 1, medkrajevni
// avtobus 2, Marprom 0 (mestni avtobus ne šteje kot »bus« v »Bus + vlak«).
export const BIT_RAIL = 1, BIT_BUS = 2;
export function tripBits(t: Trip): number {
  if (t.route < EXT) return 0;
  return ijppRouteInfo(t.route)?.rail ? BIT_RAIL : BIT_BUS;
}

/**
 * Možnosti načrtovalnika za način: filter voženj in pri »Bus + vlak« zahteva po obeh vrstah
 * že med iskanjem, ne šele po izboru treh poti (evalvacija 05.11.2026, F2).
 */
export function modeOpts(mode: Mode): { tripOk?: (t: Trip) => boolean; tripBits?: (t: Trip) => number; needBits?: number; planOk?: (p: { legs: { kind: string; route?: Route }[] }) => boolean } {
  if (mode === 'busRail') {
    return { tripBits, needBits: BIT_RAIL | BIT_BUS, planOk: p => planMatchesMode(p.legs, mode) };
  }
  return { tripOk: tripFilter(mode) };
}

/** »Avtobus + vlak«: pot mora imeti vsaj en vlak in vsaj en medkrajevni avtobus. */
export function planMatchesMode(legs: { kind: string; route?: Route }[], mode: Mode): boolean {
  const ext = legs.filter(l => l.kind === 'bus' && l.route && l.route.id >= EXT);
  if (mode === 'busRail') {
    return ext.some(l => ijppRouteInfo(l.route!.id)?.rail) && ext.some(l => !ijppRouteInfo(l.route!.id)?.rail);
  }
  return true;
}

// Postajališča IJPP, na katerih ustavi vlak (indeksi v j.stops).
const railStopsCache = new WeakMap<Raw, Set<number>>();
function railStops(j: Raw): Set<number> {
  let s = railStopsCache.get(j);
  if (s) return s;
  s = new Set<number>();
  for (const row of j.trips) {
    if (j.routes[row[0]]?.[2] !== 2) continue;
    for (const k of j.pats[row[3]] ?? []) s.add(k);
  }
  railStopsCache.set(j, s);
  return s;
}

/** Vrsta zadetka za predloge: železniška ali avtobusna postaja oziroma postajališče. */
export type IjppStopKind = 'rail' | 'busStation' | 'stop';

/** Postajališča IJPP za iskanje cilja po imenu (»Koper AP«, »Ljubljana«). */
export function searchIjppStops(j: Raw, q: string, k = 6): { name: string; lat: number; lon: number; kind: IjppStopKind }[] {
  const n = q.trim().toLowerCase();
  if (n.length < 2) return [];
  const rail = railStops(j);
  // Isto ime ima lahko avtobusno postajališče in železniška postaja (»Koper«): ostane ena
  // vrstica, železniška postaja ima prednost.
  const byName = new Map<string, { name: string; lat: number; lon: number; kind: IjppStopKind; score: number }>();
  for (let si = 0; si < j.stops.length; si++) {
    const [name, lat, lon] = j.stops[si];
    const l = name.toLowerCase();
    const i = l.indexOf(n);
    if (i < 0) continue;
    const kind: IjppStopKind = rail.has(si) ? 'rail'
      : /\bAP\b|avtobusna postaja/i.test(name) ? 'busStation' : 'stop';
    const prev = byName.get(l);
    if (prev && (prev.kind === 'rail' || kind !== 'rail')) continue;
    byName.set(l, { name, lat, lon, kind, score: (i === 0 ? 0 : 1) * 1000 + name.length });
  }
  return [...byName.values()].sort((a, b) => a.score - b.score).slice(0, k).map(({ score, ...x }) => x);
}
