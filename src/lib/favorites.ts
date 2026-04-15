import { writable } from 'svelte/store';

const KEY = 'mm.favStops.v1';

function load(): number[] {
  try {
    const s = localStorage.getItem(KEY);
    if (!s) return [];
    const arr = JSON.parse(s);
    return Array.isArray(arr) ? arr.filter((x: any) => typeof x === 'number') : [];
  } catch { return []; }
}

function save(ids: number[]) {
  try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch {}
}

function createFavs() {
  const { subscribe, update, set } = writable<Set<number>>(new Set(load()));
  return {
    subscribe,
    toggle(id: number) {
      update(s => {
        const next = new Set(s);
        if (next.has(id)) next.delete(id); else next.add(id);
        save([...next]);
        return next;
      });
    },
    has(id: number): boolean {
      let ok = false;
      subscribe(s => { ok = s.has(id); })();
      return ok;
    },
    clear() { set(new Set()); save([]); },
  };
}

export const favStops = createFavs();
