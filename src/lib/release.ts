// Edini vir resnice za različico aplikacije in kratek povzetek novosti.
// Uporablja ga:
//  - SettingsScreen (vrstica Različica + blok Novosti)
//  - UpdateToast (prompt ob zaznani novi različici iz service worker-ja)
//
// Pravilo: UI "Novosti" ima največ 4 bullete. Polna zgodovina živi v /CHANGELOG.md.

export const APP_VERSION = '0.7.4';
export const RELEASE_DATE = 'april 2026';

export const RELEASE_NOTES: readonly string[] = [
  'Bus → klik na naslednjo postajo te tja pelje',
  'Linija → "Odpri postajo" skoči na postajni pogled',
  'Postaja → klik na linijo odpre njen vozni red',
  'Vse je medsebojno povezano — brez slepih ulic',
];
