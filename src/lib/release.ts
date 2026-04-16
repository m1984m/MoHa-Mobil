// Edini vir resnice za različico aplikacije in kratek povzetek novosti.
// Uporablja ga:
//  - SettingsScreen (vrstica Različica + blok Novosti)
//  - UpdateToast (prompt ob zaznani novi različici iz service worker-ja)
//
// Pravilo: UI "Novosti" ima največ 4 bullete. Polna zgodovina živi v /CHANGELOG.md.

export const APP_VERSION = '0.4.0';
export const RELEASE_DATE = 'april 2026';

export const RELEASE_NOTES: readonly string[] = [
  'Dostopnost: temi Visoki kontrast in Črno-belo; privzeto svetla',
  'Napisi cest vidnejši — satelit z imeni in 3 velikosti',
  'Odhodi: minute / ura / oboje; kompakten seznam',
  'Vozni redi linije: zvezdica ob postaji za pripenjanje',
];
