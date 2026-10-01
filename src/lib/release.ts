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
export const RELEASE_DATE = '1. 10. 2026';

export const RELEASE_NOTES: readonly string[] = [
  'Opomnik v Preprostem pogledu zdaj popraviš z gumbom Popravi, ni ga treba brisati',
  'Pošlji preizkusno obvestilo in kratko navodilo, kako vklopiš zvok obvestil',
  'Pri postajališču vidiš najbližjo postajo mBajk s prostimi kolesi',
  'Na karti postaja mBajk pokaže najbližje avtobusno postajališče in njegove odhode',
];
