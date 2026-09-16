#!/usr/bin/env node
// Generira public/sw.js iz scripts/sw.template.js. VERSION je pkg.version + short SHA.
// Sproži se iz `predev` in `prebuild` — vsak dev/build dobi svežo verzijo, kar avtomatsko
// invalidira cache pri testerjih brez ročnega bumpanja.

import { readFile, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));

let sha = 'dev';
try {
  sha = execSync('git rev-parse --short=7 HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch {
  // Git ni na voljo ali ni repo-ja — fallback 'dev'.
}

const version = `${pkg.version}-${sha}`;

// Alarmi: SW ne vidi import.meta.env, zato javni ključ VAPID in naslov API-ja
// vstavimo ob gradnji. Vrednosti pridejo iz okolja (npr. `VITE_VAPID_PUBLIC=… npm run build`);
// če ju ni, ostaneta prazna niza in SW obnovitev naročnine tiho preskoči.
// Vite naloži .env šele zase, zato ga tu preberemo sami — sicer bi bil pri navadnem
// `npm run build` SW brez teh vrednosti in obnovitev naročnine ob rotaciji endpointa
// ne bi delovala. Okolje ima prednost pred .env.
async function readDotEnv() {
  const out = {};
  for (const name of ['.env.local', '.env']) {
    let text;
    try {
      text = await readFile(resolve(root, name), 'utf8');
    } catch {
      continue; // datoteke ni — normalno
    }
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) continue; // komentar ali prazna vrstica
      if (out[m[1]] === undefined) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return out;
}

const dotenv = await readDotEnv();
const pick = (key) => (process.env[key] ?? dotenv[key] ?? '').trim();

const vapidPublic = pick('VITE_VAPID_PUBLIC');
const alarmApi = pick('VITE_ALARM_API').replace(/\/+$/, '');

const template = await readFile(resolve(here, 'sw.template.js'), 'utf8');
const out = template
  .replace(/__SW_VERSION__/g, version)
  .replace(/__VAPID_PUBLIC__/g, vapidPublic)
  .replace(/__ALARM_API__/g, alarmApi);

await writeFile(resolve(root, 'public', 'sw.js'), out, 'utf8');
console.log(`[build-sw] public/sw.js VERSION=${version} alarmi=${vapidPublic && alarmApi ? 'da' : 'ne (VITE_VAPID_PUBLIC/VITE_ALARM_API nista v okolju)'}`);
