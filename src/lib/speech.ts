import { derived, get, writable } from 'svelte/store';
import { lang, tr } from './i18n';
import { toast } from './toast';
import { forSpeech } from './pronounce';


// Glasno branje. Besedila za posamezna okna sestavi readAloud.ts, gumb je
// ui/ReadAloud.svelte.
//
// Slovensko besedilo najprej prebere nevronski glas Petra prek Workerja (POST /tts,
// glej worker/src/tts.js). Sistemski glas telefona je za slovenščino robotski,
// marsikje pa ga sploh ni. Brez povezave ali ob napaki Workerja bere sistemski glas
// (Web Speech), angleščino pa vedno on — angleški glas ima vsak telefon.
//
// Sistemski glas bere samo v jeziku vmesnika. Slovenskega besedila z angleškim
// glasom ne beremo — to bi bilo nerazumljivo. Seznam glasov pride pri Chromu šele
// po dogodku voiceschanged.

const voices = writable<SpeechSynthesisVoice[]>([]);
export const speaking = writable(false);
// Kdo bere: gumb, ki je branje začel. Med branjem je "Ustavi branje" samo na njem,
// ne na vseh gumbih v aplikaciji.
export const speakingOwner = writable<unknown>(null);
// Reference na izgovore, dokler se ne končajo: Chrome sicer izgovor lahko pobere
// smetar, onend se ne sproži in gumb obvisi na "Ustavi branje".
let current: SpeechSynthesisUtterance[] = [];

// Naslov se izpelje iz proxyja za OBA (kot pri analitiki), da ni treba vzdrževati
// še ene spremenljivke; VITE_TTS_ENDPOINT ima prednost, če je nastavljen.
function ttsEndpoint(): string {
  const env = (import.meta as any).env ?? {};
  const izrecno = env.VITE_TTS_ENDPOINT as string | undefined;
  if (izrecno) return izrecno.replace(/\/$/, '');
  const oba = env.VITE_OBA_PROXY as string | undefined;
  if (oba && /\/oba\/?$/.test(oba)) return oba.replace(/\/oba\/?$/, '/tts');
  return '';
}
const TTS_URL = ttsEndpoint();
const TTS_LANG = 'sl';          // Worker ima samo slovenski glas
// Mora biti daljše od Workerjeve meje (10 s), sicer odjemalec odneha, preden dobi
// njegov odgovor. Ob normalnem teku prvi kos pride v ~3 s.
const TTS_TIMEOUT_MS = 12000;
// Azure (F0) sintetizira ~1 s na 100 znakov (izmerjeno 26.09.2026: 108 znakov
// 2,2 s; 225 znakov 3,9 s). Prvi kos je zato kratek — postajališče in prvi odhod —
// da Petra začne v ~2 s; naslednji se prenaša, medtem ko prejšnji igra, zato sme
// biti daljši. Worker sprejme največ 800 znakov na klic.
const TTS_FIRST_CHUNK = 120;
// Kratko branje (eno postajališče z nekaj odhodi) ostane en kos: razdelitev bi
// prihranila le ~0,5 s, porabila pa dva klica od 20 na minuto (Azure F0).
const TTS_SINGLE_MAX = 160;
const TTS_CHUNK = 500;
// Worker je javil 503 (ključ ni nastavljen ali ne velja) ali 404 (Worker te poti
// še nima) — to se med sejo ne popravi, zato ga do konca seje ne kličemo več.
const ttsOff = writable(false);

// Tihih 10 ms. iOS dovoli predvajanje samo iz dotika, posnetek pa pride šele po
// nekaj sto milisekundah; element, ki je enkrat zaigral iz dotika, sme potem
// zaigrati tudi brez njega.
const SILENCE = 'data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';

let seq = 0;    // vsak speak/stop ga poveča; odziv starejšega branja se po tem prepozna
let abort: AbortController | null = null;
let audio: HTMLAudioElement | null = null;
let blobUrl: string | null = null;

function supported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

if (supported()) {
  const read = () => { try { voices.set(window.speechSynthesis.getVoices()); } catch {} };
  read();
  try { window.speechSynthesis.addEventListener('voiceschanged', read); } catch {}
}

// Izboljšana različica sistemskega glasu (iPhone: Nastavitve → Dostopnost → Govorjena
// vsebina → Glasovi, npr. "Tina (izboljšano)", voiceURI "…enhanced…"/"…premium…")
// zveni bistveno manj robotsko od osnovne, ki jo iOS navede prav tako.
const BETTER = /enhanced|premium|izbolj|natural|neural/i;

export function pickVoice(list: SpeechSynthesisVoice[], l: string): SpeechSynthesisVoice | null {
  const mine = list.filter(v => v.lang.toLowerCase().replace('_', '-').startsWith(l));
  const better = (v: SpeechSynthesisVoice) => BETTER.test(v.name) || BETTER.test(v.voiceURI ?? '');
  // Lokalni glas deluje tudi brez povezave; spletni (npr. Edge "Online") ne.
  return mine.find(v => v.localService && better(v)) ?? mine.find(v => v.localService) ?? mine[0] ?? null;
}

function ttsUsable(l: string, off: boolean): boolean {
  return !!TTS_URL && l === TTS_LANG && !off && typeof Audio !== 'undefined';
}

export const canSpeak = derived([voices, lang, ttsOff], ([v, l, off]) =>
  ttsUsable(l, off) || (supported() && pickVoice(v, l) !== null));

// Razdeli besedilo na kose po mejah stavkov: prvi do `first` znakov, ostali do
// `max`. Stavek, daljši od meje, se razreže pri zadnjem presledku.
export function chunks(text: string, max = TTS_CHUNK, first = TTS_FIRST_CHUNK, single = TTS_SINGLE_MAX): string[] {
  if (text.trim().length <= single) return text.trim() ? [text.trim()] : [];
  const sentences = text.match(/[^.!?]+(?:[.!?]+|$)\s*/g) ?? [text];
  const out: string[] = [];
  let cur = '';
  const limit = () => (out.length === 0 ? Math.min(first, max) : max);
  const push = (s: string) => { if (s.trim()) out.push(s.trim()); };
  for (let s of sentences) {
    while (s.length > limit()) {
      const lim = limit();
      const cut = s.lastIndexOf(' ', lim);
      const at = cut > 0 ? cut : lim;
      if (cur.trim()) { push(cur); cur = ''; continue; }
      push(s.slice(0, at));
      s = s.slice(at);
    }
    if ((cur + s).length > limit()) { push(cur); cur = ''; }
    cur += s;
  }
  push(cur);
  return out;
}

function finish(my: number) {
  if (my !== seq) return;
  speaking.set(false);
  speakingOwner.set(null);
}

function releaseAudio() {
  if (audio) {
    audio.onended = null;
    audio.onerror = null;
    audio.onpause = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
}

// Sistemski glas bere po kosih (en izgovor na kos): Android dolgih izgovorov
// (~4000 znakov) ne sprejme, nekateri spletni glasovi pa utihnejo po ~15 s.
function speakSystem(parts: string[], v: SpeechSynthesisVoice, my: number) {
  const s = window.speechSynthesis;
  s.cancel();
  const list = parts.filter(p => p.trim());
  if (!list.length) { finish(my); return; }
  const batch = list.map(text => {
    const u = new SpeechSynthesisUtterance(text);
    u.voice = v;
    u.lang = v.lang;
    u.rate = 0.9; // nekoliko počasneje od privzetega — bere se med hojo ali na postaji
    return u;
  });
  // Preklic prejšnjega branja (cancel zgoraj) sproži onend/onerror njegovih
  // izgovorov — ta ne sme ugasniti stanja novega, zato šteje samo ta paket.
  // Konec je zadnji izgovor ali napaka kateregakoli.
  const done = () => { if (current !== batch) return; current = []; finish(my); };
  batch.forEach((u, i) => {
    u.onend = i === batch.length - 1 ? done : null;
    u.onerror = done;
  });
  current = batch;
  speaking.set(true);
  for (const u of batch) s.speak(u);
}

async function fetchAudio(part: string, signal: AbortSignal): Promise<Blob> {
  const res = await fetch(TTS_URL, {
    method: 'POST',
    // text/plain je za CORS "preprost" klic — brez predhodnega OPTIONS.
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: part,
    signal,
  });
  if (res.status === 503 || res.status === 404) ttsOff.set(true);
  if (!res.ok) throw new Error('tts ' + res.status);
  return res.blob();
}

async function speakNeural(text: string, my: number, sys: SpeechSynthesisVoice | null) {
  const parts = chunks(text);
  let at = 0;   // kos, ki igra ali nanj čakamo

  // Posnetka ni bilo ali se ni dal predvajati: preostanek prebere sistemski glas,
  // če obstaja. Isti neuspeh lahko pride dvakrat (napaka elementa in zavrnjen
  // play()), bere pa se samo enkrat — drugi klic bi prekinil prvi izgovor in gumb
  // bi se vrnil med branjem.
  let fell = false;
  const fallback = () => {
    if (fell || my !== seq) return;   // že obravnavano ali medtem ustavljeno
    fell = true;
    releaseAudio();
    if (sys) speakSystem(parts.slice(at), sys, my);
    else { finish(my); toast.show(tr('Glasno branje trenutno ni na voljo.')); }
  };
  let played = 0;   // koliko kosov je že zaigralo

  const ctrl = new AbortController();
  abort = ctrl;
  // Meja velja od začetka čakanja na kos do začetka njegovega predvajanja — tudi
  // play() lahko obvisi.
  let timer: ReturnType<typeof setTimeout> | null = null;
  const disarm = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const arm = () => { disarm(); timer = setTimeout(() => { ctrl.abort(); fallback(); }, TTS_TIMEOUT_MS); };

  const a = audio!;
  try {
    let next: Promise<Blob> | null = fetchAudio(parts[0], ctrl.signal);
    for (at = 0; at < parts.length; at++) {
      arm();
      const blob: Blob = await next!;
      if (fell || my !== seq) return;
      next = at + 1 < parts.length ? fetchAudio(parts[at + 1], ctrl.signal) : null;
      next?.catch(() => {});   // napaka pride ob await v naslednjem krogu
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      blobUrl = URL.createObjectURL(blob);
      // Premor od zunaj (klic, zaklenjen zaslon, predvajalnik v obvestilih) ne
      // sproži `ended` — takrat se branje konča. Tudi konec posnetka najprej
      // sproži pause; takrat je `ended` true ali pa je položaj na koncu (WebKit
      // trajanje MP3 z ocenjeno dolžino ne javi vedno natančno).
      const atEnd = () => a.ended || (Number.isFinite(a.duration) && a.currentTime >= a.duration - 0.3);
      // Šteje šele po začetku predvajanja: menjava vira ustavi prejšnji zvok.
      let paused = false;
      let started = false;
      const ended = new Promise<void>((resolve, reject) => {
        a.onended = () => resolve();
        a.onerror = () => reject(new Error('audio'));
        a.onpause = () => { if (started && !atEnd()) { paused = true; resolve(); } };
      });
      ended.catch(() => {});   // napaka pride ob await spodaj; če play() pade prej, nikogar ne zanima
      a.src = blobUrl;
      await a.play();
      started = true;
      played++;
      disarm();
      if (fell || my !== seq) return;
      await ended;
      if (fell || my !== seq) return;
      if (paused) { releaseAudio(); finish(my); ctrl.abort(); return; }
    }
    releaseAudio();
    finish(my);
  } catch {
    // Telefon v ozadju (zaklenjen) naslednjega kosa ne pusti predvajati. Sistemski
    // glas bi tam prav tako molčal in gumb bi obvisel na "Ustavi branje" — branje
    // se konča tiho, prebrani del je bil slišan.
    if (played > 0 && typeof document !== 'undefined' && document.hidden && my === seq && !fell) {
      releaseAudio();
      finish(my);
      return;
    }
    fallback();
  } finally {
    disarm();
    if (abort === ctrl) abort = null;
  }
}

// `owner` je gumb, ki bere (glej speakingOwner); brez njega bere "nihče".
// Odklene zvok med dotikom (iOS): prazen izgovor za sistemski glas in tišina za
// element, ki bo predvajal Petro — glej SILENCE. speak() to naredi sam; kdor bo
// bral šele malo po dotiku (npr. ob odprtju okna, ko se to izriše), pokliče
// primeAudio() v dotiku. Prazen izgovor gre pred tišino, da govor ne prevzame
// zvoka potem, ko element že igra.
function unlock(sys: SpeechSynthesisVoice | null) {
  if (sys) {
    try {
      const u = new SpeechSynthesisUtterance('');
      u.volume = 0;
      window.speechSynthesis.speak(u);
    } catch {}
  }
  if (typeof Audio === 'undefined') return;
  if (!audio) audio = new Audio();
  audio.src = SILENCE;
  audio.play().catch(() => {});
}

export function primeAudio() {
  unlock(supported() ? pickVoice(get(voices), get(lang)) : null);
}

export function speak(text: string, owner: unknown = null) {
  stopSpeaking();
  if (!text.trim()) return;
  const my = seq;
  const l = get(lang);
  // Okrajšave v imenih postajališč ("Prol. brigad", "Zg. Duplek") razpiše slovar
  // izgovorjave — glej pronounce.ts. Samo slovensko: razpis je v slovenščini.
  if (l === 'sl') text = forSpeech(text);
  const sys = supported() ? pickVoice(get(voices), l) : null;
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;

  if (ttsUsable(l, get(ttsOff)) && online) {
    // Mora steči zdaj, še med dotikom (iOS); sistemski glas se odklene za primer,
    // da posnetka ne bo.
    unlock(sys);
    speakingOwner.set(owner);
    speaking.set(true);
    void speakNeural(text, my, sys);
    return;
  }
  if (sys) { speakingOwner.set(owner); speakSystem(chunks(text), sys, my); return; }
  // Sem pride samo slovensko branje brez povezave na telefonu brez slovenskega glasu.
  toast.show(tr('Za glasno branje je potrebna povezava.'));
}

export function stopSpeaking() {
  seq++;
  abort?.abort();
  abort = null;
  releaseAudio();
  if (supported()) window.speechSynthesis.cancel();
  current = [];
  speaking.set(false);
  speakingOwner.set(null);
}
