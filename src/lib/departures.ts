import { upcomingDepartures, tripDestination, endsAtStopId, rowTarget, type GTFS } from './gtfs';
import { stopDests } from './simpleStops';
import type { StopArrival } from './realtime';

// Vrstice odhodov za Preprost pogled (glavni zaslon in zaslon postajališča).
// Oblika je enaka BoardRow iz StopBoard.svelte, zato se vrstice podajo kartici
// neposredno. Dom ima svojo različico z filtrom smeri (HomeScreen.svelte).
export type DepartureRow = {
  routeId: number;
  routeShort: string;
  headsign: string;
  minutesFromNow: number;
  depSec: number;
  destination?: string;
  delayMin?: number;
  delayKnown?: boolean;
  live?: boolean;
};

// Živi prihodi veljajo dve minuti od zadnjega uspešnega klica; starejši ETA je
// že zlagan, zato se takrat pokaže vozni red.
export const LIVE_FRESH_MS = 120_000;

export function liveDepartureRows(arr: StopArrival[], routeIdByShort: Map<string, number>, max: number): DepartureRow[] {
  return arr.slice(0, max).map(a => {
    const [hh, mm] = (a.arrivalTime || '0:0').split(':').map(Number);
    return {
      routeId: routeIdByShort.get(a.lineCode.toLowerCase()) ?? a.lineId,
      routeShort: a.lineCode,
      headsign: a.headsign,
      minutesFromNow: a.etaMin,
      depSec: (hh || 0) * 3600 + (mm || 0) * 60,
      delayMin: a.delayMin,
      delayKnown: a.delayKnown,
      // »v živo« samo z dodeljenim vozilom; brez njega je tudi OBA le vozni red.
      live: a.predicted,
    };
  });
}

export function scheduleDepartureRows(gtfs: GTFS, stopId: number, max: number, stopNames: Map<number, string>): DepartureRow[] {
  return upcomingDepartures(gtfs, stopId, new Date(), max).map(d => ({
    routeId: d.route.id,
    routeShort: d.route.short,
    headsign: d.trip.headsign,
    minutesFromNow: d.minutesFromNow,
    depSec: d.depSec,
    destination: tripDestination(gtfs, d.trip, stopNames),
  }));
}

export function routeIdIndex(gtfs: GTFS | null): Map<string, number> {
  return gtfs ? new Map(gtfs.routes.map(r => [r.short.toLowerCase(), r.id])) : new Map();
}

const hhmm = (sec: number) => `${String(Math.floor(sec / 3600) % 24).padStart(2, '0')}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}`;

// Živi prihodi brez voženj, ki se na tem postajališču končajo — te niso odhodi (na
// »Avtobusni postaji« je bil med odhodi »P13 Avtobusna postaja«; ponovna ocena 05.10.2026).
// Kliče se ob prejemu, da prazen seznam pomeni »ni živih odhodov« in se pokaže vozni red.
// Linija, ki ji je prihod izpadel, v živem seznamu morda nima svojega odhoda (če OBA vrne
// le naslednji dogodek linije), zato dobi naslednji odhod iz voznega reda, brez vozila.
export function liveDepartures(gtfs: GTFS, stopId: number, arr: StopArrival[], when = new Date()): StopArrival[] {
  const out = arr.filter(a => !endsAtStopId(gtfs, stopId, a.lineCode, a.headsign));
  if (out.length === arr.length) return arr;
  const ended = new Set(arr.filter(a => !out.includes(a)).map(a => a.lineCode.toLowerCase()));
  const have = new Set(out.map(a => a.lineCode.toLowerCase()));
  // Velik k: na Avtobusni postaji je naslednji odhod linije lahko šele na 35. mestu.
  for (const d of upcomingDepartures(gtfs, stopId, when, 500)) {
    const short = d.route.short.toLowerCase();
    if (!ended.has(short) || have.has(short)) continue;
    have.add(short);
    out.push({
      lineId: d.route.id, lineCode: d.route.short, headsign: d.trip.headsign,
      arrivalTime: hhmm(d.depSec), etaMin: d.minutesFromNow, busCode: '',
      predicted: false, delayKnown: false, delayMin: 0,
    });
  }
  return out.sort((a, b) => a.etaMin - b.etaMin);
}

// Smer kartice za postajališče z dvojnikom: cilji odhodov po vrsti (ne cel opis — ta se
// začne z izhodiščem), največ dva in »…«; samo prvi cilj (»smer Vzpenjača«) je veljal za eno
// od treh smeri. Brez odhodov (ponoči) cilji iz voznega reda, sicer bi ostala šifra.
export function boardDirection(gtfs: GTFS, stopId: number, rows: DepartureRow[]): string {
  const dests: string[] = [];
  for (const r of rows) {
    const d = rowTarget(gtfs, r.routeShort, r.headsign, r.destination).dest;
    if (d && !dests.includes(d)) dests.push(d);
  }
  if (dests.length === 0) dests.push(...stopDests(gtfs, stopId));
  return dests.slice(0, 2).join(', ') + (dests.length > 2 ? ' …' : '');
}
