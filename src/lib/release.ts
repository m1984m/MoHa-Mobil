// Edini vir resnice za različico aplikacije in kratek povzetek novosti.
// Uporablja ga:
//  - SettingsScreen (vrstica Različica + blok Novosti)
//  - UpdateToast (prompt ob zaznani novi različici iz service worker-ja)
//
// Pravilo: UI "Novosti" ima največ 4 bullete. Polna zgodovina živi v /CHANGELOG.md.

// Verzija pride iz package.json prek vite define (__APP_VERSION__) — en sam
// vir resnice; prej so se package.json, release.ts in sw.js verzije razhajale.
export const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
export const RELEASE_DATE = '21. 9. 2026';

export const RELEASE_NOTES: readonly string[] = [
  'Na Domu nova gumba »V center« in »Iz centra« — pokažeta samo postajališča v izbrano smer',
  'Spodnji meni lebdi nad vsebino in je prosojen, tako da se karta pod njim vidi',
  'Kdor ima v telefonu vklopljeno zmanjšano prosojnost, dobi meni brez učinka',
  'Kontrastna in črno-bela tema ostaneta neprosojni',
];
