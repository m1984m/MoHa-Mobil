import { writable } from 'svelte/store';
import { allDeparturesForStop, feedCoversDate } from './gtfs';
import type { GTFS } from './gtfs';
import { fmtClock, fmtDuration } from './time';
import { tr, locale } from './i18n';

// Alarm za odhod avtobusa: "vsak delavnik med 6.00 in 8.00 me opozori 10 minut pred
// prvim odhodom linije G1 s postaje Mlinska".
//
// Ta modul je ČISTA logika — iz GTFS in seznama alarmov izračuna konkretne ponovitve
// (Occurrence) za naprej. Pošiljanje na strežnik je v push.ts, prikaz v AlarmsScreen.
//
// Zakaj vnaprej izračunane ponovitve: potisno obvestilo mora sprožiti strežnik ob točni
// minuti, ta pa nima GTFS-a. Odjemalec zato pošlje seznam "ob TEM trenutku pokaži TO
// besedilo" in ga ob vsaki spremembi (ali zagonu) osveži.

export type Alarm = {
  id: string;              // crypto.randomUUID()
  stopId: number; routeId: number; dir: number;
  // Oznake so snapshot ob nastavitvi — enak vzorec kot FavLine v favLines.ts, da se
  // seznam pravilno izriše tudi, če GTFS medtem preimenuje postajo ali linijo.
  stopName: string; routeShort: string; headsign: string;
  days: boolean[];         // 7 elementov, indeks 0 = PONEDELJEK (ujema se s todayServiceIds)
  fromMin: number;         // začetek okna, minute od polnoči
  toMin: number;           // konec okna, minute od polnoči
  leadMin: number;         // koliko minut pred odhodom naj zazvoni
  enabled: boolean;
  createdAt: number;
};

export type Occurrence = { alarmId: string; fireAt: number; depAt: number; title: string; body: string; tag: string };

export type AlarmDraft = Omit<Alarm, 'id' | 'createdAt'>;

// Ključi prevodov — prevedejo se ob izpisu (tr / $t), ne tu, da sledijo jeziku.
export const DAY_SHORT = ['pon', 'tor', 'sre', 'čet', 'pet', 'sob', 'ned'];
const DAY_IN = ['v pon', 'v tor', 'v sre', 'v čet', 'v pet', 'v sob', 'v ned'];

export const DEFAULT_LEAD_MIN = 10;
export const MAX_LEAD_MIN = 60;
const MAX_MIN = 24 * 60 - 1;

const KEY = 'mm.alarms.v1';

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = Math.round(Number(v));
  if (!isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

// Vsak zapis iz localStorage gre skozi to sito — pokvarjen/star zapis se zavrže ali
// popravi, namesto da bi kasneje dal NaN v izračunu ponovitev.
function sanitize(x: any): Alarm | null {
  if (!x || typeof x !== 'object') return null;
  if (typeof x.stopId !== 'number' || typeof x.routeId !== 'number' || typeof x.dir !== 'number') return null;
  const days: boolean[] = Array.from({ length: 7 }, (_, i) => Array.isArray(x.days) && x.days[i] === true);
  return {
    id: typeof x.id === 'string' && x.id ? x.id : newId(),
    stopId: x.stopId, routeId: x.routeId, dir: x.dir,
    stopName: typeof x.stopName === 'string' ? x.stopName : '',
    routeShort: typeof x.routeShort === 'string' ? x.routeShort : '',
    headsign: typeof x.headsign === 'string' ? x.headsign : '',
    days,
    fromMin: clampInt(x.fromMin, 0, MAX_MIN, 0),
    toMin: clampInt(x.toMin, 0, MAX_MIN, MAX_MIN),
    leadMin: clampInt(x.leadMin, 0, MAX_LEAD_MIN, DEFAULT_LEAD_MIN),
    enabled: x.enabled !== false,
    createdAt: typeof x.createdAt === 'number' ? x.createdAt : Date.now(),
  };
}

function load(): Alarm[] {
  try {
    const s = localStorage.getItem(KEY);
    if (!s) return [];
    const arr = JSON.parse(s);
    if (!Array.isArray(arr)) return [];
    return arr.map(sanitize).filter((a): a is Alarm => a !== null);
  } catch { return []; }
}

function save(list: Alarm[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
}

export const alarms = writable<Alarm[]>(load());
alarms.subscribe(save);

// crypto.randomUUID manjka na iOS Safari < 15.4 in v nesigurnem kontekstu (http://…),
// kjer bi brez fallbacka vsak nov alarm vrgel izjemo.
function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {}
  return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function addAlarm(draft: AlarmDraft): Alarm {
  const a: Alarm = { ...draft, id: newId(), createdAt: Date.now() };
  alarms.update(list => [...list, a]);
  return a;
}

export function updateAlarm(id: string, patch: Partial<AlarmDraft>): void {
  alarms.update(list => list.map(a => (a.id === id ? { ...a, ...patch } : a)));
}

export function removeAlarm(id: string): void {
  alarms.update(list => list.filter(a => a.id !== id));
}

export function toggleAlarm(id: string): void {
  alarms.update(list => list.map(a => (a.id === id ? { ...a, enabled: !a.enabled } : a)));
}

export function daysLabel(days: boolean[]): string {
  const on = days.map((v, i) => (v ? i : -1)).filter(i => i >= 0);
  if (on.length === 0) return tr('brez dni');
  if (on.length === 7) return tr('vsak dan');
  if (on.length === 5 && on.every(i => i < 5)) return tr('pon–pet');
  if (on.length === 2 && on[0] === 5 && on[1] === 6) return tr('vikend');
  return on.map(i => tr(DAY_SHORT[i])).join(', ');
}

// Enovrstični povzetek za seznam in za aria-label.
export function alarmLabel(a: Alarm): string {
  return `${a.routeShort} · ${a.stopName} · ${daysLabel(a.days)} ${fmtClock(a.fromMin * 60)}–${fmtClock(a.toMin * 60)} · ${tr('{n} min prej', { n: a.leadMin })}`;
}

// "v pon ob 06:30" — za vrstico "naslednjič …" v seznamu alarmov.
export function nextRingLabel(o: Occurrence | null): string {
  if (!o) return tr('ni predvidenega zvonjenja');
  const d = new Date(o.fireAt);
  const wd = (d.getDay() + 6) % 7;
  return tr('{day} ob {time}', { day: tr(DAY_IN[wd]), time: fmtClock(d.getHours() * 3600 + d.getMinutes() * 60) });
}

// Besedilo obvestila sestavi telefon v jeziku, izbranem ob izračunu, in ga pošlje
// strežniku — ta ga le dostavi. Ob menjavi jezika se ob naslednji uskladitvi prepiše.
function occurrenceTitle(a: Alarm): string {
  if (a.leadMin <= 0) return tr('Kreni — {line} odhaja zdaj', { line: a.routeShort });
  return tr('Kreni — {line} čez {time}', { line: a.routeShort, time: fmtDuration(a.leadMin) });
}

function occurrenceBody(a: Alarm, depSec: number, headsign: string): string {
  const smer = headsign || a.headsign;
  const vars = { time: fmtClock(depSec), stop: a.stopName, dir: smer };
  return smer
    ? tr('Odhod ob {time} s postaje {stop} (proti {dir}).', vars)
    : tr('Odhod ob {time} s postaje {stop}.', vars);
}

/**
 * Konkretne ponovitve alarmov v naslednjih `horizonDays` dneh, urejene po času zvonjenja.
 *
 * Robni primeri:
 *  - `toMin < fromMin` (okno čez polnoč) je EKSPLICITNO PREPOVEDAN — tak alarm ne
 *    generira ničesar. Urejevalnik take vrednosti ne dovoli shraniti. Razlog: odhod
 *    ob 23.50 in odhod ob 00.10 pripadata dvema različnima voznim dnevoma, zato bi
 *    "najzgodnejši odhod v oknu" postal dvoumen.
 *  - alarm brez izbranega dneva ali izklopljen alarm → 0 ponovitev.
 *  - dnevi, ki jih vozni red ne pokriva več (služba se izteče), tiho odpadejo —
 *    allDeparturesForStop za tak datum vrne prazen seznam.
 *  - odhodi, zapisani čez 24:00 (nadaljevanje prejšnjega voznega dne), v okno 00:00–…
 *    tega koledarskega dne ne padejo; feed Marproma trenutno nima takih odhodov
 *    (najpoznejši je 23:51).
 */
export function computeOccurrences(
  gtfs: GTFS,
  list: Alarm[],
  from: Date = new Date(),
  horizonDays = 60,
  max = 400,
): Occurrence[] {
  const out: Occurrence[] = [];
  const active = list.filter(a => a.enabled && a.days.some(Boolean) && a.fromMin <= a.toMin);
  if (active.length === 0) return out;

  const fromMs = from.getTime();
  for (let i = 0; i < horizonDays; i++) {
    // Poldne kot referenca dneva: todayServiceIds gleda samo koledarski datum, poldne
    // pa se izogne robu poletnega/zimskega časa (enak vzorec kot nextServiceDeparture).
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i, 12, 0, 0, 0);
    const wd = (day.getDay() + 6) % 7;
    // Odhodi postaje se med alarmi istega dne delijo — allDeparturesForStop prehodi
    // vse tripe, kar bi bilo pri 60 dneh × N alarmih po nepotrebnem večkrat.
    const cache = new Map<number, ReturnType<typeof allDeparturesForStop>>();

    for (const a of active) {
      if (!a.days[wd]) continue;
      let deps = cache.get(a.stopId);
      if (!deps) {
        deps = allDeparturesForStop(gtfs, a.stopId, day);
        cache.set(a.stopId, deps);
      }
      const lo = a.fromMin * 60;
      const hi = a.toMin * 60;
      // deps je urejen naraščajoče po depSec → prvi zadetek je najzgodnejši odhod v oknu.
      const hit = deps.find(d => d.trip.route === a.routeId && d.trip.dir === a.dir && d.depSec >= lo && d.depSec <= hi);
      if (!hit) continue;

      // Lokalna polnoč + depSec prek konstruktorja Date: ta normalizira sekunde po
      // lokalnem koledarju, zato ura ostane prava tudi na dan premika ure.
      const depAt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, hit.depSec).getTime();
      const fireAt = depAt - a.leadMin * 60_000;
      if (fireAt <= fromMs) continue;

      out.push({
        alarmId: a.id,
        fireAt,
        depAt,
        title: occurrenceTitle(a),
        body: occurrenceBody(a, hit.depSec, hit.trip.headsign),
        tag: `${a.id}:${depAt}`,
      });
    }
  }

  out.sort((x, y) => x.fireAt - y.fireAt);
  return out.slice(0, max);
}

// Do kdaj so alarmi pokriti (zadnje predvideno zvonjenje). null = ni ponovitev.
export function coverageEnd(occ: Occurrence[]): number | null {
  let last: number | null = null;
  for (const o of occ) if (last === null || o.fireAt > last) last = o.fireAt;
  return last;
}

export type AlarmWarning = { kind: 'feed-expired' | 'coverage-soon'; text: string };

const SOON_MS = 14 * 24 * 3600 * 1000;

/**
 * Opozorilo, ko opomniki tiho ostanejo brez voznega reda. Septembra 2026 se je temu
 * projektu točno to zgodilo: delavniška služba je potekla 31. 08., seznami pa so
 * ostali prazni brez pojasnila. Opomnik, ki ne zazvoni, mora biti viden VNAPREJ.
 */
export function alarmsCoverageWarning(gtfs: GTFS | null, list: Alarm[], now: Date = new Date()): AlarmWarning | null {
  if (!gtfs) return null;
  if (!list.some(a => a.enabled && a.days.some(Boolean))) return null;
  if (!feedCoversDate(gtfs, now)) {
    return { kind: 'feed-expired', text: tr('Vozni red za danes ne velja več, zato opomniki ne bodo zazvonili. Posodobi podatke v aplikaciji.') };
  }
  const end = coverageEnd(computeOccurrences(gtfs, list, now));
  if (end === null) {
    return { kind: 'coverage-soon', text: tr('V voznem redu ni več odhodov za nastavljene opomnike.') };
  }
  if (end - now.getTime() < SOON_MS) {
    // Intl se ustvari ob klicu (ne na ravni modula), da sledi izbranemu jeziku.
    const date = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(end));
    return { kind: 'coverage-soon', text: tr('Vozni red se izteka — opomniki so pokriti samo še do {date}.', { date }) };
  }
  return null;
}
