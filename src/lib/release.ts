// Edini vir resnice za različico aplikacije in kratek povzetek novosti.
// Uporablja ga:
//  - SettingsScreen (vrstica Različica + blok Novosti)
//  - UpdateToast (prompt ob zaznani novi različici iz service worker-ja)
//
// Pravilo: UI "Novosti" ima največ 4 bullete. Polna zgodovina živi v /CHANGELOG.md.

export const APP_VERSION = '0.5.3';
export const RELEASE_DATE = 'april 2026';

export const RELEASE_NOTES: readonly string[] = [
  'Planer ne predlaga več poti, ki so počasnejše od direktne hoje',
  'Dolg pritisk na mapo zdaj deluje na iPhonu (native touch eventi, ne MapLibre)',
  'Realnejši čas pešhoje v planerju — urbani ovinki (1.35×), ne zračna razdalja',
];
