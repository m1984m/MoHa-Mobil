// Centralna obravnava sistemskega "nazaj" (Android gumb / browser back).
// Brez tega back iz kateregakoli modala/izbire vrže uporabnika iz PWA.
//
// Vsak odprt element (modal, izbrana postaja, izbran bus, aktiven plan) ob
// odprtju registrira svoj close callback prek pushBack(close) in dobi nazaj
// release() za primer ročnega zaprtja (X gumb): release odstrani vnos in
// počisti pripadajoči history entry, NE kliče close.
//
// Predpostavka: odpiranja/zapiranja so LIFO (v tej aplikaciji vedno — modal
// čez modal se odpre in zapre gnezdeno). Out-of-order release bi pustil
// en odvečen history entry, kar je benigno (en back več do izhoda).

import { stopSpeaking } from './speech';

type Entry = { id: number; close: () => void };
// release nosi id vnosa: kdor zapira več vnosov naenkrat (npr. zaslon ob uničenju),
// jih zapre od najnovejšega proti najstarejšemu, da je vsak ob sprostitvi na vrhu.
export type BackRelease = (() => void) & { id: number };

let stack: Entry[] = [];
let nextId = 1;
let ignorePops = 0;
// Vnosi, ki še čakajo na svoj pushState — glej pushBack.
let queued: number[] = [];
let settleTimer: ReturnType<typeof setTimeout> | null = null;

function doPush(id: number) {
  try { history.pushState({ mmBack: id }, ''); } catch {}
}

// Varovalo: če popstate iz kakršnegakoli razloga ne pride, čakajoči vnosi ne smejo
// obviseti — brez njih bi naslednji "nazaj" zaprl aplikacijo. V ozadju (telefon je
// pokazal obvestilo, uporabnik je preklopil aplikacijo) popstate lahko zamuja; prezgodnja
// ponastavitev bi pozni popstate prebrala kot uporabnikov "nazaj" in zaprla napačen
// pogled, zato takrat varovalo samo počaka naprej.
function armSettle() {
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    if (typeof document !== 'undefined' && document.hidden) { armSettle(); return; }
    ignorePops = 0;
    flushQueued();
  }, 3000);
}

function flushQueued() {
  if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
  const ids = queued;
  queued = [];
  for (const id of ids) if (stack.some(e => e.id === id)) doPush(id);
}

export function pushBack(close: () => void): BackRelease {
  // Novo okno čez obstoječe utiša glasno branje. Gumb "Ustavi branje" je na oknu,
  // ki bere, in bi bil pod novim oknom nedosegljiv — branje bi teklo naprej brez
  // načina, da ga ustaviš.
  stopSpeaking();
  const id = nextId++;
  stack.push({ id, close });
  // history.back() iz release() je asinhron in Chrome njegov cilj določi ob klicu.
  // pushState, izveden pred njim (zapri en pogled + odpri drugega v istem koraku),
  // bi zato končal NAD ciljem koraka nazaj: brskalnik bi ostal en vnos za aplikacijo
  // in zadnji "nazaj" bi zaprl PWA (izmerjeno 25.09.2026). Zato nov vnos počaka,
  // da se čakajoči koraki nazaj izvedejo.
  if (ignorePops > 0) queued.push(id); else doPush(id);
  const release = () => {
    const idx = stack.findIndex(e => e.id === id);
    if (idx === -1) return; // že pobran prek popstate (zaprt z back gumbom)
    const jeNaVrhu = idx === stack.length - 1;
    stack.splice(idx, 1);
    // Vnos, ki še ni bil zapisan v zgodovino, nima česa preklicati.
    const q = queued.indexOf(id);
    if (q !== -1) { queued.splice(q, 1); return; }
    // Sentinel odstrani SAMO, če je ta vnos na vrhu. history.back() vedno prekliče
    // zadnji vnos v zgodovini, ne našega: ob zapiranju vmesnega vnosa (iskanje postaje
    // se zapre šele potem, ko je izbrana postaja že potisnila svojega) bi odstranil
    // tujega. Posledica je bila, da je brskalnik ostal en korak pred aplikacijo in je
    // sistemski »nazaj« uporabnika vrgel iz aplikacije namesto na prejšnji pogled.
    // Odvečni sentinel, ki ostane, požre en pritisk nazaj — to je neopazno.
    if (!jeNaVrhu) return;
    ignorePops++;
    try { history.back(); } catch { ignorePops--; return; }
    armSettle();
  };
  return Object.assign(release, { id });
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (ignorePops > 0) {
      ignorePops--;
      if (ignorePops === 0) flushQueued();
      return;
    }
    const top = stack.pop();
    if (top) top.close();
  });
}
