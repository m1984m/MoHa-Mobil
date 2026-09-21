// Edini vir resnice za različico aplikacije in kratek povzetek novosti.
// Uporablja ga:
//  - SettingsScreen (vrstica Različica + blok Novosti)
//  - UpdateToast (prompt ob zaznani novi različici iz service worker-ja)
//
// Pravilo: UI "Novosti" ima največ 4 bullete. Polna zgodovina živi v /CHANGELOG.md.

// Verzija pride iz package.json prek vite define (__APP_VERSION__) — en sam
// vir resnice; prej so se package.json, release.ts in sw.js verzije razhajale.
export const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
export const RELEASE_DATE = '22. 9. 2026';

export const RELEASE_NOTES: readonly string[] = [
  'Za uporabnika se ne spremeni nič — ta različica doda orodje za razvijalca',
  'Anonimno štetje uporabe lahko še vedno izklopiš v Nastavitvah pod »Podatki«',
];
