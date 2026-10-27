import { nowMb } from './clock';
import { dist } from './gtfs';

// Medkrajevni (IJPP) odhodi okolice Maribora: Arriva, Nomago, AP Murska Sobota, vlaki SŽ.
// Vir je ločena datoteka public/gtfs/ijpp.json (scripts/fetch-ijpp.mjs, npm run gtfs:ijpp),
// ki se z Marpromovim voznim redom ne meša in se naloži šele ob prvem odprtju postajališča.
// Oblika je opisana v fetch-ijpp.mjs.
type Raw = {
  meta: { built: string; source: string };
  start: string;
  agencies: [string, string][];
  routes: [number, string, number][];
  stops: [string, number, number][];
  heads: string[];
  days: string[];
  trips: [number, number, number, number[]][];
};

export type IjppDeparture = {
  agency: string;     // kratko ime prevoznika (Arriva, Nomago, SŽ …)
  color: string;      // barva prevoznika iz feeda
  line: string;       // oznaka linije iz feeda
  rail: boolean;      // vlak SŽ
  headsign: string;
  stopName: string;   // ime medkrajevnega postajališča (lahko drugačno od Marpromovega)
  depSec: number;
  minutesFromNow: number;
};

let cached: Raw | null = null;
let loading: Promise<Raw | null> | null = null;

export function loadIjpp(): Promise<Raw | null> {
  if (cached) return Promise.resolve(cached);
  if (loading) return loading;
  loading = fetch(import.meta.env.BASE_URL + 'gtfs/ijpp.json')
    .then(r => { if (!r.ok) throw new Error('ijpp.json ' + r.status); return r.json(); })
    .then((j: Raw) => { cached = j; return j; })
    // Medkrajevni odhodi so dodatek: napaka ne sme zrušiti postajališča, retry ob naslednjem.
    .catch(() => { loading = null; return null; });
  return loading;
}

// »Arriva d.o.o.« → »Arriva«, »SŽ - Potniški promet, d.o.o.« → »SŽ«, »AP Murska Sobota, d.d.« → »AP Murska Sobota«.
const shortAgency = (n: string) => n.split(/\s+-\s+|,/)[0].replace(/\s+d\.o\.o\.$/i, '').trim();

const dayIndex = (start: string, when: Date) => {
  const s = Date.UTC(+start.slice(0, 4), +start.slice(4, 6) - 1, +start.slice(6, 8));
  const w = Date.UTC(when.getFullYear(), when.getMonth(), when.getDate());
  return Math.round((w - s) / 86400000);
};

// Naslednji medkrajevni odhodi z medkrajevnih postajališč v polmeru `radius` m od točke.
// Upošteva tudi vožnje prejšnjega dne po polnoči (čas > 24:00).
export function ijppDeparturesNear(
  j: Raw, at: { lat: number; lon: number }, when: Date = nowMb(), k = 8, radius = 200,
): IjppDeparture[] {
  const near = new Set<number>();
  j.stops.forEach((s, i) => { if (dist(at, { lat: s[1], lon: s[2] }) <= radius) near.add(i); });
  if (!near.size) return [];
  const nowMin = when.getHours() * 60 + when.getMinutes();
  const today = dayIndex(j.start, when);
  const out: IjppDeparture[] = [];
  for (const [ri, di, hi, seq] of j.trips) {
    const bits = j.days[di];
    for (const [off, base] of [[0, 0], [-1, 1440]] as const) {
      const d = today + off;
      if (d < 0 || bits[d] !== '1') continue;
      for (let x = 0; x < seq.length; x += 2) {
        if (!near.has(seq[x])) continue;
        const m = seq[x + 1] - base;
        if (m < nowMin) continue;
        const [ai, line, type] = j.routes[ri];
        const [agName, color] = j.agencies[ai];
        out.push({
          agency: shortAgency(agName), color: color || '#6B7280', line, rail: type === 2,
          headsign: j.heads[hi], stopName: j.stops[seq[x]][0],
          depSec: m * 60, minutesFromNow: m - nowMin,
        });
        break;
      }
    }
  }
  out.sort((a, b) => a.depSec - b.depSec);
  return out.slice(0, k);
}

// Ali je v bližini sploh kakšno medkrajevno postajališče (za skrivanje razdelka).
export function hasIjppNear(j: Raw, at: { lat: number; lon: number }, radius = 200): boolean {
  return j.stops.some(s => dist(at, { lat: s[1], lon: s[2] }) <= radius);
}
