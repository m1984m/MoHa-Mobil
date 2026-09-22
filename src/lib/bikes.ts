// MBajk — mestna izposoja koles (JCDecaux Cyclocity). Javni feed GBFS 2.3 brez ključa;
// strežnik vrne Access-Control-Allow-Origin za poljuben izvor, zato beremo neposredno,
// brez našega Workerja. Licenca: Licence Ouverte (Etalab) — zahteva navedbo vira,
// ta je v kartici postaje (»Podatki: MBajk / JCDecaux«).
//
// station_information (imena, lege, kapaciteta) se skoraj ne spreminja → enkrat na uro;
// station_status (prosta kolesa in stojala) → vsako minuto, dokler je Karta odprta.
import { writable } from 'svelte/store';

const BASE = 'https://api.cyclocity.fr/contracts/maribor/gbfs/v2';
const INFO_TTL_MS = 60 * 60 * 1000;
const STATUS_EVERY_MS = 60 * 1000;

export type BikeStation = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  capacity: number;
  bikes: number;
  docks: number;
  // Postaja je v obratovanju (izposoja ali vračilo možno). Zaprte kažemo sivo.
  active: boolean;
};

export const bikeStations = writable<BikeStation[]>([]);
export const bikesError = writable(false);

type Info = { station_id: string; name: string; lat: number; lon: number; capacity?: number };
type Status = {
  station_id: string; num_bikes_available: number; num_docks_available: number;
  is_installed?: boolean | number; is_renting?: boolean | number; is_returning?: boolean | number;
};

let info: Info[] = [];
let infoAt = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let users = 0;

// Imena so v feedu z velikimi črkami (»GOSPOSVETSKA C. - TURNERJEVA UL.«) —
// v seznamu ob imenih postajališč bi kričala.
function niceName(s: string): string {
  return s.toLocaleLowerCase('sl-SI').replace(/(^|[\s\-(./])(\p{L})/gu, (_, p, c) => p + c.toLocaleUpperCase('sl-SI'));
}

async function getJSON<T>(name: string): Promise<T> {
  const r = await fetch(`${BASE}/${name}.json`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${name} ${r.status}`);
  return (await r.json()).data as T;
}

async function refresh() {
  try {
    if (!info.length || Date.now() - infoAt > INFO_TTL_MS) {
      info = (await getJSON<{ stations: Info[] }>('station_information')).stations;
      infoAt = Date.now();
    }
    const st = (await getJSON<{ stations: Status[] }>('station_status')).stations;
    const byId = new Map(st.map(s => [s.station_id, s]));
    bikeStations.set(info.map(i => {
      const s = byId.get(i.station_id);
      const on = (v: unknown) => v === true || v === 1;
      return {
        id: i.station_id,
        name: niceName(i.name),
        lat: i.lat,
        lon: i.lon,
        capacity: i.capacity ?? 0,
        bikes: s?.num_bikes_available ?? 0,
        docks: s?.num_docks_available ?? 0,
        active: !!s && on(s.is_installed) && (on(s.is_renting) || on(s.is_returning)),
      };
    }));
    bikesError.set(false);
  } catch {
    // Zadnji znani podatki ostanejo na karti; oznaka napake samo pove, da so lahko stari.
    bikesError.set(true);
  }
}

// Štetje uporabnikov: Karta in kartica postaje lahko hkrati zahtevata podatke.
// Aplikacija v ozadju ne poizveduje; ob vrnitvi takoj osveži.
function run() {
  if (timer || users === 0 || document.hidden) return;
  void refresh();
  timer = setInterval(refresh, STATUS_EVERY_MS);
}
function pause() {
  if (timer) { clearInterval(timer); timer = null; }
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : run()));
}

export function startBikes(): () => void {
  users++;
  run();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    users = Math.max(0, users - 1);
    if (users === 0) pause();
  };
}

function distM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (bLat - aLat) * toR, dLon = (bLon - aLon) * toR;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toR) * Math.cos(bLat * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// Najbližja delujoča postaja v danem polmeru — za vrstico »MBajk v bližini« pri postajališču.
export function nearestBikeStation(list: BikeStation[], lat: number, lon: number, maxM = 400): (BikeStation & { m: number }) | null {
  let best: (BikeStation & { m: number }) | null = null;
  for (const b of list) {
    if (!b.active) continue;
    const m = distM(lat, lon, b.lat, b.lon);
    if (m <= maxM && (!best || m < best.m)) best = { ...b, m };
  }
  return best;
}
