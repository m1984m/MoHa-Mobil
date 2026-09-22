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
export const RELEASE_DATE = '22. 9. 2026';

export const RELEASE_NOTES: readonly string[] = [
  'Aplikacija je zdaj tudi v angleščini — jezik izbereš v Nastavitvah',
  'Na Karti so postaje MBajk s prostimi kolesi, ob postajališču pa najbližja postaja',
  'Nov razdelek Cene in vozovnice: cenik Marproma in kje kupiti vozovnico',
  'Kratek vodič ob prvem zagonu in namigi — znova ga odpreš v Nastavitvah',
];
