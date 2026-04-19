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

const template = await readFile(resolve(here, 'sw.template.js'), 'utf8');
const out = template.replace(/__SW_VERSION__/g, version);

await writeFile(resolve(root, 'public', 'sw.js'), out, 'utf8');
console.log(`[build-sw] public/sw.js VERSION=${version}`);
