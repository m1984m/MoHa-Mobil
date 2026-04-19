// Edini vir resnice za različico aplikacije in kratek povzetek novosti.
// Uporablja ga:
//  - SettingsScreen (vrstica Različica + blok Novosti)
//  - UpdateToast (prompt ob zaznani novi različici iz service worker-ja)
//
// Pravilo: UI "Novosti" ima največ 4 bullete. Polna zgodovina živi v /CHANGELOG.md.

export const APP_VERSION = '0.6.2';
export const RELEASE_DATE = 'april 2026';

export const RELEASE_NOTES: readonly string[] = [
  'Krožna linija G3: odpravljen preskok ikone busa mimo postaj — pozicija sedaj sovpada z ETA',
  'Projekcija GPS na traso upošteva zadnji anchor — brez teleporta pri zaključku zanke',
  'Živi bus se match-a samo na trip, ki je strogo v teku — brez skakanja med overlappnimi vozoredi',
  'Popravljen crop trase na loop-closure segmentu — brez risanja vzvratno skozi celo zanko',
];
