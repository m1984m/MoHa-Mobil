import { upcomingDepartures, tripDestination, type GTFS } from './gtfs';
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
