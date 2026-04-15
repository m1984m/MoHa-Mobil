import { writable } from 'svelte/store';

function persisted<T>(key: string, fallback: T) {
  let initial = fallback;
  try {
    const s = localStorage.getItem(key);
    if (s !== null) initial = JSON.parse(s);
  } catch {}
  const store = writable<T>(initial);
  store.subscribe(v => {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch {}
  });
  return store;
}

// V načrtovalniku poti kot prvo prikazi priljubljene postaje.
export const plannerShowFavs = persisted<boolean>('mm.plannerShowFavs.v1', true);

// Tip zemljevida
export type MapStyleKind = 'map' | 'satellite';
export const mapStyleKind = persisted<MapStyleKind>('mm.mapStyleKind.v1', 'map');

// Hitrost hoje v km/h — vpliva na pešpoti v načrtovalniku
export const walkSpeedKmh = persisted<number>('mm.walkSpeedKmh.v1', 4);

// Trenutna vrednost v m/s za sinhroni dostop (planner, routing)
let _walkMps = 4 * 1000 / 3600;
walkSpeedKmh.subscribe(v => { _walkMps = (v || 4) * 1000 / 3600; });
export function getWalkMps(): number { return _walkMps; }
