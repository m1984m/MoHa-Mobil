// Zgoščen zapis voženj (public/gtfs/trips2.json).
//
// 2.064 voženj ima le 144 različnih vzorcev (zaporedje postajališč + časi glede na prvi
// odhod), zato vsaka vožnja nosi samo številko vzorca in začetni čas: 208 kB stisnjeno
// → 18 kB (analiza hitrosti 09.11.2026). Aplikacija ob nalaganju vožnje razširi nazaj v
// isti `Trip[]`, zato se koda nad podatki ne spremeni.
//
// Modul bere tudi Node neposredno (scripts/build-gtfs.mjs), zato sme vsebovati samo tipe,
// ki se dajo izbrisati (brez enum, brez uvozov z vrednostmi iz aplikacije).

export type FullTrip = {
  id: number; route: number; service: number; headsign: string; short: string;
  dir: number; shape: number | null; stops: [number, number, number][];
};

/** Vzorec: postajališča, prihodi glede na prvi prihod, postanki (odhod − prihod) ali 0, če so vsi nič. */
export type TripPattern = [stops: number[], offs: number[], dwell: number[] | 0];
/** Vožnja: id, linija, služba, indeks cilja, kratko ime, smer, trasa, indeks vzorca, prvi prihod. */
export type PackedTrip = [number, number, number, number, string, number, number | null, number, number];
export type PackedTrips = { v: 1; heads: string[]; pats: TripPattern[]; trips: PackedTrip[] };

export function packTrips(trips: FullTrip[]): PackedTrips {
  const heads: string[] = [];
  const headIdx = new Map<string, number>();
  const pats: TripPattern[] = [];
  const patIdx = new Map<string, number>();
  const out: PackedTrip[] = [];
  for (const t of trips) {
    let h = headIdx.get(t.headsign);
    if (h == null) { h = heads.length; heads.push(t.headsign); headIdx.set(t.headsign, h); }
    const start = t.stops.length ? t.stops[0][1] : 0;
    const ids = t.stops.map(s => s[0]);
    const offs = t.stops.map(s => s[1] - start);
    const dwell = t.stops.map(s => s[2] - s[1]);
    const anyDwell = dwell.some(d => d !== 0);
    const key = ids.join(',') + '|' + offs.join(',') + (anyDwell ? '|' + dwell.join(',') : '');
    let p = patIdx.get(key);
    if (p == null) { p = pats.length; pats.push([ids, offs, anyDwell ? dwell : 0]); patIdx.set(key, p); }
    out.push([t.id, t.route, t.service, h, t.short, t.dir, t.shape, p, start]);
  }
  return { v: 1, heads, pats, trips: out };
}

export function unpackTrips(p: PackedTrips): FullTrip[] {
  if (!p || p.v !== 1 || !Array.isArray(p.trips) || !Array.isArray(p.pats) || !Array.isArray(p.heads)) {
    throw new Error('trips2.json: neznan zapis');
  }
  const out: FullTrip[] = new Array(p.trips.length);
  for (let i = 0; i < p.trips.length; i++) {
    const [id, route, service, h, short, dir, shape, pi, start] = p.trips[i];
    const pat = p.pats[pi];
    if (!pat) throw new Error('trips2.json: vzorec ' + pi + ' ne obstaja');
    const [ids, offs, dwell] = pat;
    if (p.heads[h] === undefined || offs.length !== ids.length || (dwell !== 0 && dwell.length !== ids.length)) {
      throw new Error('trips2.json: pokvarjen zapis vožnje ' + id);
    }
    const stops: [number, number, number][] = new Array(ids.length);
    for (let k = 0; k < ids.length; k++) {
      const arr = start + offs[k];
      stops[k] = [ids[k], arr, dwell === 0 ? arr : arr + dwell[k]];
    }
    out[i] = { id, route, service, headsign: p.heads[h], short, dir, shape, stops };
  }
  return out;
}
