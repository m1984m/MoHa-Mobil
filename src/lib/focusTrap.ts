// Svelte action: ujame Tab/Shift+Tab znotraj modala in ob odprtju postavi fokus vanj.
// Brez tega je bralnik zaslona / zunanja tipkovnica lahko odtavala na vsebino pod
// modalom, ki je vizualno zakrita.
//
// Uporaba:  <div use:focusTrap on:introend=...>  — action se sproži ob mount-u elementa.

const SELECTOR = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(SELECTOR))
    .filter(el => el.offsetParent !== null || el === document.activeElement);
}

export function focusTrap(node: HTMLElement) {
  const previouslyFocused = document.activeElement as HTMLElement | null;

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const items = focusable(node);
    if (items.length === 0) { e.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !node.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // Fokus na prvi element šele po prvem frame-u — ob mount-u vsebina modala
  // (npr. seznam odhodov) pogosto še ni izrisana.
  const raf = requestAnimationFrame(() => {
    if (node.contains(document.activeElement)) return;
    const items = focusable(node);
    (items[0] ?? node).focus({ preventScroll: true });
  });

  node.addEventListener('keydown', onKeydown);

  return {
    destroy() {
      cancelAnimationFrame(raf);
      node.removeEventListener('keydown', onKeydown);
      // Vrni fokus na element, ki je modal odprl — sicer pristane na <body>.
      try { previouslyFocused?.focus({ preventScroll: true }); } catch {}
    },
  };
}
