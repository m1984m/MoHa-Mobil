import { writable } from 'svelte/store';

// Shortcut na vozni red za (postaja, linija, smer). Drži hiter dostop v Priljubljenih —
// uporabnik pripne kombinacijo iz StopTimetableModal/MapScreen prihodov in jo tapne
// naravnost do filtriranega voznega reda za to postajo+linijo.

export type FavLine = {
  stopId: number;
  routeId: number;
  dir: number;
  // Shranjeni label-i so snapshot ob času pripenjanja — če GTFS preimenuje postajo/linijo,
  // se chipi še vedno pravilno izrišejo (resolveanje id-jev gre preko GTFS).
  stopName: string;
  routeShort: string;
  headsign: string;
};

const KEY = 'mm.favLines.v1';

function load(): FavLine[] {
  try {
    const s = localStorage.getItem(KEY);
    if (!s) return [];
    const arr = JSON.parse(s);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x: any): x is FavLine =>
      x && typeof x.stopId === 'number' && typeof x.routeId === 'number' && typeof x.dir === 'number');
  } catch { return []; }
}

function save(list: FavLine[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
}

function make() {
  const { subscribe, update, set } = writable<FavLine[]>(load());
  const id = (x: FavLine) => `${x.stopId}:${x.routeId}:${x.dir}`;
  return {
    subscribe,
    toggle(x: FavLine) {
      update(list => {
        const k = id(x);
        const next = list.some(i => id(i) === k)
          ? list.filter(i => id(i) !== k)
          : [...list, x];
        save(next);
        return next;
      });
    },
    remove(stopId: number, routeId: number, dir: number) {
      update(list => {
        const next = list.filter(i => !(i.stopId === stopId && i.routeId === routeId && i.dir === dir));
        save(next);
        return next;
      });
    },
    has(stopId: number, routeId: number, dir: number): boolean {
      let ok = false;
      subscribe(list => { ok = list.some(i => i.stopId === stopId && i.routeId === routeId && i.dir === dir); })();
      return ok;
    },
    forStop(stopId: number): FavLine[] {
      let out: FavLine[] = [];
      subscribe(list => { out = list.filter(i => i.stopId === stopId); })();
      return out;
    },
    clear() { set([]); save([]); },
  };
}

export const favLines = make();
