// Edini vir resnice za različico aplikacije in kratek povzetek novosti.
// Uporablja ga:
//  - SettingsScreen (vrstica Različica + blok Novosti)
//  - UpdateToast (prompt ob zaznani novi različici iz service worker-ja)
//
// Pravilo: UI "Novosti" ima največ 4 bullete. Polna zgodovina živi v /CHANGELOG.md.

export const APP_VERSION = '0.5.2';
export const RELEASE_DATE = 'april 2026';

export const RELEASE_NOTES: readonly string[] = [
  'Dolg pritisk na mapo zdaj zares deluje na iPhonu (prej je drag prekinil timer)',
  'Planer več ne predlaga nesmiselnih poti "tja in nazaj" po isti liniji',
  'Vsi predlogi poti so vidni, tudi če jih je več — seznam se pomakne',
  'iOS PWA: odpravljena prazna lisa pod spodnjo vrstico zavihkov',
];
