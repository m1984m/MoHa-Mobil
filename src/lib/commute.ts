// Kartica »Odhod čez X min«: za shranjeno pot (navadni pogled) ali shranjen kraj
// (preprost pogled) pokaže naslednji avtobus, zamudo v živo in kdaj je treba od doma.
// Osnutek in pravila: projekti/aplikacija_Mobilnost_Maas/osnutek_odhod_cez/odhod_cez.html
//
// Pot računa isti planTrip kot načrtovalnik (naložen šele ob prvem klicu, da ne gre v
// začetni paket), zamudo pa GetArrivalsForStopPoint za postajališče vstopa.
import { dist, upcomingDepartures, type GTFS } from './gtfs';
import { EXT } from './ijppInfo';
import { fetchArrivalsForStopPoint } from './realtime';
import { nowMb } from './clock';
import { fmtClock } from './time';
import type { BusLeg, Plan } from './planner';
import type { Place } from './planTrip';

type Pt = { lat: number; lon: number };

// Komponenta kartice se naloži šele, ko je shranjena pot ali kraj (ni v začetnem paketu).
let cardMod: Promise<any> | null = null;
export function loadCommuteCard(): Promise<any> {
  if (!cardMod) {
    cardMod = import('./ui/CommuteCard.svelte').then(m => m.default)
      .catch(e => { cardMod = null; throw e; });
  }
  return cardMod;
}

/** Pot se pokaže samo, če je njen začetek tako blizu (zjutraj Dom → Služba, popoldne obratno). */
export const COMMUTE_NEAR_M = 800;
/** Rezerva pri »Pojdi čez«: odhod − hoja − ena minuta. */
export const LEAVE_BUFFER_SEC = 60;
/** Odhod dlje od tega ni »naslednji avtobus« (ponoči, pozno zvečer) — kartice ni. */
export const COMMUTE_MAX_AHEAD_SEC = 2 * 3600;

/** Shranjena pot z začetkom najbližje legi (do COMMUTE_NEAR_M); brez lege prva shranjena. */
export function pickByStart<T extends { from: Pt }>(list: T[], origin: Pt, hasGeo: boolean): T | null {
  if (list.length === 0) return null;
  if (!hasGeo) return list[0];
  let best: T | null = null;
  let bestD = Infinity;
  for (const r of list) {
    const d = dist(origin, r.from);
    if (d < bestD) { bestD = d; best = r; }
  }
  return bestD <= COMMUTE_NEAR_M ? best : null;
}

/** Preprost pogled: od drugod domov; doma do prvega shranjenega kraja. Brez lege nič. */
export function pickSimpleTarget<P extends Pt>(home: P | null, others: P[], origin: Pt, hasGeo: boolean): P | null {
  if (!hasGeo || !home) return null;
  if (dist(origin, home) > COMMUTE_NEAR_M) return home;
  return others[0] ?? null;
}

export type Commute = {
  plan: Plan;
  bus: BusLeg;
  /** Hoja od izhodišča do postajališča prvega avtobusa. */
  walkSec: number;
  /** Naslednji dve vožnji iste linije in smeri s tega postajališča (vozni red). */
  next: number[];
};

/** Pot z avtobusom od `from` do `to` zdaj; null, če je ni (samo hoja, ponoči, napaka). */
export async function planCommute(gtfs: GTFS, from: Place, to: Place, signal?: AbortSignal): Promise<Commute | null> {
  const { planTrip } = await import('./planTrip');
  const res = await planTrip({ gtfs, from, to, signal });
  if (!res.ok) return null;
  // Prvi predlog, kot ga pokaže tudi karta; če je to pot peš, kartice ni (hoja je boljša).
  const plan = res.plans[0];
  if (!plan || !plan.legs.some(l => l.kind === 'bus')) return null;
  const i = plan.legs.findIndex(l => l.kind === 'bus');
  const bus = plan.legs[i] as BusLeg;
  const now = nowMb();
  const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  if (bus.depSec - nowSec > COMMUTE_MAX_AHEAD_SEC) return null;
  const walkSec = plan.legs.slice(0, i).reduce((a, l) => a + (l.kind === 'walk' ? l.sec : 0), 0);
  const next = bus.route.id >= EXT ? [] : upcomingDepartures(gtfs, bus.from.id, now, 400)
    .filter(d => d.route.id === bus.route.id && d.trip.headsign === bus.headsign && d.depSec > bus.depSec)
    .slice(0, 2)
    .map(d => d.depSec);
  return { plan, bus, walkSec, next };
}

export type CommuteLive = {
  /** Vozilo je dodeljeno, čas prihaja iz živega vira. */
  live: boolean;
  delayMin: number | null;
  /** Pričakovani odhod kot trenutek (epoch ms). */
  expectedAt: number | null;
};

const hmMin = (hm: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(hm);
  return m ? +m[1] * 60 + +m[2] : null;
};

/** Živi podatek za avtobus poti. Medkrajevno ga ni (`live: false`); napaka omrežja vrže. */
export async function fetchCommuteLive(bus: BusLeg): Promise<CommuteLive> {
  const none: CommuteLive = { live: false, delayMin: null, expectedAt: null };
  if (bus.route.id >= EXT) return none;
  const arr = await fetchArrivalsForStopPoint(bus.from.id);
  const code = bus.route.short.toLowerCase();
  const sched = Math.floor(bus.depSec / 60) % 1440;
  // Ista linija, čas po voznem redu najbližje vožnji poti (do 2 min — OBA zaokroži na minuto).
  let best: (typeof arr)[number] | null = null;
  let bestD = 3;
  for (const a of arr) {
    if (a.lineCode.toLowerCase() !== code) continue;
    const m = hmMin(a.arrivalTime);
    if (m == null) continue;
    let d = Math.abs(m - sched);
    if (d > 720) d = 1440 - d;
    if (d < bestD) { bestD = d; best = a; }
  }
  // Zasilna kopija (Marprom ni odgovoril) ni »v živo«.
  if (!best || !best.predicted || best.stale) return none;
  return { live: true, delayMin: best.delayKnown ? best.delayMin : null, expectedAt: best.expectedAt ?? null };
}

export type CommuteView = {
  /** Odhod (sekunde od polnoči), z zamudo, če je znana. */
  depSec: number;
  /** Minut do odhoda (0 = odhaja). */
  minUntil: number;
  /** Minut do trenutka, ko je treba kreniti (≤ 0 = zdaj). */
  goMin: number;
  /** Kreniti bi bilo treba že več kot minuto nazaj — tega avtobusa ni več mogoče ujeti. */
  missed: boolean;
  live: boolean;
  /** Zamuda v minutah, samo če je znana in vsaj 1 min. */
  delayMin: number | null;
  /** Čas po voznem redu, ko se razlikuje od dejanskega (za prečrtan prikaz). */
  schedClock: string | null;
  clock: string;
};

/**
 * `nowSec` mora biti v istem merilu kot časi poti: sekunde od polnoči dneva iskanja
 * (`plan.baseDay`), po polnoči torej + 24 h. `onTheWay`: potnik ni več na izhodišču
 * shranjene poti (hodi ali čaka na postajališču) — hoja od izhodišča takrat ne velja in
 * avtobus je zamujen šele, ko odpelje.
 */
export function commuteView(c: Commute, live: CommuteLive | null, nowSec: number, nowMs = Date.now(), onTheWay = false): CommuteView {
  const sched = c.bus.depSec;
  let dep = sched;
  const isLive = !!live?.live;
  if (isLive && live!.expectedAt != null) dep = Math.round(nowSec + (live!.expectedAt - nowMs) / 1000);
  else if (isLive && live!.delayMin != null) dep = sched + live!.delayMin * 60;
  const delay = isLive && live!.delayMin != null && live!.delayMin >= 1 ? live!.delayMin : null;
  const goSec = dep - c.walkSec - LEAVE_BUFFER_SEC - nowSec;
  const clock = fmtClock(dep);
  const schedClock = fmtClock(sched);
  return {
    depSec: dep,
    minUntil: Math.max(0, Math.round((dep - nowSec) / 60)),
    // Zaokroženo kot minUntil, da se na zaslonu sešteje (čez 21 min − 8 min hoje − 1 = 12).
    goMin: Math.max(0, Math.round(goSec / 60)),
    missed: onTheWay ? dep < nowSec - 30 : goSec < -60,
    live: isLive,
    delayMin: delay,
    schedClock: delay != null && schedClock !== clock ? schedClock : null,
    clock,
  };
}
