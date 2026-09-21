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
  'Pot po korakih je zdaj časovnica: zgoraj piše, kdaj moraš kreniti od doma',
  'Pri vsakem avtobusu je jasno, kje vstopiš in kje izstopiš, ter ob kateri uri',
  'Čakanje med prestopi je svoja vrstica — vidiš ga vnaprej',
  'Namesto celega opisa linije je zapisan cilj, vmesne postaje so pod njim',
];
