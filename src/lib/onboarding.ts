// Vodič za nove uporabnike: pozdravne kartice ob prvem zagonu (WelcomeModal) in
// en kratek namig na zaslon ob prvem obisku (Hint). Obnovi se v Nastavitvah.
import { derived, writable } from 'svelte/store';

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

// Obstoječi uporabniki vodiča ob posodobitvi ne dobijo — aplikacijo že poznajo,
// pozdrav bi jih samo zmotil. Oznako nastavi index.html pred nalaganjem modulov.
function isReturningUser(): boolean {
  return (window as any).__mmReturning === true;
}

const hadOnboardingKey = (() => {
  try { return localStorage.getItem('mm.onboardingDone.v1') !== null; } catch { return true; }
})();

export const onboardingDone = persisted<boolean>(
  'mm.onboardingDone.v1',
  hadOnboardingKey ? false : isReturningUser(),
);

export type HintId = 'home.stop' | 'map.pin' | 'stop.fav';
export const hintsSeen = persisted<Partial<Record<HintId, true>>>('mm.hintsSeen.v1', {});

export function dismissHint(id: HintId) {
  hintsSeen.update(h => ({ ...h, [id]: true }));
}

// Namig se pokaže šele po pozdravu — sicer bi se ob prvem zagonu oboje prekrivalo.
export const hintVisible = derived([onboardingDone, hintsSeen], ([done, seen]) =>
  (id: HintId) => done && !seen[id]);

export function restartOnboarding() {
  hintsSeen.set({});
  onboardingDone.set(false);
}
