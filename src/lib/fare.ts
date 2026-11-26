// Cena poti v mestnem prometu Marprom za predloge načrtovalnika.
// Ob spremembi cenika posodobi tudi FaresModal.svelte (tabela in VALID_FROM).
import type { Plan } from './planner';
import { EXT } from './ijppInfo';

/** Ena vožnja (predprodaja, kartica Marprom ali aplikacija) s prestopom v 75 minutah. */
export const SINGLE_FARE_CENTS = 150;
export const TRANSFER_WINDOW_SEC = 75 * 60;

/**
 * Število vozovnic za pot samo z mestnimi avtobusi: nova vozovnica, ko vstop v naslednji
 * avtobus pade zunaj 75 minut od vstopa, s katerim se je začela prejšnja.
 * null: pot peš ali z vlakom / medkrajevnim avtobusom (te cene ne poznamo).
 */
export function cityFareCents(p: Plan): number | null {
  const buses = p.legs.filter(l => l.kind === 'bus');
  if (buses.length === 0) return null;
  if (buses.some(l => l.kind === 'bus' && l.route.id >= EXT)) return null;
  let tickets = 0;
  let start = -Infinity;
  for (const l of buses) {
    if (l.kind !== 'bus') continue;
    if (l.depSec > start + TRANSFER_WINDOW_SEC) { tickets++; start = l.depSec; }
  }
  return tickets * SINGLE_FARE_CENTS;
}

export function fmtEur(cents: number): string {
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')} €`;
}

export type PlanSegment =
  | { kind: 'walk'; sec: number }
  | { kind: 'wait'; sec: number }
  | { kind: 'bus'; sec: number; routeId: number; short: string };

/** Odseki poti po vrsti za trak v načrtovalniku: hoja, čakanje, vožnja. */
export function planSegments(p: Plan): PlanSegment[] {
  const out: PlanSegment[] = [];
  let clock = p.depSec;
  for (const l of p.legs) {
    if (l.kind === 'walk') {
      if (l.sec > 0) out.push({ kind: 'walk', sec: l.sec });
      clock += l.sec;
    } else {
      const wait = l.depSec - clock;
      if (wait >= 60) out.push({ kind: 'wait', sec: wait });
      out.push({ kind: 'bus', sec: Math.max(60, l.arrSec - l.depSec), routeId: l.route.id, short: l.route.short });
      clock = l.arrSec;
    }
  }
  return out;
}
