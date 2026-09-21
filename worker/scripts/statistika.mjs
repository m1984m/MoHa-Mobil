#!/usr/bin/env node
/**
 * Izpiše, kar je v Workers Analytics Engine — brez nadzorne plošče, s SQL.
 *
 * Uporaba:
 *   CF_ACCOUNT_ID=... CF_API_TOKEN=... node scripts/statistika.mjs [dni]
 * ali (priporočeno) vrednosti v worker/secrets/analytics.json (ta mapa je v
 * .gitignore):
 *   { "accountId": "...", "apiToken": "..." }
 *
 * Žeton narediš na dash.cloudflare.com → My Profile → API Tokens → Create
 * Token → Custom token, z eno samo pravico **Account · Account Analytics ·
 * Read**. Več mu ni treba; z njim se ne da ničesar spremeniti.
 *
 * Zakaj SQL in ne plošča: Analytics Engine plošče nima. Za stalno gledanje
 * obstaja Counterscale (odprtokoden, teče na istem računu), to pa je najkrajša
 * pot do odgovora »koliko ljudi to sploh uporablja«.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const NABOR = 'moha_mobil';
const dni = Number(process.argv[2] ?? 7);

async function poverilnice() {
  let accountId = process.env.CF_ACCOUNT_ID;
  let apiToken = process.env.CF_API_TOKEN;
  if (!accountId || !apiToken) {
    try {
      const s = JSON.parse(await readFile(resolve(here, '../secrets/analytics.json'), 'utf8'));
      accountId ||= s.accountId;
      apiToken ||= s.apiToken;
    } catch {
      // datoteke ni — ostane samo okolje
    }
  }
  if (!accountId || !apiToken) {
    console.error('Manjka CF_ACCOUNT_ID ali CF_API_TOKEN (ali worker/secrets/analytics.json).');
    console.error('Žeton: dash.cloudflare.com → My Profile → API Tokens → Custom token → Account Analytics: Read.');
    process.exit(2);
  }
  return { accountId, apiToken };
}

async function sql(poizvedba, { accountId, apiToken }) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiToken}` },
    body: poizvedba,
  });
  const besedilo = await res.text();
  if (!res.ok) throw new Error(`SQL ${res.status}: ${besedilo.slice(0, 300)}`);
  try {
    return JSON.parse(besedilo).data ?? [];
  } catch {
    throw new Error('Odgovor ni JSON: ' + besedilo.slice(0, 200));
  }
}

function tabela(naslov, vrstice, stolpci) {
  console.log('\n— ' + naslov + ' ' + '—'.repeat(Math.max(0, 58 - naslov.length)));
  if (vrstice.length === 0) { console.log('  (ni podatkov)'); return; }
  const sirine = stolpci.map(c => Math.max(c.naslov.length, ...vrstice.map(v => String(v[c.polje] ?? '').length)));
  console.log('  ' + stolpci.map((c, i) => c.naslov.padEnd(sirine[i])).join('  '));
  for (const v of vrstice) {
    console.log('  ' + stolpci.map((c, i) => String(v[c.polje] ?? '').padEnd(sirine[i])).join('  '));
  }
}

const p = await poverilnice();
const OD = `timestamp > NOW() - INTERVAL '${dni}' DAY`;

// blob1 = vir ('srv'|'app'), blob2 = dogodek, blob3.. = razsežnosti (glej analytics.js)
const zagoni = await sql(`
  SELECT blob3 AS nacin, blob4 AS razlicica, blob5 AS tema, blob6 AS starejsi, SUM(_sample_interval) AS n
  FROM ${NABOR} WHERE blob1 = 'app' AND blob2 = 'zagon' AND ${OD}
  GROUP BY nacin, razlicica, tema, starejsi ORDER BY n DESC FORMAT JSON`, p);

const zavihki = await sql(`
  SELECT blob3 AS zavihek, SUM(_sample_interval) AS n
  FROM ${NABOR} WHERE blob1 = 'app' AND blob2 = 'zavihek' AND ${OD}
  GROUP BY zavihek ORDER BY n DESC FORMAT JSON`, p);

const filter = await sql(`
  SELECT blob3 AS smer, SUM(_sample_interval) AS n
  FROM ${NABOR} WHERE blob1 = 'app' AND blob2 = 'filter' AND ${OD}
  GROUP BY smer ORDER BY n DESC FORMAT JSON`, p);

const namestitev = await sql(`
  SELECT blob3 AS korak, SUM(_sample_interval) AS n
  FROM ${NABOR} WHERE blob1 = 'app' AND blob2 = 'namestitev' AND ${OD}
  GROUP BY korak ORDER BY n DESC FORMAT JSON`, p);

// toStartOfInterval in quantileExactWeighted sta v seznamu podprtih funkcij
// Analytics Engine; toDate in quantileWeighted(0.5)(...) nista zanesljiva.
const zaledje = await sql(`
  SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS dan, blob2 AS storitev, blob4 AS izid,
         SUM(_sample_interval) AS n,
         quantileExactWeighted(0.5)(double1, _sample_interval) AS ms_p50
  FROM ${NABOR} WHERE blob1 = 'srv' AND ${OD}
  GROUP BY dan, storitev, izid ORDER BY dan DESC, n DESC FORMAT JSON`, p);

console.log(`MoHa Mobil — statistika zadnjih ${dni} dni`);
tabela('Zagoni', zagoni, [
  { naslov: 'nacin', polje: 'nacin' }, { naslov: 'razlicica', polje: 'razlicica' },
  { naslov: 'tema', polje: 'tema' }, { naslov: 'starejsi', polje: 'starejsi' }, { naslov: 'n', polje: 'n' },
]);
tabela('Zavihki', zavihki, [{ naslov: 'zavihek', polje: 'zavihek' }, { naslov: 'n', polje: 'n' }]);
tabela('Filter smeri', filter, [{ naslov: 'smer', polje: 'smer' }, { naslov: 'n', polje: 'n' }]);
tabela('Namestitev (Android/namizje; iOS teh dogodkov nima)', namestitev, [
  { naslov: 'korak', polje: 'korak' }, { naslov: 'n', polje: 'n' },
]);
tabela('Zaledje po dnevih', zaledje, [
  { naslov: 'dan', polje: 'dan' }, { naslov: 'storitev', polje: 'storitev' },
  { naslov: 'izid', polje: 'izid' }, { naslov: 'n', polje: 'n' }, { naslov: 'ms p50', polje: 'ms_p50' },
]);
console.log('\nHramba je tri mesece. Opozorilo: izid »napaka« ali »nedosegljiv« pri OBA pomeni,');
console.log('da posrednik ali Marprom ne odgovarja — prav to je 16.09.2026 več dni ostalo neopaženo.');
