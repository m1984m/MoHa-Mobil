import { derived, get, writable } from 'svelte/store';
import { lang, plural, tr } from './i18n';
import { splitHeadsign } from './gtfs';
import { fmtClock } from './time';
import type { DepartureRow } from './departures';

// Glasno branje odhodov prek vgrajenega govora brskalnika (Web Speech API).
//
// Bere samo z glasom v jeziku vmesnika. Slovenskega besedila z angleškim glasom ne
// beremo — to bi bilo nerazumljivo, zato se gumb takrat ne pokaže. Ali ima telefon
// slovenski glas, je odvisno od sistema; seznam glasov pride pri Chromu šele po
// dogodku voiceschanged.

const voices = writable<SpeechSynthesisVoice[]>([]);
export const speaking = writable(false);
// Referenca na izgovor, dokler se ne konča: Chrome sicer izgovor lahko pobere smetar,
// onend se ne sproži in gumb obvisi na "Ustavi branje".
let current: SpeechSynthesisUtterance | null = null;

function supported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

if (supported()) {
  const read = () => { try { voices.set(window.speechSynthesis.getVoices()); } catch {} };
  read();
  try { window.speechSynthesis.addEventListener('voiceschanged', read); } catch {}
}

function pickVoice(list: SpeechSynthesisVoice[], l: string): SpeechSynthesisVoice | null {
  const mine = list.filter(v => v.lang.toLowerCase().replace('_', '-').startsWith(l));
  // Lokalni glas deluje tudi brez povezave; spletni (npr. Edge "Online") ne.
  return mine.find(v => v.localService) ?? mine[0] ?? null;
}

export const canSpeak = derived([voices, lang], ([v, l]) => supported() && pickVoice(v, l) !== null);

export function speak(text: string) {
  if (!supported()) return;
  const v = pickVoice(get(voices), get(lang));
  if (!v) return;
  const s = window.speechSynthesis;
  s.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = v;
  u.lang = v.lang;
  u.rate = 0.9; // nekoliko počasneje od privzetega — bere se med hojo ali na postaji
  // Preklic prejšnjega izgovora (cancel zgoraj) sproži njegov onend — ta ne sme
  // ugasniti stanja novega.
  const done = () => { if (current === u) { current = null; speaking.set(false); } };
  u.onend = done;
  u.onerror = done;
  current = u;
  speaking.set(true);
  s.speak(u);
}

export function stopSpeaking() {
  if (supported()) window.speechSynthesis.cancel();
  current = null;
  speaking.set(false);
}

function minutes(n: number): string {
  return plural(n, ['minuto', 'minuti', 'minute', 'minut'], ['minute', 'minutes']);
}

// "Linija G6, smer Kamnica, čez 4 minute. Zamuja 2 minuti." — "smer" + imenovalnik,
// ker sklanjanja imen postaj ("proti Kamnici") ne moremo narediti zanesljivo.
function rowSentence(r: DepartureRow): string {
  const dest = splitHeadsign(r.headsign, r.destination).dest;
  let s: string;
  if (r.minutesFromNow <= 0) s = tr('Linija {line}, smer {dest}, prihaja zdaj.', { line: r.routeShort, dest });
  else if (r.minutesFromNow < 60) s = tr('Linija {line}, smer {dest}, čez {n} {enota}.', { line: r.routeShort, dest, n: r.minutesFromNow, enota: minutes(r.minutesFromNow) });
  else s = tr('Linija {line}, smer {dest}, ob {time}.', { line: r.routeShort, dest, time: fmtClock(r.depSec) });
  const d = r.delayMin ?? 0;
  if (r.delayKnown && d >= 1) s += ' ' + tr('Zamuja {n} {enota}.', { n: d, enota: minutes(d) });
  return s;
}

export function departuresSpeech(stops: { name: string; rows: DepartureRow[] }[]): string {
  return stops.map(st => {
    const body = st.rows.length ? st.rows.map(rowSentence).join(' ') : tr('Danes ni več odhodov');
    return tr('Postajališče {stop}.', { stop: st.name }) + ' ' + body;
  }).join(' ');
}
