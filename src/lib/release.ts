// Edini vir resnice za različico aplikacije in kratek povzetek novosti.
// Uporablja ga:
//  - SettingsScreen (vrstica Različica + blok Novosti)
//  - UpdateToast (prompt ob zaznani novi različici iz service worker-ja)
//
// Pravilo: UI "Novosti" ima največ 4 bullete. Polna zgodovina živi v /CHANGELOG.md.

// Verzija pride iz package.json prek vite define (__APP_VERSION__) — en sam
// vir resnice; prej so se package.json, release.ts in sw.js verzije razhajale.
export const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
export const RELEASE_DATE = '16. 9. 2026';

export const RELEASE_NOTES: readonly string[] = [
  'Opomniki za odhod: obvestilo nekaj minut pred odhodom pripete linije',
  'Opozorilo, ko se vozni red izteka in opomniki ne bodo več zvonili',
  'Opomnik ni sistemska budilka — v načinu Ne moti ne bo zvonil',
  'Brisanje vseh podatkov zdaj odjavi tudi obvestila',
];
