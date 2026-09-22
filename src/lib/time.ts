// Enotno oblikovanje časov čakanja — edini vir resnice.
//
// Zakaj obstaja: DepartureTime je izpisoval surove minute (ponoči »296 min«),
// waitLabel v MapScreen pa ure (»Čez 4 h 47 min«), odštevalnik »Kreni« pa spet
// surove minute — v ISTI kartici so bili trije formati. Vse pretvorbe so zdaj tu.

import { get } from 'svelte/store';
import { lang, tr } from './i18n';

// Meji za kompakten prikaz v seznamih odhodov.
const HOUR_FROM_MIN = 60;    // pod tem: samo minute
const CLOCK_FROM_MIN = 180;  // nad tem: ura odhoda je uporabnejša od "4 h 56"

// Nad toliko minutami odštevalnik "Kreni" nima več pomena (nasvet "kreni čez
// 277 minut" je prazen) — MapScreen ga takrat skrije.
export const LEAVE_HINT_MAX_MIN = 30;

export function fmtClock(sec: number): string {
  const h = Math.floor(sec / 3600) % 24;
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export type DepartureLabel = {
  value: string;        // glavna vrednost (veliko besedilo)
  unit: string | null;  // enota ob njej ("min"), če je smiselna
  now: boolean;         // true = "zdaj" (obarva se zeleno)
};

// Kompakten zapis za sezname odhodov:
//   ≤ 0      → "zdaj"
//   1–59     → "17" + "min"
//   60–179   → "2 h 15"
//   ≥ 180    → "05:10" (ura odhoda — dejansko uporabna informacija)
export function fmtDeparture(minutesFromNow: number, depSec: number): DepartureLabel {
  if (minutesFromNow <= 0) return { value: tr('zdaj'), unit: null, now: true };
  if (minutesFromNow < HOUR_FROM_MIN) return { value: String(minutesFromNow), unit: 'min', now: false };
  if (minutesFromNow < CLOCK_FROM_MIN) {
    const h = Math.floor(minutesFromNow / 60);
    const m = minutesFromNow % 60;
    return { value: m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`, unit: null, now: false };
  }
  return { value: fmtClock(depSec), unit: null, now: false };
}

// Trajanje v besedilu: "12 min", "1 h 05 min", "2 h".
export function fmtDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${String(r).padStart(2, '0')} min`;
}

// Polni stavek za kartico "Čakanje". Slovenska dvojina/množina.
export function fmtWaitSentence(m: number | null): string {
  if (get(lang) === 'en') {
    if (m === null) return 'No more departures today';
    if (m <= 0) return 'Bus arriving now';
    if (m < 60) return m === 1 ? 'Next bus in 1 minute' : `Next bus in ${m} minutes`;
    return `Next bus in ${fmtDuration(m)}`;
  }
  if (m === null) return 'Danes ni več odhodov';
  if (m <= 0) return 'Avtobus prihaja zdaj';
  if (m === 1) return 'Naslednji avtobus čez 1 minuto';
  if (m === 2) return 'Naslednji avtobus čez 2 minuti';
  if (m < 5) return `Naslednji avtobus čez ${m} minute`;
  if (m < 60) return `Naslednji avtobus čez ${m} minut`;
  return `Naslednji avtobus čez ${fmtDuration(m)}`;
}

// Slovenska sklanjatev ob števniku: 1 hiša, 2 hiši, 3 hiše, 5 hiš — odloča ostanek
// pri 100 (11 in 12 gresta v množino, 101 in 102 ne). Vzorec je isti kot pri
// fmtWaitSentence, le da je oblika parameter, ne vgrajena v stavek.
export function fmtPlural(n: number, one: string, two: string, few: string, many: string): string {
  const r = Math.abs(Math.round(n)) % 100;
  if (r === 1) return one;
  if (r === 2) return two;
  if (r === 3 || r === 4) return few;
  return many;
}

// Intl vrne mesec v imenovalniku ("julij"), zaradi česar je nastal zapis
// "Velja od julij 2026". Rodilnik potrebuje lasten seznam — Intl ga za sl-SI ne pozna.
const MONTHS_GENITIVE = [
  'januarja', 'februarja', 'marca', 'aprila', 'maja', 'junija',
  'julija', 'avgusta', 'septembra', 'oktobra', 'novembra', 'decembra',
];
export function fmtMonthYearGenitive(d: Date): string {
  if (get(lang) === 'en') return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  return `${MONTHS_GENITIVE[d.getMonth()]} ${d.getFullYear()}`;
}

// Ime dneva za napoved prvega jutrišnjega odhoda ("jutri", "v ponedeljek", …).
const DAY_NAMES = ['nedeljo', 'ponedeljek', 'torek', 'sredo', 'četrtek', 'petek', 'soboto'];
const DAY_NAMES_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function fmtDayOffset(offset: number, weekday: number): string {
  if (get(lang) === 'en') {
    if (offset === 1) return 'tomorrow';
    return DAY_NAMES_EN[weekday] ? `on ${DAY_NAMES_EN[weekday]}` : 'in the coming days';
  }
  if (offset === 1) return 'jutri';
  return `v ${DAY_NAMES[weekday] ?? 'naslednjih dneh'}`;
}
