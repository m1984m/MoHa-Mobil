// Preveri, ali ima vsako besedilo v $t('…') / tr('…') angleški prevod v src/lib/i18n/en/*.ts.
// Izhod 1, če kaj manjka — da se pozabljen prevod ne izmuzne v objavo.
// Uporaba: npm run i18n:check  (z --unused izpiše še prevode, ki jih koda ne uporablja več)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src/', import.meta.url));

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(svelte|ts)$/.test(f)) out.push(p);
  }
  return out;
}

// Niz v enojnih ali dvojnih narekovajih, z ubežnimi znaki.
const STR = String.raw`'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"`;
const CALL = new RegExp(String.raw`(?:\$t|\btr)\(\s*(?:${STR})`, 'g');
const unescape = s => s.replace(/\\(.)/g, '$1');

const files = walk(root);
const dictFiles = files.filter(f => /[\\/]i18n[\\/]en[\\/]/.test(f));
const used = new Map();
for (const f of files) {
  if (dictFiles.includes(f) || /[\\/]lib[\\/]i18n\.ts$/.test(f)) continue;
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(CALL)) {
    const s = unescape(m[1] ?? m[2]);
    if (!used.has(s)) used.set(s, f.slice(root.length));
  }
}

// Dinamični ključi ($t(n) ipd.), ki jih zgornji vzorec ne vidi: nizi v teh tabelah.
const DYNAMIC = [['lib/release.ts', 'RELEASE_NOTES'], ['lib/alarms.ts', 'DAY_SHORT'], ['lib/alarms.ts', 'DAY_IN']];
for (const [f, name] of DYNAMIC) {
  const src = readFileSync(join(root, f), 'utf8');
  const m = src.match(new RegExp(String.raw`\b${name}\b[^=]*=\s*\[([\s\S]*?)\]`));
  if (!m) { console.log(`OPOZORILO  tabele ${name} v ${f} ni mogoče prebrati`); continue; }
  for (const x of m[1].matchAll(new RegExp(STR, 'g'))) {
    const s = unescape(x[1] ?? x[2]);
    if (!used.has(s)) used.set(s, `${f} (${name})`);
  }
}

const keys = new Set();
const KEY = new RegExp(String.raw`^\s*(?:${STR})\s*:`, 'gm');
for (const f of dictFiles) {
  for (const m of readFileSync(f, 'utf8').matchAll(KEY)) keys.add(unescape(m[1] ?? m[2]));
}

const missing = [...used].filter(([s]) => !keys.has(s));
for (const [s, f] of missing) console.log(`MANJKA  ${f}: ${s}`);
if (process.argv.includes('--unused')) {
  for (const k of keys) if (!used.has(k)) console.log(`NEUPORABLJENO  ${k}`);
}
console.log(`\n${used.size} besedil v kodi, ${keys.size} prevodov, manjka ${missing.length}.`);
process.exit(missing.length ? 1 : 0);
