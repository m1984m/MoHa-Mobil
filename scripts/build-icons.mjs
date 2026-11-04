// Iz ikon SVG nariše PNG (iOS za apple-touch-icon SVG ne podpira; nekateri
// Androidi in namizni brskalniki v manifestu raje vzamejo PNG).
//   node scripts/build-icons.mjs
// Riše Chrome prek playwright-core (channel 'chrome', paketni chromium ni nameščen).
// apple-touch-icon je iz polne (maskable) ikone brez zaobljenih robov: iOS robove
// zaobli sam, prozorni vogali bi na začetnem zaslonu postali črni.
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const pub = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const jobs = [
  { src: 'icon-maskable.svg', out: 'apple-touch-icon.png', size: 180 },
  { src: 'icon-192.svg', out: 'icon-192.png', size: 192 },
  { src: 'icon-512.svg', out: 'icon-512.png', size: 512 },
  { src: 'icon-maskable.svg', out: 'icon-maskable-512.png', size: 512 },
];

const browser = await chromium.launch({ channel: 'chrome' });
try {
  for (const j of jobs) {
    const svg = await readFile(resolve(pub, j.src), 'utf8');
    const page = await browser.newPage({ viewport: { width: j.size, height: j.size }, deviceScaleFactor: 1 });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">`
      + svg.replace('<svg ', `<svg width="${j.size}" height="${j.size}" `)
      + `</body></html>`,
    );
    await page.screenshot({ path: resolve(pub, j.out), omitBackground: true, clip: { x: 0, y: 0, width: j.size, height: j.size } });
    await page.close();
    console.log(`${j.out} ${j.size}×${j.size}`);
  }
} finally {
  await browser.close();
}
