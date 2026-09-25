import { derived, writable } from 'svelte/store';
import { seniorMode } from './settings';

// Preprost pogled: en zaslon z največ šestimi dejanji (moji avtobusi, domov,
// moji kraji, drug cilj, karta, celotna aplikacija) namesto petih zavihkov.
// Nadomešča nekdanji "način za starejše" — ime je namenoma nevtralno, ker
// vidna oznaka "za starejše" deluje kot žig (Li, Lee & Xu 2020). Povečava
// besedila ostane ločena nastavitev (settings.ts, seniorMode = "Večje besedilo").
// Utemeljitev: projekti/aplikacija_Mobilnost_Maas/raziskava_nacin_za_starejse.md

const VIEW_KEY = 'mm.simpleView.v1';
const PLACES_KEY = 'mm.simplePlaces.v1';

// Prehod iz 0.20: kdor je imel vklopljen način za starejše, ob prvem zagonu nove
// različice dobi preprost pogled. Ker se vrednost takoj zapiše, se to zgodi enkrat.
function initialView(): boolean {
  try {
    const s = localStorage.getItem(VIEW_KEY);
    if (s !== null) return JSON.parse(s) === true;
    return localStorage.getItem('mm.seniorMode.v1') === 'true';
  } catch { return false; }
}

export const simpleView = writable<boolean>(initialView());
simpleView.subscribe(v => {
  try { localStorage.setItem(VIEW_KEY, JSON.stringify(v)); } catch {}
});

// "Celotna aplikacija" iz preprostega pogleda: običajni vmesnik do naslednjega
// zagona, z vidnim gumbom za vrnitev. Namenoma ni shranjeno — ob ponovnem zagonu
// je uporabnik spet na varnem, znanem zaslonu.
export const simpleFullApp = writable(false);
export const simpleActive = derived([simpleView, simpleFullApp], ([v, f]) => v && !f);

// Velik prikaz (lestvica 1,5, kontrast AAA, končna postaja v ospredju) velja v
// preprostem pogledu vedno, v običajnem pa po nastavitvi "Večje besedilo".
export const largeUI = derived([seniorMode, simpleActive], ([s, a]) => s || a);

// Dom in do trije kraji. Kraj je samo cilj — izhodišče je vedno trenutna lega,
// zato ni treba shranjevati celih poti kot v savedRoutes.
export type SimplePlace = {
  id: string;
  kind: 'home' | 'place';
  label: string;   // "K zdravniku" — za dom se ne prikazuje
  name: string;    // naslov ali opis lege, kot ga vrne iskanje
  lat: number;
  lon: number;
};
export const MAX_PLACES = 3;

function okPlace(p: any): p is SimplePlace {
  return !!p && typeof p.id === 'string' && (p.kind === 'home' || p.kind === 'place')
    && typeof p.label === 'string' && typeof p.name === 'string'
    && Number.isFinite(p.lat) && Number.isFinite(p.lon);
}

function load(): SimplePlace[] {
  try {
    const s = localStorage.getItem(PLACES_KEY);
    if (!s) return [];
    const arr = JSON.parse(s);
    return Array.isArray(arr) ? arr.filter(okPlace) : [];
  } catch { return []; }
}

function save(list: SimplePlace[]) {
  try { localStorage.setItem(PLACES_KEY, JSON.stringify(list)); } catch {}
}

function genId(): string {
  try {
    const c: any = (globalThis as any).crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  } catch {}
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function create() {
  const { subscribe, update, set } = writable<SimplePlace[]>(load());
  const commit = (fn: (l: SimplePlace[]) => SimplePlace[]) => update(l => { const n = fn(l); save(n); return n; });
  return {
    subscribe,
    // Dom je en sam: nov zapis zamenja starega.
    setHome(p: { name: string; lat: number; lon: number }) {
      commit(l => [
        { id: l.find(x => x.kind === 'home')?.id ?? genId(), kind: 'home', label: '', ...p },
        ...l.filter(x => x.kind !== 'home'),
      ]);
    },
    savePlace(p: { id?: string; label: string; name: string; lat: number; lon: number }) {
      commit(l => {
        if (p.id && l.some(x => x.id === p.id)) {
          return l.map(x => x.id === p.id ? { ...x, label: p.label, name: p.name, lat: p.lat, lon: p.lon } : x);
        }
        if (l.filter(x => x.kind === 'place').length >= MAX_PLACES) return l;
        return [...l, { id: genId(), kind: 'place', label: p.label, name: p.name, lat: p.lat, lon: p.lon }];
      });
    },
    remove(id: string) { commit(l => l.filter(x => x.id !== id)); },
    restore(p: SimplePlace) { commit(l => l.some(x => x.id === p.id) ? l : [...l, p]); },
    clear() { set([]); save([]); },
  };
}

export const simplePlaces = create();
export const simpleHome = derived(simplePlaces, l => l.find(x => x.kind === 'home') ?? null);
export const simpleOthers = derived(simplePlaces, l => l.filter(x => x.kind === 'place'));
