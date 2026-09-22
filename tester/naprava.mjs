/**
 * Emulator Androida kot preizkusna naprava.
 *
 * Aplikacijo vodimo v PRAVEM Chromu na Androidu, ne v namizni posnemi telefona.
 * Razlika ni kozmetična: samo tu se pokažejo service worker, varna območja ob
 * robovih, dejanski izris pisav in to, kako se PWA obnaša ob namestitvi.
 *
 * Kako pridemo do nje: Chrome na napravi odpre vtič `chrome_devtools_remote`,
 * `adb forward` ga prestavi na vrata na tem računalniku, Playwright pa se nanj
 * priklopi prek CDP. S tem imamo na pravi napravi vse, kar sicer znamo v
 * Playwrightu — branje besedila, prestrezanje omrežja in posnetke zaslona.
 *
 * Pasti, ki so nas že ujele:
 *   - Vtič se pojavi šele nekaj sekund po zagonu Chroma; prvi klic na 9222 zato
 *     pade. Zato `pocakajNaVtic()` in ne takojšen poskus.
 *   - Slika sistema `google_apis_playstore` je produkcijska: `adb root` ne dela
 *     in `ro.debuggable` je 0. To NI ovira — vtič Chroma je na voljo tudi tam.
 *   - Service worker postreže staro različico aplikacije. Pred vsakim obhodom
 *     ga je treba odjaviti in počistiti predpomnilnike, sicer preizkušaš kodo
 *     izpred nekaj objav.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';

const izvedi = promisify(execFile);

const SDK = process.env.ANDROID_SDK_ROOT || 'D:/Android/Sdk';
const ADB = `${SDK}/platform-tools/adb.exe`;
const EMULATOR = `${SDK}/emulator/emulator.exe`;
const AVD = process.env.MM_AVD || 'medium_phone';
const VRATA = 9222;
const CHROME = 'com.android.chrome/com.google.android.apps.chrome.Main';

const pocakaj = (ms) => new Promise(r => setTimeout(r, ms));

async function adb(...args) {
  const { stdout } = await izvedi(ADB, args, { maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

async function naprava() {
  const izpis = await adb('devices');
  const vrstica = izpis.split('\n').find(v => /^emulator-\d+\s+device/.test(v.trim()));
  return vrstica ? vrstica.trim().split(/\s+/)[0] : null;
}

/** Zažene emulator, če še ne teče, in počaka na konec zagona. */
export async function zagotoviNapravo({ tiho = true } = {}) {
  if (await naprava()) return;

  const otrok = (await import('node:child_process')).spawn(
    EMULATOR,
    ['-avd', AVD, '-no-snapshot-load', '-no-boot-anim', ...(tiho ? ['-no-audio'] : [])],
    { detached: true, stdio: 'ignore' },
  );
  otrok.unref();

  for (let i = 0; i < 60; i++) {
    await pocakaj(5000);
    if (!(await naprava())) continue;
    try {
      const b = await adb('shell', 'getprop', 'sys.boot_completed');
      if (b.trim() === '1') { await pocakaj(3000); return; }
    } catch { /* adb med zagonom vrže, to je normalno */ }
  }
  throw new Error('emulator se ni zagnal v petih minutah');
}

async function pocakajNaVtic() {
  for (let i = 0; i < 20; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${VRATA}/json/version`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return;
    } catch { /* še ni */ }
    await pocakaj(1500);
  }
  throw new Error('Chrome ni odprl vtiča za razhroščevanje');
}

/**
 * Odpre Chrome na danem naslovu in vrne priklopljeno stran.
 * `svez` odjavi service worker in počisti predpomnilnike — brez tega
 * preizkušaš različico, ki je ostala od prejšnjič.
 */
export async function odpri(url, { svez = true } = {}) {
  await zagotoviNapravo();
  await adb('shell', 'am', 'force-stop', 'com.android.chrome');
  await pocakaj(1500);
  await adb('shell', 'am', 'start', '-n', CHROME, '-a', 'android.intent.action.VIEW', '-d', url);

  await adb('forward', '--remove-all').catch(() => {});
  await adb('forward', `tcp:${VRATA}`, 'localabstract:chrome_devtools_remote');
  await pocakajNaVtic();

  const brskalnik = await chromium.connectOverCDP(`http://127.0.0.1:${VRATA}`);
  const kontekst = brskalnik.contexts()[0];
  let stran = kontekst.pages().find(p => p.url().startsWith(url.split('?')[0]))
           ?? kontekst.pages()[0];
  await stran.waitForLoadState('domcontentloaded').catch(() => {});

  if (svez) {
    await stran.evaluate(async () => {
      const r = await navigator.serviceWorker?.getRegistrations?.() ?? [];
      await Promise.all(r.map(x => x.unregister()));
      const k = await caches.keys();
      await Promise.all(k.map(x => caches.delete(x)));
    }).catch(() => {});
    await stran.goto(url, { waitUntil: 'domcontentloaded' });
  }

  return { brskalnik, kontekst, stran, adb };
}

/**
 * Nastavi velikost pogleda v CSS pikslih. Naprava je fizično 1080×2400, zato
 * brez tega vedno preizkušaš eno samo širino — ozki telefoni pa so prav tisti,
 * kjer besedilo uide iz okvirja.
 */
export async function nastaviSirino(stran, sirinaCss, visinaCss = 780) {
  const seja = await stran.context().newCDPSession(stran);
  await seja.send('Emulation.setDeviceMetricsOverride', {
    width: sirinaCss,
    height: visinaCss,
    deviceScaleFactor: 2.625,
    mobile: true,
  });
  return seja;
}

export { adb, pocakaj };
