// node --test scripts/test-krozna.mjs
// Krožne linije: »prek« z rodilnikom. Slovar se primerja z naloženim voznim redom —
// preverba pade, ko nov vozni red prinese ime, ki ga slovar ne pozna (takrat bi
// aplikacija pokazala daljšo obliko »Krožna, prek postajališča …«).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prekRodilnik } from '../src/lib/krozna.ts';

const beri = (ime) => JSON.parse(readFileSync(new URL(`../public/gtfs/${ime}.json`, import.meta.url), 'utf8'));
// Ista meja delov kot HEADSIGN_SEP v src/lib/gtfs.ts.
const LOCILO = /\s+[-–—]\s*|\s*[-–—]\s+/;

test('prekRodilnik: znana imena, velikost črk in presledki', () => {
  assert.equal(prekRodilnik('Tezno'), 'Tezna');
  assert.equal(prekRodilnik('Gosposvetska'), 'Gosposvetske');
  assert.equal(prekRodilnik('Ptujska'), 'Ptujske');
  assert.equal(prekRodilnik('  TEZNO '), 'Tezna');
  assert.equal(prekRodilnik('Pobrežje'), 'Pobrežja');
  assert.equal(prekRodilnik('Tabor'), 'Tabora');
});

test('prekRodilnik: neznano ime vrne null (klicatelj sestavi obliko brez sklona)', () => {
  assert.equal(prekRodilnik('Studenci'), null);
  assert.equal(prekRodilnik('ŽP Maribor'), null);
  assert.equal(prekRodilnik(''), null);
  assert.equal(prekRodilnik(undefined), null);
});

test('vozni red: vsak drugi del opisa krožne linije je v slovarju', () => {
  const stops = new Map(beri('stops').map(s => [s.id, s.name.trim().toLowerCase()]));
  const trips = beri('trips');
  // Krožna linija kot v isCircularRoute: večina voženj se konča na postajališču z imenom, s katerim se začne.
  const stetje = new Map();
  for (const t of trips) {
    const a = t.stops[0], b = t.stops[t.stops.length - 1];
    if (!a || !b) continue;
    const c = stetje.get(t.short) ?? { vseh: 0, krog: 0, opisi: new Set() };
    c.vseh++;
    if (stops.get(a[0]) === stops.get(b[0])) c.krog++;
    c.opisi.add(t.headsign);
    stetje.set(t.short, c);
  }
  const krozne = [...stetje].filter(([, c]) => c.krog * 2 > c.vseh);
  assert.ok(krozne.length >= 1, 'v voznem redu ni nobene krožne linije');
  for (const [linija, c] of krozne) {
    for (const opis of c.opisi) {
      const deli = opis.split(LOCILO).map(p => p.trim()).filter(Boolean);
      if (deli.length < 2) continue;
      assert.ok(prekRodilnik(deli[1]), `linija ${linija}: »${deli[1]}« iz opisa »${opis}« ni v slovarju src/lib/krozna.ts`);
    }
  }
});
