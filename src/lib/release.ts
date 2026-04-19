// Edini vir resnice za različico aplikacije in kratek povzetek novosti.
// Uporablja ga:
//  - SettingsScreen (vrstica Različica + blok Novosti)
//  - UpdateToast (prompt ob zaznani novi različici iz service worker-ja)
//
// Pravilo: UI "Novosti" ima največ 4 bullete. Polna zgodovina živi v /CHANGELOG.md.

export const APP_VERSION = '0.6.1';
export const RELEASE_DATE = 'april 2026';

export const RELEASE_NOTES: readonly string[] = [
  'Pin mode zdaj ima dva koraka: tap pin FAB → pokaže se križ, tap "Potrdi tukaj" → postavi cilj',
  'Pin gre natanko na izbrano lokacijo — ne skoči več na najbližjo postajo',
  'Imena postaj se izpišejo pri približanem pogledu (zoom 15+)',
  'iPhone PWA: odpravljena prazna lisa spodaj ob prvem zagonu — brez rotacije za full screen',
];
