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

function load(): SavedRoute[] {
  try {
    const s = localStorage.getItem(KEY);
    if (!s) return [];
    const arr = JSON.parse(s);
    return Array.isArray(arr) ? arr : [];
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
