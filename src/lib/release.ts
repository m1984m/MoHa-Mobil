// Edini vir resnice za različico aplikacije in kratek povzetek novosti.
// Uporablja ga:
//  - SettingsScreen (vrstica Različica + blok Novosti)
//  - UpdateToast (prompt ob zaznani novi različici iz service worker-ja)
//
// Pravilo: UI "Novosti" ima največ 4 bullete. Polna zgodovina živi v /CHANGELOG.md.

export const APP_VERSION = '0.7.0';
export const RELEASE_DATE = 'april 2026';

export const RELEASE_NOTES: readonly string[] = [
  'Sledenje lokaciji v živo — modri pin zdaj drsi po karti, stikalo v Nastavitvah',
  'Gladko premikanje busov (beta, privzeto OFF) — prehod na 30 s poll cikel (prej 8 s)',
  'Datum voznega reda viden na Domačem zaslonu — ni več ugibanja, kako sveži so GTFS podatki',
  'Zanesljivejše live podatke: OBA proxy fallback + hitrejši prvi render karte + 60 % hitrejši match vozil',
];
