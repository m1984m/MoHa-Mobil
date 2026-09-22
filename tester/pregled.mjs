/**
 * Strnjen pregled vseh opravljenih obhodov.
 *
 * Namenjen je človeku ali agentu, ki bo posnetke presojal: na enem mestu pove,
 * kje je stroj kaj našel in katere posnetke je zato vredno pogledati najprej.
 * Celotno besedilo zaslonov je v `izpis.json` in se tu namenoma ne izpisuje —
 * pregled mora ostati kratek, sicer ga nihče ne prebere.
 *
 *   node pregled.mjs            # vsi obhodi
 *   node pregled.mjs zamuda     # samo tisti, katerih oznaka vsebuje »zamuda«
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const tu = dirname(fileURLToPath(import.meta.url));
const koren = resolve(tu, 'posnetki');
const filter = process.argv[2] ?? '';

if (!existsSync(koren)) {
  console.log('Ni še nobenega obhoda. Zaženi: node obhod.mjs');
  process.exit(0);
}

const mape = readdirSync(koren, { withFileTypes: true })
  .filter(d => d.isDirectory() && d.name.includes(filter))
  .map(d => d.name)
  .sort();

let skupaj = { zaslonov: 0, uhajanj: 0, sumljivih: 0, napak: 0 };

for (const m of mape) {
  const pot = resolve(koren, m, 'izpis.json');
  if (!existsSync(pot)) continue;
  const j = JSON.parse(readFileSync(pot, 'utf8'));

  console.log('\n══ ' + m + ' ══');
  console.log('   ' + j.scenarij.opis + '  (prestreženih klicev: ' + j.scenarij.prestrezenihKlicev + ')');

  for (const z of j.zasloni) {
    skupaj.zaslonov++;
    if (z.napaka) { console.log('   ! ' + z.zaslon + ': ' + z.napaka); continue; }

    const opombe = [];
    for (const u of z.uhajanje ?? []) {
      skupaj.uhajanj++;
      const kje = u.cezDesno ? 'sega ' + u.cezDesno + ' px čez desni rob'
                : u.cezLevo ? 'sega ' + u.cezLevo + ' px čez levi rob'
                : 'tiho odrezano';
      opombe.push('       ' + kje + ' — ' + u.kaj + ' » ' + u.besedilo);
    }
    for (const s of z.sumljivo ?? []) {
      skupaj.sumljivih++;
      opombe.push('       sumljiv niz na zaslonu: ' + s);
    }

    const znak = opombe.length ? '●' : '·';
    console.log('   ' + znak + ' ' + z.zaslon.padEnd(14) + z.posnetek);
    opombe.forEach(o => console.log(o));
  }

  for (const n of j.napakeKonzole) {
    skupaj.napak++;
    console.log('   konzola: ' + n.slice(0, 120));
  }
}

console.log('\n── skupaj ──');
console.log('obhodov ' + mape.length + ', zaslonov ' + skupaj.zaslonov
  + ', najdb o postavitvi ' + skupaj.uhajanj
  + ', sumljivih nizov ' + skupaj.sumljivih
  + ', napak v konzoli ' + skupaj.napak);
console.log('\nPosnetke presodi sam: besedilo, dvoumne oznake, nasprotja med podatki na istem zaslonu.');
