// Edini vir resnice za različico aplikacije in kratek povzetek novosti.
// Uporablja ga:
//  - SettingsScreen (vrstica Različica + blok Novosti)
//  - UpdateToast (prompt ob zaznani novi različici iz service worker-ja)
//
// Pravilo: UI "Novosti" ima največ 4 bullete. Polna zgodovina živi v /CHANGELOG.md.

export const APP_VERSION = '0.5.0';
export const RELEASE_DATE = 'april 2026';

export const RELEASE_NOTES: readonly string[] = [
  'Hiter načrt poti do postaje — en gumb v panelu postaje, samodejno izračuna',
  'Dolg pritisk na mapo postavi cilj (naslov se samodejno poišče)',
  'Tap na mapo zapre postajo in vrne prejšnji pogled; pinch-zoom vklopljen',
  'Planer znatno hitrejši; retry UI, če voznih redov ni bilo mogoče naložiti',
];
