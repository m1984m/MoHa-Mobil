// Prevodi (slovenščina / angleščina).
//
// Ključ je slovensko besedilo samo — koda ostane berljiva (`$t('Najbližja postajališča')`),
// manjkajoč angleški prevod pa varno pokaže slovenščino namesto praznega niza ali ključa.
// Spremenljivke v besedilu: `$t('Čez {n} min', { n: 5 })`.
//
// Imena postajališč, linij in smeri (GTFS) se NE prevajajo — to so lastna imena, ki jih
// potnik bere tudi na tabli postajališča in na avtobusu.
//
// Slovarji so razdeljeni po zaslonih v `i18n/en/*.ts`, da se ob spremembi enega zaslona
// ne dotikaš skupne datoteke. Preverba pokritosti: `npm run i18n:check`.
//
// Angleški slovar ni v začetnem paketu: naloži se ob zagonu, če je jezik angleščina
// (main.ts počaka nanj pred prvim izrisom), ali ob preklopu jezika. Dokler ga ni, se
// pokaže slovensko besedilo, po nalaganju se predloge izrišejo znova (`dictVer`).
import { derived, get, writable } from 'svelte/store';

export type Lang = 'sl' | 'en';
export const LANG_KEY = 'mm.lang.v1';

type Dict = Record<string, string>;
let EN: Dict | null = null;
let enLoading: Promise<void> | null = null;
// Poveča se, ko je slovar naložen — `t` je izpeljan tudi iz njega.
const dictVer = writable(0);

/** Naloži angleški slovar (enkrat). Ob napaki (brez povezave) ostane slovenščina, naslednji klic poskusi znova. */
export function loadEn(): Promise<void> {
  if (EN) return Promise.resolve();
  if (!enLoading) {
    enLoading = import('./i18nEn')
      .then(m => { EN = m.default; dictVer.update(n => n + 1); })
      .catch(() => { enLoading = null; });
  }
  return enLoading;
}

// Privzeto slovenščina: aplikacija je za Maribor, mnogo domačih uporabnikov pa ima
// telefon nastavljen na angleščino — samodejna izbira po jeziku naprave bi jim
// prikazala angleški vmesnik. Jezik se izbere v vodiču ob prvem zagonu ali v Nastavitvah.
function initialLang(): Lang {
  try {
    const s = localStorage.getItem(LANG_KEY);
    if (s === '"en"' || s === '"sl"') return JSON.parse(s);
  } catch {}
  return 'sl';
}

export const lang = writable<Lang>(initialLang());
lang.subscribe(v => {
  try { localStorage.setItem(LANG_KEY, JSON.stringify(v)); } catch {}
  if (typeof document !== 'undefined') document.documentElement.lang = v;
  if (v === 'en') void loadEn();
});

// Ključ za ponoven izris celega drevesa (`{#key $langKey}` v App.svelte): spremeni se ob
// menjavi jezika IN ko se slovar naloži, da se osvežijo tudi besedila iz `tr()`, ki niso
// reaktivna.
// Pri slovenščini se ključ ob prihodu slovarja NE spremeni: slovar se prednaloži v ozadju
// (App.svelte), ponoven izris drevesa pa bi zaprl odprta okna.
export const langKey = derived([lang, dictVer], ([l, v]) => (l === 'en' ? `en:${v}` : 'sl'));

/** Za main.ts: slovar izbranega jezika je pripravljen (slovenščina takoj). */
export function langReady(): Promise<void> {
  return get(lang) === 'en' ? loadEn() : Promise.resolve();
}

type Vars = Record<string, string | number>;

function fill(s: string, vars?: Vars): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

const missing = new Set<string>();
function translate(l: Lang, sl: string, vars?: Vars): string {
  if (l === 'sl') return fill(sl, vars);
  const en = EN ? EN[sl] : undefined;
  if (EN && en === undefined && import.meta.env.DEV && !missing.has(sl)) {
    missing.add(sl);
    console.warn('[i18n] manjka EN:', sl);
  }
  return fill(en ?? sl, vars);
}

// Za predloge Svelte: `$t('…')` se ob menjavi jezika izriše znova.
export const t = derived([lang, dictVer], ([l]) => (sl: string, vars?: Vars) => translate(l, sl, vars));

// Za kodo zunaj komponent (.ts moduli, toasti, obvestila) — vrne trenutni jezik ob klicu.
export function tr(sl: string, vars?: Vars): string {
  return translate(get(lang), sl, vars);
}

// Slovenščina ima štiri oblike ob števniku (1 minuta, 2 minuti, 3 minute, 5 minut),
// angleščina dve. Odloča ostanek pri 100 (glej fmtPlural v time.ts).
export function plural(n: number, sl: [string, string, string, string], en: [string, string]): string {
  if (get(lang) === 'en') return Math.abs(n) === 1 ? en[0] : en[1];
  const r = Math.abs(Math.round(n)) % 100;
  if (r === 1) return sl[0];
  if (r === 2) return sl[1];
  if (r === 3 || r === 4) return sl[2];
  return sl[3];
}

// Oznaka za Intl (datumi, števila).
export function locale(): string {
  return get(lang) === 'en' ? 'en-GB' : 'sl-SI';
}
