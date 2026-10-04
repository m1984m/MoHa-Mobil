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
export const RELEASE_DATE = '5. 10. 2026';

export const RELEASE_NOTES: readonly string[] = [
  'Pri odhodih je na prvem mestu cilj vožnje, smer na kartici pove, kam avtobus pelje',
  'Ko podatkov v živo ni, Dom to jasno pove; pri vsakem odhodu piše, ali je v živo ali po voznem redu',
  'Načrtovalnik začne pri tvoji lokaciji, ponudi tudi avtobus z manj hoje in najde postajališča brez šumnikov',
  'Bolj berljive oznake linij in stanja, gumb Zapri v slogu aplikacije in natančnejši opis zasebnosti',
];
