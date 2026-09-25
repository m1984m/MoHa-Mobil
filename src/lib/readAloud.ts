import { tr, plural, locale } from './i18n';
import { splitHeadsign } from './gtfs';
import { fmtClock, fmtDayOffset } from './time';
import type { DepartureRow } from './departures';
import type { PlanLeg, Plan } from './planner';
import type { DayWeather } from './weather';

// Besedila za glasno branje (gumb ui/ReadAloud.svelte, glas speech.ts).
//
// Pravila: celi stavki s piko (glas med njimi naredi premor, speech.ts po njih
// deli dolga besedila); števila z besedo v pravem sklonu (1 minuta, 2 minuti,
// 3 minute, 5 minut); ure kot 14:35. Imena postaj in smeri so v imenovalniku
// ("smer Kamnica"), ker jih ne znamo zanesljivo sklanjati.

function word(n: number, sl: [string, string, string, string], en: [string, string]): string {
  return `${n} ${plural(n, sl, en)}`;
}
const MIN_SL: [string, string, string, string] = ['minuto', 'minuti', 'minute', 'minut'];
const MIN_EN: [string, string] = ['minute', 'minutes'];

function minuteWord(n: number): string {
  return plural(n, MIN_SL, MIN_EN);
}

// Trajanje v tožilniku ("pojdi peš 1 minuto", "počakaj 1 uro in 10 minut") ali v
// imenovalniku ("Predlog 2: 1 ura in 10 minut").
function duration(min: number, sklon: 'tož' | 'im' = 'tož'): string {
  const m = Math.max(1, Math.round(min));
  const mins: [string, string, string, string] = sklon === 'tož' ? MIN_SL : ['minuta', 'minuti', 'minute', 'minut'];
  if (m < 60) return word(m, mins, MIN_EN);
  const h = Math.floor(m / 60), r = m % 60;
  const ure = word(h, sklon === 'tož' ? ['uro', 'uri', 'ure', 'ur'] : ['ura', 'uri', 'ure', 'ur'], ['hour', 'hours']);
  return r ? tr('{h} in {m}', { h: ure, m: word(r, mins, MIN_EN) }) : ure;
}

function dest(headsign: string, destination?: string): string {
  return splitHeadsign(headsign, destination).dest;
}

// ── Odhodi s postajališča ───────────────────────────────────────────────────

// "Linija G6, smer Kamnica, čez 4 minute. Zamuja 2 minuti."
function rowSentence(r: DepartureRow): string {
  const d0 = dest(r.headsign, r.destination);
  let s: string;
  if (r.minutesFromNow <= 0) s = tr('Linija {line}, smer {dest}, prihaja zdaj.', { line: r.routeShort, dest: d0 });
  else if (r.minutesFromNow < 60) s = tr('Linija {line}, smer {dest}, čez {n} {enota}.', { line: r.routeShort, dest: d0, n: r.minutesFromNow, enota: minuteWord(r.minutesFromNow) });
  else s = tr('Linija {line}, smer {dest}, ob {time}.', { line: r.routeShort, dest: d0, time: fmtClock(r.depSec) });
  const d = r.delayMin ?? 0;
  if (r.delayKnown && d >= 1) s += ' ' + tr('Zamuja {n} {enota}.', { n: d, enota: minuteWord(d) });
  else if (r.delayKnown && d <= -1) s += ' ' + tr('Vozi {n} {enota} pred voznim redom.', { n: -d, enota: minuteWord(-d) });
  return s;
}

type NextDay = { dayOffset: number; weekday: number; depSec: number; route: { short: string } } | null;

// Ko danes ni več odhodov: kdaj je prvi naslednji.
export function noMoreToday(next: NextDay = null): string {
  if (!next) return tr('Danes ni več odhodov') + '.';
  return tr('Danes ni več odhodov. Prvi {day} ob {time}, linija {line}.', {
    day: fmtDayOffset(next.dayOffset, next.weekday), time: fmtClock(next.depSec), line: next.route.short,
  });
}

export type StopSpeech = { name: string; rows: DepartureRow[]; empty?: string };

export function departuresSpeech(stops: StopSpeech[]): string {
  return stops.map(st => {
    const body = st.rows.length ? st.rows.map(rowSentence).join(' ') : (st.empty ?? noMoreToday());
    return tr('Postajališče {stop}.', { stop: st.name }) + ' ' + body;
  }).join(' ');
}

// Odhod iz voznega reda (gtfs.upcomingDepartures) v obliki vrstice za branje.
export function gtfsRow(d: { route: { id: number; short: string }; trip: { headsign: string }; minutesFromNow: number; depSec: number }): DepartureRow {
  return { routeId: d.route.id, routeShort: d.route.short, headsign: d.trip.headsign, minutesFromNow: d.minutesFromNow, depSec: d.depSec };
}

// ── Avtobus ─────────────────────────────────────────────────────────────────

export function vehicleSpeech(v: {
  line: string; headsign: string;
  nextStop?: string | null; etaMin?: number | null; delayMin?: number | null;
  stops: { name: string; sec: number }[];
}): string {
  let s = tr('Avtobus linije {line}, smer {dest}.', { line: v.line, dest: dest(v.headsign) });
  if (v.nextStop) {
    const eta = v.etaMin;
    if (eta == null) s += ' ' + tr('Naslednja postaja {stop}.', { stop: v.nextStop });
    else if (eta <= 0) s += ' ' + tr('Naslednja postaja {stop}, prihaja zdaj.', { stop: v.nextStop });
    else s += ' ' + tr('Naslednja postaja {stop}, čez {n} {enota}.', { stop: v.nextStop, n: eta, enota: minuteWord(eta) });
  }
  const d = v.delayMin ?? 0;
  if (d >= 1) s += ' ' + tr('Zamuja {n} {enota}.', { n: d, enota: minuteWord(d) });
  else if (d <= -1) s += ' ' + tr('Vozi {n} {enota} pred voznim redom.', { n: -d, enota: minuteWord(-d) });
  const rest = v.stops.filter(x => x.name !== v.nextStop).slice(0, 4);
  if (rest.length) {
    s += ' ' + tr('Naslednje postaje: {list}.', {
      list: rest.map(x => tr('{stop} ob {time}', { stop: x.name, time: fmtClock(x.sec) })).join(', '),
    });
  }
  return s;
}

// ── Pot ─────────────────────────────────────────────────────────────────────

export function planSpeech(legs: PlanLeg[], cilj: string): string {
  const walkSec = (from: number, to: number) =>
    legs.slice(from, to).reduce((a, l) => a + (l.kind === 'walk' ? l.sec : 0), 0);
  const out: string[] = [cilj ? tr('Pot do cilja {cilj}.', { cilj }) : tr('Pot do cilja.')];

  const first = legs.findIndex(l => l.kind === 'bus');
  if (first < 0) {
    out.push(tr('Pojdi peš {trajanje}.', { trajanje: duration(walkSec(0, legs.length) / 60) }));
    return out.join(' ');
  }
  let last = first;
  legs.forEach((l, i) => { if (l.kind === 'bus') last = i; });
  const leave = (legs[first] as Extract<PlanLeg, { kind: 'bus' }>).depSec - walkSec(0, first);
  const arrive = (legs[last] as Extract<PlanLeg, { kind: 'bus' }>).arrSec + walkSec(last + 1, legs.length);
  // Kot PlanSteps: več kot 90 s po času odhoda je odhod mimo (pot na karti je lahko stara).
  const now = new Date();
  const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  if (leave < nowSec - 90) out.push(tr('Ta odhod je mimo.') + ' ' + tr('Poišči novega.'));
  else out.push(tr('Kreni ob {time}, na cilju boš ob {arr}.', { time: fmtClock(leave), arr: fmtClock(arrive) }));

  // Ura, ob kateri se konča prejšnji korak — iz nje se vidi čakanje pred busom.
  let clock = leave;
  for (const l of legs) {
    if (l.kind === 'walk') {
      clock += l.sec;
      // Hoja pod 30 m ni korak: potnik je že na postaji (kot v PlanSteps).
      if (l.meters < 30) continue;
      const tj = duration(l.sec / 60);
      if (l.toStop && l.fromStop) out.push(tr('Pojdi peš {trajanje} od postajališča {od} do postajališča {do}.', { trajanje: tj, od: l.fromStop.name, do: l.toStop.name }));
      else if (l.toStop) out.push(tr('Pojdi peš {trajanje} do postajališča {stop}.', { trajanje: tj, stop: l.toStop.name }));
      else out.push(tr('Pojdi peš {trajanje} do cilja.', { trajanje: tj }));
    } else {
      const wait = l.depSec - clock;
      if (wait >= 60) out.push(tr('Počakaj {trajanje}.', { trajanje: duration(wait / 60) }));
      out.push(tr('Ob {time} na postajališču {stop} vstopi na avtobus linije {line}, smer {dest}.', {
        time: fmtClock(l.depSec), stop: l.from.name, line: l.route.short, dest: dest(l.headsign),
      }));
      out.push(tr('Izstopi na postajališču {stop} ob {time}, po {n} {enota}.', {
        stop: l.to.name, time: fmtClock(l.arrSec), n: l.stopCount,
        enota: plural(l.stopCount, ['postajališču', 'postajališčih', 'postajališčih', 'postajališčih'], ['stop', 'stops']),
      }));
      clock = l.arrSec;
    }
  }
  return out.join(' ');
}

// Predlogi poti v načrtovalniku.
export function candidatesSpeech(plans: Plan[]): string {
  return plans.map((p, i) => {
    const buses = p.legs.filter(l => l.kind === 'bus') as Extract<PlanLeg, { kind: 'bus' }>[];
    const how = buses.length === 0 ? tr('peš')
      : p.transfers === 0 ? tr('brez prestopanja')
      : word(p.transfers, ['prestop', 'prestopa', 'prestopi', 'prestopov'], ['change', 'changes']);
    let s = tr('Predlog {i}: {trajanje}, prihod ob {time}, {kako}.', {
      i: i + 1, trajanje: duration((p.arrSec - p.depSec) / 60, 'im'), time: fmtClock(p.arrSec), kako: how,
    });
    if (buses.length) s += ' ' + tr('Linije: {list}.', { list: buses.map(b => b.route.short).join(', ') });
    if (i === 0) s += ' ' + tr('Ta predlog je priporočen.');
    return s;
  }).join(' ');
}

// ── Vozni redi ──────────────────────────────────────────────────────────────

type Dep = { route: { short: string }; trip: { headsign: string }; depSec: number };

// `nowSec` je sekunda dneva, kadar je izbran današnji dan — takrat se berejo
// naslednji odhodi; za drug dan prvi in zadnji odhod po linijah.
export function stopTimetableSpeech(stop: string, day: string, deps: Dep[], nowSec: number | null): string {
  const s = tr('Vozni red postajališča {stop}, {dan}.', { stop, dan: day.toLowerCase() });
  if (deps.length === 0) return s + ' ' + tr('Ni odhodov za izbrani dan.');
  const sorted = [...deps].sort((a, b) => a.depSec - b.depSec);
  if (nowSec != null) {
    const next = sorted.filter(d => d.depSec >= nowSec).slice(0, 6);
    if (next.length) {
      return s + ' ' + tr('Naslednji odhodi: {list}.', {
        list: next.map(d => tr('linija {line} ob {time}', { line: d.route.short, time: fmtClock(d.depSec) })).join(', '),
      });
    }
  }
  const byLine = new Map<string, { first: number; last: number }>();
  for (const d of sorted) {
    const x = byLine.get(d.route.short);
    if (!x) byLine.set(d.route.short, { first: d.depSec, last: d.depSec });
    else x.last = d.depSec;
  }
  const lines = [...byLine].slice(0, 10).map(([line, x]) =>
    tr('Linija {line}: prvi odhod ob {first}, zadnji ob {last}.', { line, first: fmtClock(x.first), last: fmtClock(x.last) }));
  return [s, nowSec != null ? noMoreToday() : '', ...lines].filter(Boolean).join(' ');
}

export function lineTimetableSpeech(o: {
  line: string; dir: string; day: string; stop: string | null; times: number[]; nowSec: number | null;
}): string {
  const parts = [tr('Linija {line}, smer {dir}, {dan}.', { line: o.line, dir: dest(o.dir), dan: o.day.toLowerCase() })];
  if (o.stop) parts.push(tr('Postajališče {stop}.', { stop: o.stop }));
  const times = [...o.times].sort((a, b) => a - b);
  if (times.length === 0) { parts.push(tr('Ni voženj za izbrani dan.')); return parts.join(' '); }
  if (o.nowSec != null) {
    const next = times.filter(x => x >= o.nowSec!).slice(0, 6);
    if (next.length) parts.push(tr('Naslednji odhodi ob {list}.', { list: next.map(fmtClock).join(', ') }));
    else parts.push(tr('Danes ni več odhodov') + '.');
  }
  parts.push(tr('Prvi odhod ob {first}, zadnji ob {last}, skupaj {n}.', {
    first: fmtClock(times[0]), last: fmtClock(times[times.length - 1]),
    n: word(times.length, ['odhod', 'odhoda', 'odhodi', 'odhodov'], ['departure', 'departures']),
  }));
  return parts.join(' ');
}

// ── Vreme in cene ───────────────────────────────────────────────────────────

function degrees(n: number): string {
  return `${n} ${plural(Math.abs(n), ['stopinja', 'stopinji', 'stopinje', 'stopinj'], ['degree', 'degrees'])}`;
}

export function weatherSpeech(d: DayWeather): string {
  const out = [
    tr('Vreme danes: {temp}, {opis}.', { temp: degrees(d.tempC), opis: d.label.toLowerCase() }),
    tr('Najvišja temperatura {max}, najnižja {min}.', { max: degrees(d.tempMax), min: degrees(d.tempMin) }),
  ];
  const mm = Math.round(d.precipSumMm * 10) / 10;
  if (mm > 0) {
    const unit = Number.isInteger(mm)
      ? plural(mm, ['milimeter', 'milimetra', 'milimetri', 'milimetrov'], ['millimetre', 'millimetres'])
      : plural(2, ['milimeter', 'milimetra', 'milimetri', 'milimetrov'], ['millimetre', 'millimetres']);
    out.push(tr('Padavine: {mm} {enota}.', { mm: mm.toLocaleString(locale()), enota: unit }));
  } else {
    out.push(tr('Brez padavin.'));
  }
  // "do" zahteva rodilnik: do 1 kilometra, do 3 kilometrov.
  out.push(tr('Veter do {n} na uro.', { n: word(Math.round(d.windMaxKmh), ['kilometra', 'kilometrov', 'kilometrov', 'kilometrov'], ['kilometre', 'kilometres']) }));
  out.push(tr('Sončni vzhod ob {a}, zahod ob {b}.', { a: d.sunrise, b: d.sunset }));
  return out.join(' ');
}

// Cenik: uvod, skupine vozovnic ("Dnevne vozovnice: Dnevna, 6,00 €; …") in še
// odstavki, ki jih okno kaže pod tabelami.
export function faresSpeech(
  intro: string,
  groups: { title: string; rows: { label: string; note?: string; price: string }[] }[],
  more: string[] = [],
): string {
  const g = groups.map(x => `${x.title}: ` + x.rows.map(r => `${r.label}${r.note ? ` (${r.note})` : ''}, ${r.price}`).join('; ') + '.');
  return [intro, ...g, ...more].join(' ');
}
