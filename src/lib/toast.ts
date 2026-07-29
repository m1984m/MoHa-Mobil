import { writable } from 'svelte/store';

// Skupen toast z opcijskim "Razveljavi". Prej je toast obstajal samo v MapScreen
// (lokalna spremenljivka saveToast), brisanje priljubljenih pa je bilo nepovratno.

export type Toast = {
  id: number;
  msg: string;
  undo: (() => void) | null;
};

const DURATION_MS = 2200;
const DURATION_UNDO_MS = 5000; // dlje, ker mora uporabnik utegniti reagirati

let seq = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

function make() {
  const { subscribe, set } = writable<Toast | null>(null);

  function show(msg: string, undo: (() => void) | null = null) {
    if (timer) clearTimeout(timer);
    const t: Toast = { id: ++seq, msg, undo };
    set(t);
    timer = setTimeout(() => { set(null); timer = null; }, undo ? DURATION_UNDO_MS : DURATION_MS);
  }

  return {
    subscribe,
    show,
    // Toast z gumbom Razveljavi — po kliku se akcija povrne in toast takoj izgine.
    showUndo(msg: string, undo: () => void) { show(msg, undo); },
    dismiss() {
      if (timer) { clearTimeout(timer); timer = null; }
      set(null);
    },
  };
}

export const toast = make();
