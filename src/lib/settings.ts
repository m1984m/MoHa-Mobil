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

// Na Dom zavihku prikazi "Najbližja postajališča" (poleg priljubljenih).
export const homeShowNearby = persisted<boolean>('mm.homeShowNearby.v1', true);

// Na Dom zavihku prikazi "Priljubljena postajališča".
export const homeShowFavs = persisted<boolean>('mm.homeShowFavs.v1', true);

// Tip zemljevida
export type MapStyleKind = 'map' | 'satellite';
export const mapStyleKind = persisted<MapStyleKind>('mm.mapStyleKind.v1', 'map');

// Hitrost hoje v km/h — vpliva na pešpoti v načrtovalniku
export const walkSpeedKmh = persisted<number>('mm.walkSpeedKmh.v1', 4);

// Trenutna vrednost v m/s za sinhroni dostop (planner, routing)
let _walkMps = 4 * 1000 / 3600;
walkSpeedKmh.subscribe(v => { _walkMps = (v || 4) * 1000 / 3600; });
export function getWalkMps(): number { return _walkMps; }

// Privzeti zavihek ob zagonu aplikacije (prvi vstop v seji).
export type DefaultTab = 'home' | 'timetables' | 'map' | 'fav';
export const defaultTab = persisted<DefaultTab>('mm.defaultTab.v1', 'home');

// Radij iskanja bližnjih postajališč na Dom zavihku (v metrih).
export const nearbyRadiusM = persisted<number>('mm.nearbyRadiusM.v1', 500);

// Način prikaza odhoda: samo minute do odhoda, samo ura odhoda, ali oboje.
export type DepartureDisplay = 'minutes' | 'clock' | 'both';
export const departureDisplay = persisted<DepartureDisplay>('mm.departureDisplay.v1', 'minutes');

// Kompaktni seznami — manjše višine vrstic, več vsebine na ekran.
export const compactLists = persisted<boolean>('mm.compactLists.v1', false);

// Velikost napisov na zemljevidu (imena cest, postaj). Faktor pomnožimo s privzeto
// text-size definicijo stila.
export type MapLabelSize = 'small' | 'medium' | 'large';
export const mapLabelSize = persisted<MapLabelSize>('mm.mapLabelSize.v1', 'medium');
export function mapLabelFactor(v: MapLabelSize, kind: 'map' | 'satellite'): number {
  // Base faktor se razlikuje glede na podlago: na satelitu so napisi bolj pomembni (slabši kontrast).
  const base = kind === 'satellite' ? 1.4 : 1.3;
  if (v === 'small')  return base * 1.25;
  if (v === 'medium') return base * 1.5;
  if (v === 'large')  return base * 1.8;
  return base;
}
