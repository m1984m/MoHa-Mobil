import { readable } from 'svelte/store';

// Ali ima naprava povezavo. Ločuje »brez povezave« od »strežnik ne odgovarja«:
// karta je prej napisala »Offline«, tudi ko je bil telefon na spletu in je padel
// samo vir živih podatkov (evalvacija 04.10.2026, N3).
export const online = readable(typeof navigator === 'undefined' ? true : navigator.onLine, (set) => {
  // Ob vsaki ponovni naročnini preberi trenutno stanje — readable sicer vrne
  // vrednost od zadnjič, ko je imel naročnika (menjava zavihka vmes; pregled 05.10.).
  set(navigator.onLine);
  const up = () => set(true);
  const down = () => set(false);
  window.addEventListener('online', up);
  window.addEventListener('offline', down);
  return () => {
    window.removeEventListener('online', up);
    window.removeEventListener('offline', down);
  };
});
