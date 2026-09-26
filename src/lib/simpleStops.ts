import { tr } from './i18n';
import { todayServiceIds, type GTFS, type Stop } from './gtfs';

// Pomoč za preprost pogled: opis postajališča, iskanje po imenu in linije na
// postajališču (za čarovnik opomnikov).

// ── Opis postajališča: "G6, P16 · smer Kamnica" ─────────────────────────────
//
// Postajališči z istim imenom sta običajno par čez cesto; brez smeri ju uporabnik
// ne loči. Izpeljano iz voznega reda (vse vožnje, ne samo današnje), zato opis
// obstaja tudi ponoči. Smer je ime zadnje postaje vožnje; vožnje, ki se tu
// končajo, ne štejejo — s končne postaje se v to smer ne odpelje nič.

type Info = { lines: string[]; dests: string[] };
const cache = new WeakMap<GTFS, Map<number, Info>>();

function build(g: GTFS): Map<number, Info> {
  const routeShort = new Map(g.routes.map(r => [r.id, r.short]));
  const names = new Map(g.stops.map(s => [s.id, s.name]));
  const acc = new Map<number, { lines: Set<string>; dests: Map<string, number> }>();
  for (const tr0 of g.trips) {
    const last = tr0.stops[tr0.stops.length - 1];
    const dest = last ? names.get(last[0]) ?? '' : '';
    const line = routeShort.get(tr0.route) ?? tr0.short;
    for (let i = 0; i < tr0.stops.length - 1; i++) {
      const id = tr0.stops[i][0];
      let a = acc.get(id);
      if (!a) { a = { lines: new Set(), dests: new Map() }; acc.set(id, a); }
      a.lines.add(line);
      // Krožna vožnja se konča tam, kjer se začne: "smer Stražun" na Stražunu ne pove nič.
      if (dest && dest !== names.get(id)) a.dests.set(dest, (a.dests.get(dest) ?? 0) + 1);
    }
  }
  const out = new Map<number, Info>();
  for (const [id, a] of acc) {
    out.set(id, {
      lines: [...a.lines].sort((x, y) => x.localeCompare(y, 'sl', { numeric: true })),
      dests: [...a.dests].sort((x, y) => y[1] - x[1]).map(([d]) => d),
    });
  }
  return out;
}

export function stopHint(g: GTFS, stopId: number): string {
  let m = cache.get(g);
  if (!m) { m = build(g); cache.set(g, m); }
  const info = m.get(stopId);
  if (!info) return '';
  const lines = info.lines.slice(0, 4).join(', ') + (info.lines.length > 4 ? ' …' : '');
  const dests = info.dests.slice(0, 2).join(', ');
  return dests ? `${lines} · ${tr('smer {dest}', { dest: dests })}` : lines;
}

// ── Iskanje po imenu ────────────────────────────────────────────────────────
//
// Brez šumnikov, ločil in velikih črk: "sentiljska poc" najde
// "Šentiljska - Počehovska" (vezaja nihče ne tipka). Vsaka vpisana beseda mora biti
// v imenu; najprej imena, ki se z iskanim začnejo.
export const normName = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim();

export function searchStops(g: GTFS | null, query: string, max = 20): Stop[] {
  const q = normName(query);
  if (!g || q.length < 2) return [];
  const words = q.split(' ');
  const hits = g.stops.filter(s => { const n = normName(s.name); return words.every(w => n.includes(w)); });
  hits.sort((a, b) => Number(normName(b.name).startsWith(q)) - Number(normName(a.name).startsWith(q))
    || a.name.localeCompare(b.name, 'sl'));
  return hits.slice(0, max);
}

// ── Linije in smeri na postajališču (čarovnik opomnikov) ─────────────────────
//
// Par (linija, smer) z najpogostejšim ciljem. Vožnje, ki se na postajališču
// končajo, ne štejejo — z njim se nikamor ne odpelje.
export type StopLine = { routeId: number; routeShort: string; dir: number; dest: string };

export function linesAtStop(g: GTFS, stopId: number): StopLine[] {
  const routeShort = new Map(g.routes.map(r => [r.id, r.short]));
  const names = new Map(g.stops.map(s => [s.id, s.name]));
  const acc = new Map<string, { routeId: number; dir: number; dests: Map<string, number> }>();
  for (const t of g.trips) {
    const i = t.stops.findIndex(st => st[0] === stopId);
    if (i < 0 || i === t.stops.length - 1) continue;
    const key = `${t.route}:${t.dir}`;
    let a = acc.get(key);
    if (!a) { a = { routeId: t.route, dir: t.dir, dests: new Map() }; acc.set(key, a); }
    // Krožna linija se konča tam, kjer začne: "smer TABOR" na TABOR-ju ne pove nič,
    // opis vožnje pa pove, kod pelje.
    const lastId = t.stops[t.stops.length - 1][0];
    const dest = lastId === stopId ? t.headsign : names.get(lastId) ?? t.headsign;
    a.dests.set(dest, (a.dests.get(dest) ?? 0) + 1);
  }
  return [...acc.values()]
    .map(a => ({
      routeId: a.routeId,
      routeShort: routeShort.get(a.routeId) ?? String(a.routeId),
      dir: a.dir,
      dest: [...a.dests].sort((x, y) => y[1] - x[1])[0]?.[0] ?? '',
    }))
    .sort((x, y) => x.routeShort.localeCompare(y.routeShort, 'sl', { numeric: true }) || x.dir - y.dir);
}

// Odhodi linije v smer s postajališča na dan (sekunde od polnoči), enako kot jih
// primerja computeOccurrences (st[2]). Brez obiska na koncu vožnje — prihod na
// končno ni odhod — in brez ur po polnoči (≥ 24:00), ki jih opomnik ne ujame.
export function departureTimes(g: GTFS, stopId: number, routeId: number, dir: number, date: Date): number[] {
  const active = todayServiceIds(g, date);
  const out = new Set<number>();
  for (const t of g.trips) {
    if (t.route !== routeId || t.dir !== dir || !active.has(t.service)) continue;
    for (let i = 0; i < t.stops.length - 1; i++) {
      const [id, , dep] = t.stops[i];
      if (id === stopId && dep && dep < 86400) out.add(dep);
    }
  }
  return [...out].sort((a, b) => a - b);
}

// Vzorčni datum za dan v tednu `wd` (0 = ponedeljek) v naslednjih štirih tednih:
// dan s prometom in brez izjeme v voznem redu (praznik z nedeljskim voznim redom).
// Dan brez prometa (npr. že zunaj veljavnosti voznega reda) ne pride v poštev; če
// je praznik edini dan s prometom, se vzame ta.
export function sampleDate(g: GTFS, wd: number, from = new Date()): Date | null {
  const exc = new Set(g.exceptions.map(e => e.date));
  let fallback: Date | null = null;
  for (let k = 0; k < 28; k++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + k, 12);
    if ((d.getDay() + 6) % 7 !== wd || todayServiceIds(g, d).size === 0) continue;
    const key = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    if (!exc.has(key)) return d;
    fallback ??= d;
  }
  return fallback;
}
