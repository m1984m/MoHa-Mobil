/**
 * Razdalja po trasi linije (GTFS shapes) namesto po ravni črti.
 *
 * Trase so cestna pot, po kateri linija vozi, zato je razdalja med dvema
 * položajema vzdolž trase boljša ocena prevoženega kot ravna črta — v ovinkih in
 * čez vrzeli v podatkih (izpad posrednika, vozilo za minuto izgine iz OBA).
 * Celotno cestno omrežje (OSM) tu ni potrebno: šteje se samo vožnja na liniji,
 * ta pa je po definiciji na trasi. Kar se s traso ne ujema (obvoz, garaža,
 * zamenjana linija), ostane ravna črta (spremljanje.js).
 *
 * Podatki: src/trase.json (worker/scripts/build-trase.mjs iz public/gtfs).
 * Indeks se zgradi enkrat ob zagonu izolata: ~22.000 točk v mrežo celic 200 m,
 * nato je iskanje bližnjih odsekov nekaj deset primerjav na točko.
 */

import podatki from './trase.json' with { type: 'json' };

// Krajevna ravninska projekcija okoli Maribora (napaka < 0,1 % na območju MOM).
const LAT0 = 46.55, LON0 = 15.65;
const KY = 111_195;                                  // m na stopinjo širine
const KX = KY * Math.cos(LAT0 * Math.PI / 180);      // m na stopinjo dolžine
const xy = (lat, lon) => [(lon - LON0) * KX, (lat - LAT0) * KY];

// Položaj dlje od trase od tega ne šteje kot »na trasi« (GPS + risanje trase).
export const NAJVEC_ODMIK_M = 40;
const CELICA_M = 200;
// Številski ključ celice (hitrejši od niza): območje MOM je daleč pod ±50.000 celic.
const kljucC = (cx, cy) => (cx + 50_000) * 100_000 + (cy + 50_000);
const kljuc = (x, y) => kljucC(Math.floor(x / CELICA_M), Math.floor(y / CELICA_M));

function zgradi(p) {
  const trase = p.trase.map(({ t }) => {
    const n = t.length / 2;
    const x = new Float64Array(n), y = new Float64Array(n), s = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      [x[i], y[i]] = xy(t[2 * i], t[2 * i + 1]);
      if (i) s[i] = s[i - 1] + Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]);
    }
    // Krožna linija (G3): konec je do 60 m od začetka; ta vrzel se pri prehodu čez
    // konec prišteje, sicer bi bil vsak krog za toliko krajši.
    const vrzel = Math.hypot(x[n - 1] - x[0], y[n - 1] - y[0]);
    const zaprta = vrzel < 60;
    return { x, y, s, n, dolzina: s[n - 1] + (zaprta ? vrzel : 0), zaprta };
  });
  // Celica -> [indeks trase, indeks odseka, …]; odsek gre v vse celice, ki jih
  // pokrije njegov okvir, razširjen za NAJVEC_ODMIK_M.
  const mreza = new Map();
  trase.forEach((tr, ti) => {
    for (let i = 1; i < tr.n; i++) {
      const x0 = Math.min(tr.x[i - 1], tr.x[i]) - NAJVEC_ODMIK_M, x1 = Math.max(tr.x[i - 1], tr.x[i]) + NAJVEC_ODMIK_M;
      const y0 = Math.min(tr.y[i - 1], tr.y[i]) - NAJVEC_ODMIK_M, y1 = Math.max(tr.y[i - 1], tr.y[i]) + NAJVEC_ODMIK_M;
      for (let cx = Math.floor(x0 / CELICA_M); cx <= Math.floor(x1 / CELICA_M); cx++) {
        for (let cy = Math.floor(y0 / CELICA_M); cy <= Math.floor(y1 / CELICA_M); cy++) {
          const k = kljucC(cx, cy);
          let a = mreza.get(k);
          if (!a) mreza.set(k, a = []);
          a.push(ti, i);
        }
      }
    }
  });
  const linije = new Map(Object.entries(p.linije).map(([l, ix]) => [Number(l), new Set(ix)]));
  return { trase, mreza, linije };
}

// Indeks se zgradi ob nalaganju modula: ta čas šteje v zagon Workerja (meja 1 s),
// ne v čas procesorja klica, kjer ima brezplačni paket samo 10 ms. Izmerjeno
// 19.10.2026: gradnja ob prvem klicu je stala ~14 ms in bi na hladnem izolatu
// lahko prekinila cel cron (tudi opomnike).
const indeks = zgradi(podatki);
const dobi = () => indeks;

/** Različica voznega reda, iz katere so trase (meta.json `built`). */
export const RAZLICICA_TRAS = podatki.gtfs;

/**
 * Projekcije točke na trase dane linije: Map indeks trase -> [s, …] (m od
 * začetka trase). Na trasi, ki gre po isti cesti tja in nazaj ali v zanki, je
 * projekcij več; ohranijo se vse, izbira je pri paru točk.
 *
 * Ob vogalu je točka blizu več ZAPOREDNIH odsekov hkrati; od takega zaporedja
 * šteje samo najbližja projekcija. Prej so se ohranile vse in par se je lahko
 * »skrajšal« čez vogal (izmerjeno: 240 m namesto 300 m na G1).
 */
export function projekcije(linija, lat, lon, I = dobi()) {
  const dovoljene = I.linije.get(linija);
  const out = new Map();
  if (!dovoljene) return out;
  const [px, py] = xy(lat, lon);
  const kand = I.mreza.get(kljuc(px, py));
  if (!kand) return out;
  const zadetki = new Map();   // indeks trase -> [[odsek, s, odmik], …]
  for (let k = 0; k < kand.length; k += 2) {
    const ti = kand[k], i = kand[k + 1];
    if (!dovoljene.has(ti)) continue;
    const tr = I.trase[ti];
    const ax = tr.x[i - 1], ay = tr.y[i - 1], dx = tr.x[i] - ax, dy = tr.y[i] - ay;
    const L2 = dx * dx + dy * dy;
    const u = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
    const odmik = Math.hypot(px - (ax + u * dx), py - (ay + u * dy));
    if (odmik > NAJVEC_ODMIK_M) continue;
    if (!zadetki.has(ti)) zadetki.set(ti, []);
    zadetki.get(ti).push([i, tr.s[i - 1] + u * Math.sqrt(L2), odmik]);
  }
  for (const [ti, z] of zadetki) {
    z.sort((a, b) => a[0] - b[0]);
    const s = [];
    let naj = z[0];
    for (let k = 1; k <= z.length; k++) {
      if (k < z.length && z[k][0] === z[k - 1][0] + 1) {
        if (z[k][2] < naj[2]) naj = z[k];
        continue;
      }
      s.push(naj[1]);
      if (k < z.length) naj = z[k];
    }
    out.set(ti, s);
  }
  return out;
}

/**
 * Razdalja od A do B vzdolž trase linije v metrih ali null, kadar obe točki nista
 * na isti trasi ali par nima smiselne poti naprej.
 *
 * Izbere se najkrajši pomik NAPREJ po trasi, ki ni krajši od ravne črte (vozilo
 * ne more priti hitreje kot naravnost; 15 m popusti za šum projekcije). Pri
 * krožni trasi gre pomik lahko čez konec na začetek. Zgornja meja izloči pare,
 * ki bi se »ujemali« šele čez cel krog ali po drugi strani zanke.
 */
export function razdaljaPoTrasi(linija, latA, lonA, latB, lonB, ravna, I = dobi()) {
  if (linija == null) return null;
  const pa = projekcije(linija, latA, lonA, I);
  if (!pa.size) return null;
  const pb = projekcije(linija, latB, lonB, I);
  const najvec = Math.max(ravna * 3, ravna + 500);
  let naj = null;
  for (const [ti, sa] of pa) {
    const sb = pb.get(ti);
    if (!sb) continue;
    const tr = I.trase[ti];
    for (const a of sa) {
      for (const b of sb) {
        let d = b - a;
        if (d < -15 && tr.zaprta) d += tr.dolzina;
        if (d < ravna - 15 || d > najvec) continue;
        const dd = Math.max(d, ravna);
        if (naj === null || dd < naj) naj = dd;
      }
    }
  }
  return naj;
}
