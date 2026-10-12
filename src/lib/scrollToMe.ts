// Vozni red se odpre pri naslednjem odhodu (evalvacija 04.10.2026, N11): ob 7:40 je bilo
// treba drseti od 05:00. Akcija na vrstici naslednjega odhoda jo ob prikazu postavi na vrh
// drsnega vsebnika (`data-tt-scroll`), tako da ostane vidna še ena vrstica prej.
export function scrollToMe(node: HTMLElement, active: boolean) {
  function go(on: boolean) {
    if (!on) return;
    requestAnimationFrame(() => {
      const box = node.closest<HTMLElement>('[data-tt-scroll]');
      if (!box) return;
      box.scrollTop += node.getBoundingClientRect().top - box.getBoundingClientRect().top - 56;
    });
  }
  go(active);
  return { update: go };
}

// Na korenu bloka {#key}: vsebnik `data-tt-scroll` ostane med menjavami vsebine isti,
// zato je drsni položaj seznama ob 17:00 (~2000 px) prešel na izbirnik postajališča ali
// na drug dan in prve vrstice so bile izven zaslona (pregled 12.10.2026). Nova vsebina
// začne na vrhu; scrollToMe se nato premakne do naslednjega odhoda (v naslednji sličici).
export function resetScroll(node: HTMLElement) {
  const box = node.closest<HTMLElement>('[data-tt-scroll]');
  if (box) box.scrollTop = 0;
}
