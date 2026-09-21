// Anonimno štetje uporabe. Dogodek gre na POST /ev na lastnem Cloudflare
// Workerju, ta pa ga zapiše v Workers Analytics Engine. Tretje osebe ni,
// piškotka ni, identifikatorja naprave ni — zato tudi privolitveno okno ni
// potrebno.
//
// Kaj se pošlje, je omejeno na peščico znanih oznak; seznam je isti na obeh
// straneh (worker/src/analytics.js). Prosto besedilo Worker zavrže, zato po
// nesreči ne more uiti niti ime iskane postaje niti karkoli o lokaciji.
//
// Kadar povezave ni (aplikacija se uporablja na postaji), gre dogodek v
// localStorage in se pošlje, ko se povezava vrne. Brez tega bi manjkal ravno
// tisti del uporabe, ki nas najbolj zanima.

import { APP_VERSION } from './release';
import { analyticsEnabled } from './settings';
import { get } from 'svelte/store';

type Dogodek =
  | { e: 'zagon'; d: [string, string, string, string, string] }
  | { e: 'zavihek'; d: [string] }
  | { e: 'filter'; d: [string] }
  | { e: 'namestitev'; d: [string] }
  | { e: 'omrezje'; d: [string] }
  | { e: 'napaka'; d: [string, string] };

const KLJUC = 'mm.evq.v1';
const NAJVEC_V_VRSTI = 20;   // enako kot MAX_BATCH na Workerju

// Naslov končne točke. Privzeto se izpelje iz proxyja za OBA, da ni treba
// vzdrževati dveh spremenljivk; VITE_EV_ENDPOINT ima prednost, če je nastavljen.
function koncnaTocka(): string {
  const env = (import.meta as any).env ?? {};
  const izrecno = env.VITE_EV_ENDPOINT as string | undefined;
  if (izrecno) return izrecno.replace(/\/$/, '');
  const oba = env.VITE_OBA_PROXY as string | undefined;
  if (oba && /\/oba\/?$/.test(oba)) return oba.replace(/\/oba\/?$/, '/ev');
  return '';
}

// Zavrnitev sledenja v brskalniku spoštujemo, čeprav gre za anonimno štetje —
// uporabnik je s tem povedal, kaj hoče.
function dntVklopljen(): boolean {
  try {
    const n = navigator as any;
    return n.doNotTrack === '1' || n.doNotTrack === 'yes' || (window as any).doNotTrack === '1';
  } catch {
    return false;
  }
}

function vklopljeno(): boolean {
  if (!koncnaTocka()) return false;
  if (dntVklopljen()) return false;
  try { return get(analyticsEnabled); } catch { return false; }
}

function beriVrsto(): Dogodek[] {
  try {
    const s = localStorage.getItem(KLJUC);
    if (!s) return [];
    const a = JSON.parse(s);
    return Array.isArray(a) ? a.slice(-NAJVEC_V_VRSTI) : [];
  } catch {
    return [];
  }
}

function pisiVrsto(v: Dogodek[]) {
  try {
    if (v.length === 0) localStorage.removeItem(KLJUC);
    else localStorage.setItem(KLJUC, JSON.stringify(v.slice(-NAJVEC_V_VRSTI)));
  } catch {
    // Zasebno okno ali polna shramba — dogodek preprosto izgubimo.
  }
}

let posiljanjeTeče = false;

/** Pošlje, kar je v vrsti. Ob neuspehu vrsta ostane za naslednji poskus. */
export async function flush(): Promise<void> {
  if (posiljanjeTeče || !vklopljeno()) return;
  const vrsta = beriVrsto();
  if (vrsta.length === 0) return;
  posiljanjeTeče = true;
  // Vrsto izpraznimo šele po uspehu; ob napaki se dogodki ne podvojijo, ker so
  // do takrat samo v localStorage.
  try {
    const res = await fetch(koncnaTocka(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ b: vrsta }),
      keepalive: true,
      cache: 'no-store',
    });
    // 4xx pomeni, da je oblika napačna — ponavljanje ne bi pomagalo, zato tudi
    // takrat vrsto počistimo. Samo omrežna napaka in 5xx jo pustita pri miru.
    if (res.ok || (res.status >= 400 && res.status < 500)) pisiVrsto([]);
  } catch {
    // brez povezave — poskusimo ob dogodku 'online'
  } finally {
    posiljanjeTeče = false;
  }
}

/** Zabeleži dogodek. Nikoli ne vrže in nikoli ne blokira klicatelja. */
export function track(d: Dogodek): void {
  if (!vklopljeno()) return;
  const vrsta = beriVrsto();
  vrsta.push(d);
  pisiVrsto(vrsta);
  // Ne čakamo na izid: analitika ne sme upočasniti ničesar.
  void flush();
}

function nacinZagona(): string {
  try {
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return 'namescena';
    if ((navigator as any).standalone === true) return 'namescena';   // iOS
  } catch {}
  return 'brskalnik';
}

function temaOznaka(): string {
  const c = document.documentElement.classList;
  if (c.contains('contrast')) return 'kontrast';
  if (c.contains('mono')) return 'crnobelo';
  if (c.contains('dark')) return 'temna';
  return 'svetla';
}

function razlicica(): string {
  const sha = typeof __BUILD_SHA__ !== 'undefined' ? __BUILD_SHA__ : 'dev';
  return `${APP_VERSION}-${sha}`;
}

function jezik(): string {
  const l = (navigator.language || '').slice(0, 5);
  return /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(l) ? l : 'sl';
}

let zagnano = false;

/**
 * Pokliče se enkrat ob zagonu aplikacije: zabeleži zagon, obesi poslušalce za
 * omrežje in namestitveni poziv ter pošlje, kar je ostalo iz prejšnje seje.
 */
export function initAnalytics(): void {
  if (zagnano) return;
  zagnano = true;

  // Način za starejše se prebere iz razreda, da ni odvisnosti na store.
  const starejsi = document.documentElement.classList.contains('senior') ? 'da' : 'ne';
  track({ e: 'zagon', d: [nacinZagona(), razlicica(), temaOznaka(), starejsi, jezik()] });

  window.addEventListener('online', () => { track({ e: 'omrezje', d: ['online'] }); });
  window.addEventListener('offline', () => { track({ e: 'omrezje', d: ['offline'] }); });

  // Namestitveni lijak. Na iPhonu teh dogodkov NI — tam je edini signal zagon
  // v načinu 'namescena' (glej nacinZagona).
  window.addEventListener('beforeinstallprompt', () => { track({ e: 'namestitev', d: ['ponujeno'] }); });
  window.addEventListener('appinstalled', () => { track({ e: 'namestitev', d: ['sprejeto'] }); });

  // Ob vrnitvi v ospredje poskusimo poslati, kar je ostalo brez povezave.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void flush(); });
  void flush();
}
