import { tr } from './i18n';
import type { GTFS } from './gtfs';

// Opis postajališča za sezname v preprostem pogledu: "G6, P16 · smer Kamnica".
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
