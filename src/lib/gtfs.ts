import { tr } from './i18n';

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
  shapesLoading = fetch(`${BASE}/shapes.json`)
    .then(r => { if (!r.ok) throw new Error('shapes.json ' + r.status); return r.json(); })
    .then((arr: Shape[]) => {
      shapesCached = new Map(arr.map(s => [s.id, s]));
      return shapesCached;
    })
    .catch(err => {
      // Počisti loading, da retry požene nov fetch (sicer vsi naslednji klici
      // dobijo isti rejected promise). Enak vzorec kot loadGTFS.
      shapesLoading = null;
      throw err;
    });
  return shapesLoading;
}

// Vse stop ID-je, ki jih obiščejo linije (route-i), ki vozijo preko podanega stop-a.
// Uporaba: pri izbiri postaje skrijemo ostala postajališča, ki niso na teh linijah.
export function stopsOnSameRoutes(gtfs: GTFS, stopId: number): Set<number> {
  const routes = new Set<number>();
  for (const t of gtfs.trips) {
    for (const st of t.stops) {
      if (st[0] === stopId) { routes.add(t.route); break; }
    }
  }
  const out = new Set<number>();
  for (const t of gtfs.trips) {
    if (!routes.has(t.route)) continue;
    for (const st of t.stops) out.add(st[0]);
  }
  return out;
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
// tudi pri sosednjih linijah kot sta P16 in G3. Barve so lastne (ne Marpromove),
// zato jih lahko prilagodimo za berljivost napisa.
const ROUTE_PALETTE = [
  '#E53935', '#1E88E5', '#43A047', '#FB8C00', '#8E24AA', '#00ACC1',
  '#C62828', '#6D4C41', '#3949AB', '#7CB342', '#D81B60', '#00897B',
  '#5E35B1', '#C0CA33', '#F4511E', '#546E7A', '#AB47BC', '#26A69A',
  '#EC407A', '#66BB6A', '#FFA726', '#42A5F5', '#EF5350', '#5C6BC0',
];

const DARK_TEXT = '#1C1C1E';

// Relativna svetilnost po WCAG 2.x.
function luminance(hex: string): number {
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(parseInt(hex.slice(1, 3), 16) / 255)
       + 0.7152 * lin(parseInt(hex.slice(3, 5), 16) / 255)
       + 0.0722 * lin(parseInt(hex.slice(5, 7), 16) / 255);
}
const contrastWhite = (L: number) => 1.05 / (L + 0.05);

// Napis na znački linije mora imeti vsaj 4,5 : 1 (WCAG 1.4.3) — axe je 04.10.2026
// našel bel napis na G3 2,64 : 1, G5 3,67 : 1 in G1 4,31 : 1. Svetle barve
// (L ≥ 0,30) dobijo temen napis (≥ 5,7 : 1); ostale bel napis na toliko
// potemnjeni barvi, da kontrast doseže 4,6 : 1. Potemnitev je množenje kanalov,
// zato odtenek ostane prepoznaven.
const LIGHT_FROM = 0.30;
function accessible(hex: string): { bg: string; fg: string } {
  if (luminance(hex) >= LIGHT_FROM) return { bg: hex, fg: DARK_TEXT };
  const ch = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  for (let f = 1; f > 0.3; f -= 0.01) {
    const c = '#' + ch.map(v => Math.round(v * f).toString(16).padStart(2, '0')).join('');
    if (contrastWhite(luminance(c)) >= 4.6) return { bg: c.toUpperCase(), fg: '#ffffff' };
  }
  return { bg: hex, fg: '#ffffff' };
}
const ROUTE_BADGES = ROUTE_PALETTE.map(accessible);

// Deterministic color per route id; multiplier 17 razprši sosednje ID-je.
function badgeOf(routeId: number) {
  const idx = ((routeId * 17) % ROUTE_BADGES.length + ROUTE_BADGES.length) % ROUTE_BADGES.length;
  return ROUTE_BADGES[idx];
}
export function routeColor(routeId: number): string {
  return badgeOf(routeId).bg;
}

// Tekst na barvni znački linije (bel ali temen, glej accessible).
export function routeTextColor(routeId: number): string {
  return badgeOf(routeId).fg;
}

// Isto pravilo za poljubno barvo (napis na avtobusu na karti, ki pozna samo barvo).
export function textOnColor(hex: string): string {
  return /^#[0-9a-f]{6}$/i.test(hex) && luminance(hex) >= LIGHT_FROM ? DARK_TEXT : '#ffffff';
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
  // Krožni shape (pts[0] ≈ pts[N-1]): če iFrom > iTo, ne reverse-aj čez celo pot
  // (to bi narisalo bus nazaj skozi celo zanko), ampak naredi forward wrap:
  // iFrom → konec + začetek → iTo.
  const last = shape.pts[shape.pts.length - 1];
  const first = shape.pts[0];
  const closed = shape.pts.length >= 3 && Math.abs(first[0] - last[0]) < 1e-5 && Math.abs(first[1] - last[1]) < 1e-5;
  if (closed && iFrom > iTo) {
    return [...shape.pts.slice(iFrom), ...shape.pts.slice(1, iTo + 1)];
  }
  const [lo, hi] = iFrom <= iTo ? [iFrom, iTo] : [iTo, iFrom];
  const seg = shape.pts.slice(lo, hi + 1);
  return iFrom <= iTo ? seg : seg.reverse();
}

let cached: GTFS | null = null;
let loading: Promise<GTFS> | null = null;

export type GtfsMeta = {
  built: string;
  counts: { stops: number; routes: number; trips: number; services: number };
};

let metaCached: GtfsMeta | null = null;
let metaLoading: Promise<GtfsMeta | null> | null = null;

export function loadMeta(): Promise<GtfsMeta | null> {
  if (metaCached) return Promise.resolve(metaCached);
  if (metaLoading) return metaLoading;
  metaLoading = fetch(`${BASE}/meta.json`)
    .then(r => { if (!r.ok) throw new Error('meta.json ' + r.status); return r.json(); })
    .then((j: GtfsMeta) => { metaCached = j; return j; })
    .catch(() => { metaLoading = null; return null; });
  return metaLoading;
}

export function loadGTFS(): Promise<GTFS> {
  if (cached) return Promise.resolve(cached);
  if (loading) return loading;
  const fetchJson = (name: string) => fetch(`${BASE}/${name}`).then(r => {
    if (!r.ok) throw new Error(`${name} HTTP ${r.status}`);
    return r.json();
  });
  loading = (async () => {
    try {
      // Meta in shapes prefetchamo paralelno z GTFS fetch-i — uspeh ni pogoj za GTFS,
      // a ko se vse naloži skupaj, sta meta in shapes že v cache-u za UI prikaz brez
      // dodatnega round-tripa. Shapes (~800 KB) so največji kos in edini blocker za
      // prvi render zemljevida — paralelni fetch odreže ~300–800 ms na 4G.
      const gtfsPromise = Promise.all([
        fetchJson('stops.json'),
        fetchJson('routes.json'),
        fetchJson('trips.json'),
        fetchJson('service.json'),
      ]);
      loadMeta();
      // Swallow napake — GTFS uspeh ne sme biti odvisen od shapes.
      loadShapes().catch(() => {});
      const [stops, routes, trips, service] = await gtfsPromise;
      cached = { stops, routes, trips, services: service.services, exceptions: service.exceptions };
      return cached;
    } catch (err) {
      // Počisti loading, da retry požene nov fetch (sicer bi vsi naslednji klici
      // dobili isti rejected promise in se nikoli ne bi poskusili znova).
      loading = null;
      throw err;
    }
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

// Ali feed sploh še pokriva dani datum (service obdobja se iztečejo!).
// Uporaba: opozorilo "vozni redi so zastareli" namesto tihega praznega seznama.
// Zakaj prek todayServiceIds: prej je zadoščalo, da KATERAKOLI služba pokriva datum.
// Septembra 2026 je delavniška služba potekla 31.08., sobotna in nedeljska pa sta veljali
// do 31.12. — ob ponedeljkih je bil seznam prazen, opozorilo pa skrito. Šteje samo
// služba, ki ta dan res vozi (dan v tednu + izjeme).
export function feedCoversDate(gtfs: GTFS, when: Date = new Date()): boolean {
  return todayServiceIds(gtfs, when).size > 0;
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
    const route = routeById.get(t.route);
    if (!route) continue;
    // Brez break: krožne linije obiščejo isto postajo večkrat v enem tripu
    // (158 tripov v feedu) — celoten vozni red mora pokazati VSE obiske.
    // Razen zadnje postaje vožnje: to je prihod, ne odhod (vozni red postaje in opomniki
    // za odhod; enako upcomingDepartures).
    for (let i = 0; i < t.stops.length - 1; i++) {
      const st = t.stops[i];
      if (st[0] === stopId) out.push({ trip: t, route, depSec: st[2] });
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

// Prvi odhod s postaje na naslednjem dnevu, ki sploh ima vozni red (do 7 dni naprej).
// Zakaj: po zadnjem avtobusu je uporabnik prej videl samo "Danes ni več odhodov" —
// slepa ulica brez podatka, kdaj gre naslednji. Zanka čez dneve pokrije praznike in
// nedelje, kjer naslednji dan lahko sploh nima aktivnega servisa.
export function nextServiceDeparture(
  gtfs: GTFS,
  stopId: number,
  when: Date = new Date(),
): { trip: Trip; route: Route; depSec: number; dayOffset: number; weekday: number } | null {
  const routeById = new Map(gtfs.routes.map(r => [r.id, r]));
  for (let offset = 1; offset <= 7; offset++) {
    const day = new Date(when);
    day.setDate(day.getDate() + offset);
    day.setHours(12, 0, 0, 0); // poldne — izogne se poletnemu/zimskemu času na robu dneva
    const active = todayServiceIds(gtfs, day);
    if (active.size === 0) continue;
    let best: { trip: Trip; route: Route; depSec: number } | null = null;
    for (const t of gtfs.trips) {
      if (!active.has(t.service)) continue;
      const route = routeById.get(t.route);
      if (!route) continue;
      for (let i = 0; i < t.stops.length - 1; i++) {   // zadnja postaja je prihod
        const st = t.stops[i];
        if (st[0] !== stopId) continue;
        if (!best || st[2] < best.depSec) best = { trip: t, route, depSec: st[2] };
        break;
      }
    }
    if (best) return { ...best, dayOffset: offset, weekday: day.getDay() };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Smer proti središču mesta / iz njega.
//
// "Center" sta dve vozlišči, ki ju Mariborčan tako razume: Glavni trg in
// Avtobusna postaja. Obe imata po več postajališč (par čez cesto, perona), zato
// se ujemanje dela po IMENU in ne po id-ju — id-ji se ob novem feedu lahko
// premaknejo, imeni pa sta stabilni.
// ---------------------------------------------------------------------------
export const CENTER_STOP_NAMES = ['Glavni trg', 'Avtobusna postaja'];

export function isCenterStopName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return CENTER_STOP_NAMES.some(c => n.startsWith(c.toLowerCase()));
}

export type CenterDir = 'to' | 'from';

// Za vsako postajališče: katere vožnje od tod še pridejo v center (`to`) in
// katere so center že pustile za sabo (`from`). Ključ je linija + opis smeri;
// `lines` je groba rezerva za žive prihode iz OBA (glej matchesCenter).
export type CenterEntry = {
  toKeys: Set<string>; toLines: Set<string>;
  fromKeys: Set<string>; fromLines: Set<string>;
};
export type CenterIndex = Map<number, CenterEntry>;

export function departureKey(routeShort: string, headsign: string): string {
  return `${routeShort.trim().toLowerCase()}|${headsign.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

export function buildCenterIndex(gtfs: GTFS, when: Date = new Date()): CenterIndex {
  const active = todayServiceIds(gtfs, when);
  const centerIds = new Set(gtfs.stops.filter(s => isCenterStopName(s.name)).map(s => s.id));
  const routeById = new Map(gtfs.routes.map(r => [r.id, r]));
  const idx: CenterIndex = new Map();
  const entryFor = (id: number): CenterEntry => {
    let e = idx.get(id);
    if (!e) {
      e = { toKeys: new Set(), toLines: new Set(), fromKeys: new Set(), fromLines: new Set() };
      idx.set(id, e);
    }
    return e;
  };

  for (const t of gtfs.trips) {
    if (!active.has(t.service)) continue;
    const route = routeById.get(t.route);
    if (!route) continue;

    // Kje v tej vožnji leži center. Krožne linije ga obiščejo večkrat, zato
    // štejeta prvi in zadnji obisk: pred zadnjim center šele pride, po prvem
    // je že mimo.
    let first = -1, last = -1;
    for (let i = 0; i < t.stops.length; i++) {
      if (!centerIds.has(t.stops[i][0])) continue;
      if (first < 0) first = i;
      last = i;
    }
    if (first < 0) continue;

    const key = departureKey(route.short, t.headsign);
    const line = route.short.trim().toLowerCase();
    for (let i = 0; i < t.stops.length; i++) {
      const e = entryFor(t.stops[i][0]);
      if (i < last) { e.toKeys.add(key); e.toLines.add(line); }
      if (i > first) { e.fromKeys.add(key); e.fromLines.add(line); }
    }
  }
  return idx;
}

// Ali s tega postajališča sploh vozi kaj v izbrano smer.
export function stopServesCenter(e: CenterEntry | undefined, dir: CenterDir): boolean {
  if (!e) return false;
  return (dir === 'to' ? e.toLines.size : e.fromLines.size) > 0;
}

// Ali posamezen odhod ustreza izbrani smeri.
//
// Odhod iz voznega reda ima točen ključ (linija + opis smeri) in se odloči
// izključno po njem. Živ prihod iz OBA nosi svoj `LineDescription`, ki se z
// opisom iz voznega reda ne ujame vedno — zato `lineFallback`, ki dovoli
// odločitev po sami liniji. Cena rezerve: na redkih postajališčih, kjer ista
// linija z istim id-jem vozi v obe smeri (npr. Dogoše), se živ prihod pokaže v
// obeh načinih. Raje to, kot da bi skrili avtobus, ki v center res pelje.
export function matchesCenter(
  e: CenterEntry | undefined,
  dir: CenterDir,
  routeShort: string,
  headsign: string,
  opts: { lineFallback?: boolean } = {},
): boolean {
  if (!e) return false;
  const keys = dir === 'to' ? e.toKeys : e.fromKeys;
  if (keys.has(departureKey(routeShort, headsign))) return true;
  if (!opts.lineFallback) return false;
  const lines = dir === 'to' ? e.toLines : e.fromLines;
  return lines.has(routeShort.trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// Krajši zapis cilja.
//
// `headsign` v tem feedu ni cilj, ampak cel opis linije v obliki
// »izhodišče – vmes – cilj« ("Pobreška Europark - Univerzitetni kampus - Kamnica";
// preverjeno 04.10.2026: vseh 83 vzorcev razen krožne G3 ima ta vrstni red).
// Cel opis, odrezan s tremi pikami, je pokazal izhodišče namesto cilja — na
// postajališčih z istim imenom na obeh straneh ceste je bila to napačna smer.
// Zato: cilj je zadnji del opisa (tako kot na avtobusu in enako za žive prihode in
// vozni red), »prek« so samo vmesni deli, izhodišča ni nikjer.
//
// `destination` (ime zadnje postaje vožnje) je samo rezerva za opis brez delov.
// Krožna linija se konča tam, kjer začne: cilj je »Krožna prek <prva točka za
// izhodiščem>« — ta loči obe smeri kroga (sama »Krožna linija« je na paru
// postajališč čez cesto obe strani označila enako; pregled kode 05.10.2026).
// ---------------------------------------------------------------------------
// Vezaj loči dele samo s presledkom na vsaj eni strani (»Prlek- Gosposvetska«),
// »Limbuš-Pekre« ostane eno ime.
const HEADSIGN_SEP = /\s+[-–—]\s*|\s*[-–—]\s+/;

export function splitHeadsign(headsign: string, destination?: string, circular = false): { dest: string; via: string } {
  const h = String(headsign ?? '');
  const parts = h.split(HEADSIGN_SEP).map(p => p.trim()).filter(Boolean);
  if (circular && parts.length > 1) {
    return { dest: tr('Krožna prek {kraj}', { kraj: parts[1] }), via: parts.slice(2).join(', ') };
  }
  if (parts.length <= 1) return { dest: (destination || parts[0] || h).trim(), via: '' };
  return { dest: parts[parts.length - 1], via: parts.slice(1, -1).join(', ') };
}

// Krožne linije: večina voženj se konča na postajališču z imenom, s katerim se začne.
const circularCache = new WeakMap<GTFS, Set<string>>();
export function isCircularRoute(gtfs: GTFS | null, routeShort: string): boolean {
  if (!gtfs) return false;
  let set = circularCache.get(gtfs);
  if (!set) {
    const name = new Map(gtfs.stops.map(s => [s.id, s.name.trim().toLowerCase()]));
    const count = new Map<number, { all: number; loop: number }>();
    for (const t of gtfs.trips) {
      const a = t.stops[0], b = t.stops[t.stops.length - 1];
      if (!a || !b) continue;
      const c = count.get(t.route) ?? { all: 0, loop: 0 };
      c.all++;
      if (name.get(a[0]) === name.get(b[0])) c.loop++;
      count.set(t.route, c);
    }
    set = new Set(gtfs.routes.filter(r => {
      const c = count.get(r.id);
      return !!c && c.loop * 2 > c.all;
    }).map(r => r.short.trim().toLowerCase()));
    circularCache.set(gtfs, set);
  }
  return set.has(routeShort.trim().toLowerCase());
}

// Cilj in vmesne točke za prikaz odhoda (vse vrstice odhodov v aplikaciji).
// Brez podanega `gtfs` (glasno branje, koraki poti) se vzame naloženi vozni red.
export function rowTarget(gtfs: GTFS | null, routeShort: string, headsign: string, destination?: string) {
  return splitHeadsign(headsign, destination, isCircularRoute(gtfs ?? cached, String(routeShort ?? '')));
}

// Izhodišče vožnje (prvi del opisa) za glavo voznega reda linije, kjer izbirnik postaje
// piše »od izhodišča«; '' pri opisu brez delov.
export function headsignOrigin(headsign: string): string {
  const parts = String(headsign ?? '').split(HEADSIGN_SEP).map(p => p.trim()).filter(Boolean);
  return parts.length > 1 ? parts[0] : '';
}

// Kje se vožnje končajo in od kod odpeljejo, po postajališču in ključu (linija + opis).
// Živ prihod OBA ne pove, ali se vožnja tu konča; ime cilja ni zanesljivo (P13 »Avtobusna
// postaja - Stražun« gre mimo enega Stražuna in se konča na drugem; P10 »… Mlinska AP« se
// konča na »Avtobusna postaja«; pregled kode 05.10.2026), zato odloča vozni red.
type StopTripIndex = Map<number, { ends: Set<string>; departs: Set<string> }>;
const stopTripIndex = new WeakMap<GTFS, StopTripIndex>();
function tripIndex(g: GTFS): StopTripIndex {
  let idx = stopTripIndex.get(g);
  if (!idx) {
    idx = new Map();
    const short = new Map(g.routes.map(r => [r.id, r.short]));
    for (const t of g.trips) {
      const k = departureKey(short.get(t.route) ?? '', t.headsign);
      t.stops.forEach((st, i) => {
        let e = idx!.get(st[0]);
        if (!e) idx!.set(st[0], e = { ends: new Set(), departs: new Set() });
        (i === t.stops.length - 1 ? e.ends : e.departs).add(k);
      });
    }
    stopTripIndex.set(g, idx);
  }
  return idx;
}

// Živ prihod vožnje, ki se na tem postajališču konča (in s tem opisom od tu nikoli ne
// odpelje). Neznan opis iz OBA se ne skrije.
export function endsAtStopId(g: GTFS, stopId: number, routeShort: string, headsign: string): boolean {
  const e = tripIndex(g).get(stopId);
  const k = departureKey(String(routeShort ?? ''), String(headsign ?? ''));
  return !!e && e.ends.has(k) && !e.departs.has(k);
}

// Ali s postajališča sploh kaj odpelje (katerikoli dan). Nekatera so samo za izstop
// na končni postaji (npr. Nova vas za G2): tam »Danes ni več odhodov« ne drži.
export function departsFromStop(g: GTFS, stopId: number): boolean {
  return (tripIndex(g).get(stopId)?.departs.size ?? 0) > 0;
}

// Ime zadnje postaje vožnje — pravi cilj, neodvisen od zapisa opisa linije.
export function tripDestination(gtfs: GTFS, trip: Trip, stopNames?: Map<number, string>): string {
  const last = trip.stops[trip.stops.length - 1];
  if (!last) return '';
  const names = stopNames ?? new Map(gtfs.stops.map(s => [s.id, s.name]));
  return names.get(last[0]) ?? '';
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
    const route = routeById.get(t.route);
    if (!route) continue;
    // Pri krožnih linijah trip obišče isto postajo dvakrat — če je prvi obisk
    // že mimo, velja naslednji (prej: break na prvem → drugi obisk neviden).
    // Zadnja postaja vožnje je prihod, ne odhod: na končni postaji je bil sicer med
    // odhodi avtobus, ki se tu konča (ponovna ocena 05.10.2026).
    for (let i = 0; i < t.stops.length - 1; i++) {
      const st = t.stops[i];
      if (st[0] !== stopId) continue;
      const dep = st[2];
      if (dep < nowSec) continue;
      out.push({ trip: t, route, depSec: dep, minutesFromNow: Math.round((dep - nowSec) / 60) });
      break;
    }
  }
  out.sort((a, b) => a.depSec - b.depSec);
  return out.slice(0, k);
}
