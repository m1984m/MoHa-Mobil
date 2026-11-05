// Edini vir resnice za različico aplikacije in kratek povzetek novosti.
// Uporablja ga:
//  - SettingsScreen (vrstica Različica + blok Novosti)
//  - UpdateToast (prompt ob zaznani novi različici iz service worker-ja)
//
// Pravilo: UI "Novosti" ima največ 4 bullete. Polna zgodovina živi v /CHANGELOG.md.
// Vnosi so ključi prevodov: prikaz jih ovije v $t(), angleščina je v i18n/en/settings.ts.
// Ob novem vnosu dodaj tja še prevod (i18n:check ga ne vidi, ker ni dobesedni niz v $t).

// Verzija pride iz package.json prek vite define (__APP_VERSION__) — en sam
// vir resnice; prej so se package.json, release.ts in sw.js verzije razhajale.
export const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
export const RELEASE_DATE = '6. 11. 2026';

export const RELEASE_NOTES: readonly string[] = [
  'Zvonec: opomnik za ta odhod upošteva zamudo in pove, kdaj prvič zazvoni',
  'Načrtovalnik: ura odhoda in »jutri«, delujoč način Bus + vlak, zvečer tudi jutrišnje povezave',
  'Pravilen čas čakanja pri prestopu, »vlak« v navodilih, Priljubljene v živo',
  'Boljša dostopnost (tipkovnica, bralnik zaslona, ležeči položaj) in natančnejša zasebnost',
];
