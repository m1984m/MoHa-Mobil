// Trase GTFS po linijah za Worker (src/trase.js meri razdaljo po trasi namesto
// po ravni črti). Vhod: public/gtfs/{shapes,trips}.json, izhod: src/trase.json.
//
//   node worker/scripts/build-trase.mjs      (teče samodejno po npm run gtfs / gtfs:oba)
//
// Worker trase vgradi ob objavi, zato je po menjavi voznega reda treba Worker
// objaviti znova (cd worker && npx wrangler deploy). Do takrat štetje dela naprej:
// kar se ne ujema s staro traso, se šteje po ravni črti.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KOREN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GTFS = path.join(KOREN, 'public', 'gtfs');
const IZHOD = path.join(KOREN, 'worker', 'src', 'trase.json');

const shapes = JSON.parse(fs.readFileSync(path.join(GTFS, 'shapes.json'), 'utf8'));
const trips = JSON.parse(fs.readFileSync(path.join(GTFS, 'trips.json'), 'utf8'));

// route_id (= OBA LineId) -> množica shape_id
const poLiniji = new Map();
for (const t of trips) {
  if (t.route == null || t.shape == null) continue;
  if (!poLiniji.has(t.route)) poLiniji.set(t.route, new Set());
  poLiniji.get(t.route).add(t.shape);
}

const indeks = new Map();
const trase = [];
for (const s of shapes) {
  if (!Array.isArray(s.pts) || s.pts.length < 2) continue;
  indeks.set(s.id, trase.length);
  // 5 decimalk ≈ 1 m; ravna tabela [lat, lon, lat, lon, …] je za polovico manjša.
  trase.push({ id: s.id, t: s.pts.flatMap(([lat, lon]) => [+lat.toFixed(5), +lon.toFixed(5)]) });
}

const linije = {};
for (const [route, ids] of [...poLiniji].sort((a, b) => a[0] - b[0])) {
  const ix = [...ids].map(id => indeks.get(id)).filter(i => i != null);
  if (ix.length) linije[route] = ix;
}

const meta = JSON.parse(fs.readFileSync(path.join(GTFS, 'meta.json'), 'utf8'));
fs.writeFileSync(IZHOD, JSON.stringify({ gtfs: meta.built ?? '', linije, trase }));
const tock = trase.reduce((a, t) => a + t.t.length / 2, 0);
console.log(`[build-trase] ${Object.keys(linije).length} linij, ${trase.length} tras, ${tock} točk -> ${path.relative(KOREN, IZHOD)} (${Math.round(fs.statSync(IZHOD).size / 1024)} kB)`);
console.log('[build-trase] Worker objavi znova: cd worker && npx wrangler deploy');
