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

type Entry = { id: number; close: () => void };

let stack: Entry[] = [];
let nextId = 1;
let ignorePops = 0;

export function pushBack(close: () => void): () => void {
  const id = nextId++;
  stack.push({ id, close });
  try { history.pushState({ mmBack: id }, ''); } catch {}
  return () => {
    const idx = stack.findIndex(e => e.id === id);
    if (idx === -1) return; // že pobran prek popstate (zaprt z back gumbom)
    stack.splice(idx, 1);
    // Odstrani sentinel history entry; popstate, ki ga history.back() sproži,
    // mora handler spodaj ignorirati.
    ignorePops++;
    try { history.back(); } catch { ignorePops--; }
  };
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (ignorePops > 0) { ignorePops--; return; }
    const top = stack.pop();
    if (top) top.close();
  });
}
