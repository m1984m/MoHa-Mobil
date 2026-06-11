import { writable } from 'svelte/store';

export type SavedPlace = { lat: number; lon: number; name: string };
export type SavedRoute = {
  id: string;
  label: string;     // "Dom → Služba"
  from: SavedPlace;
  to: SavedPlace;
  createdAt: number;
};

const KEY = 'mm.savedRoutes.v1';

// Schema guard: pokvarjen element (ročna manipulacija, bodoča sprememba sheme)
// bi sicer sesul render PlannerModal/MapScreen ob prvem branju r.from.name.
function okPlace(p: any): p is SavedPlace {
  return !!p && typeof p.name === 'string' && Number.isFinite(p.lat) && Number.isFinite(p.lon);
}

function load(): SavedRoute[] {
  try {
    const s = localStorage.getItem(KEY);
    if (!s) return [];
    const arr = JSON.parse(s);
    if (!Array.isArray(arr)) return [];
    return arr.filter((r: any) => r && typeof r.id === 'string' && okPlace(r.from) && okPlace(r.to));
  } catch { return []; }
}

function save(routes: SavedRoute[]) {
  try { localStorage.setItem(KEY, JSON.stringify(routes)); } catch {}
}

function genId(): string {
  try {
    const c: any = (globalThis as any).crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  } catch {}
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function create() {
  const { subscribe, update, set } = writable<SavedRoute[]>(load());
  return {
    subscribe,
    add(r: Omit<SavedRoute, 'id' | 'createdAt'>) {
      update(list => {
        const next = [...list, { ...r, id: genId(), createdAt: Date.now() }];
        save(next);
        return next;
      });
    },
    remove(id: string) {
      update(list => {
        const next = list.filter(r => r.id !== id);
        save(next);
        return next;
      });
    },
    rename(id: string, label: string) {
      update(list => {
        const next = list.map(r => r.id === id ? { ...r, label } : r);
        save(next);
        return next;
      });
    },
    clear() { set([]); save([]); },
  };
}

export const savedRoutes = create();
