#!/usr/bin/env node
/**
 * Izpiše ali izbriše projekte na Deno Deploy prek uradnega API-ja
 * (https://api.deno.com/v1). Žetona nikoli ne izpiše.
 *
 * Uporaba:
 *   node pocisti-projekt.mjs                    # samo izpis projektov
 *   node pocisti-projekt.mjs --izbrisi moha-oba # izbris imenovanega projekta
 *
 * Žeton: console.deno.com → Settings → Access Tokens → New Token.
 * Shrani ga v `relay/.deno-token` (mapa je v .gitignore) ali podaj prek
 * spremenljivke okolja DENO_DEPLOY_TOKEN.
 *
 * POZOR na dve generaciji Deno Deploya:
 *   - stari "classic" (dash.deno.com, domene *.deno.dev) — žetoni `ddp_…`,
 *   - novi (console.deno.com, domene *.deno.net) — API api.deno.com/v1.
 * Naš posrednik je tekel na NOVEM (moha-oba.m1984m.deno.net), zato star žeton
 * iz `.deno-token` tu ne deluje (vrne 401 invalidToken).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

function zeton() {
  if (process.env.DENO_DEPLOY_TOKEN) return process.env.DENO_DEPLOY_TOKEN.trim();
  try {
    return readFileSync(resolve(here, '.deno-token'), 'utf8').trim();
  } catch {
    console.error('Ni žetona: nastavi DENO_DEPLOY_TOKEN ali zapiši relay/.deno-token');
    console.error('Nov žeton: console.deno.com → Settings → Access Tokens.');
    process.exit(2);
  }
}

const TOK = zeton();
const H = { Authorization: 'Bearer ' + TOK, 'Content-Type': 'application/json' };

async function api(pot, init = {}) {
  const r = await fetch('https://api.deno.com/v1' + pot, { ...init, headers: { ...H, ...(init.headers || {}) } });
  const t = await r.text();
  let b = null;
  try { b = t ? JSON.parse(t) : null; } catch { b = t.slice(0, 300); }
  return { status: r.status, body: b };
}

const args = process.argv.slice(2);
const zaBrisanje = args.includes('--izbrisi') ? args[args.indexOf('--izbrisi') + 1] : null;

const org = await api('/organizations');
if (org.status !== 200) {
  console.error('Napaka pri branju organizacij:', org.status, JSON.stringify(org.body).slice(0, 200));
  if (org.status === 401) console.error('Žeton je neveljaven ali preklican — naredi novega na console.deno.com.');
  process.exit(1);
}
const orgs = Array.isArray(org.body) ? org.body : [org.body];

let najden = null;
for (const o of orgs) {
  const p = await api(`/organizations/${o.id}/projects`);
  if (p.status !== 200) { console.error(' napaka pri', o.id, p.status); continue; }
  console.log(`\nOrganizacija ${o.name ?? '(osebna)'}:`);
  for (const pr of (p.body ?? [])) {
    console.log(`  - ${pr.name}  (id ${pr.id})`);
    if (zaBrisanje && pr.name === zaBrisanje) najden = pr;
  }
}

if (!zaBrisanje) {
  console.log('\n(za izbris: node pocisti-projekt.mjs --izbrisi <ime>)');
  process.exit(0);
}
if (!najden) {
  console.error(`\nProjekta "${zaBrisanje}" ni med projekti tega žetona.`);
  process.exit(1);
}

const res = await api(`/projects/${najden.id}`, { method: 'DELETE' });
if (res.status === 200 || res.status === 204) {
  console.log(`\nIzbrisano: ${najden.name} (id ${najden.id}).`);
} else {
  console.error(`\nIzbris ni uspel: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  process.exit(1);
}
