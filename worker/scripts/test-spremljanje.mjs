// Preverbe logike kilometrov v src/spremljanje.js (brez Cloudflara):
//   node --test scripts/test-spremljanje.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dodajVzorec, vozilaIz, razdaljaM, danLj, uraLj, razcleniPot, zabeleziVozila,
  NAJMANJ_KORAK_M,
} from '../src/spremljanje.js';

// Premik za `m` metrov proti severu (1° geografske širine ≈ 111.195 m).
const sever = (lat, m) => lat + m / 111_195;
const T0 = Date.UTC(2026, 9, 20, 6, 0, 0);
// Brez linije: preverbe ravne črte ne smejo slučajno zadeti prave trase.
const v = (bus, lat, lon, linija = null) => ({ bus, lat, lon, linija });

test('razdalja: 1 km proti severu', () => {
  assert.ok(Math.abs(razdaljaM(46.55, 15.65, sever(46.55, 1000), 15.65) - 1000) < 1);
});

test('vozilaIz: izloči brez številke, zunaj okvira, podvojene in pokvarjeno telo', () => {
  const telo = JSON.stringify({ Vehicles: [
    { BusCode: '153', Lat: 46.55, Lon: 15.65, LineId: 68 },
    { BusCode: '153', Lat: 46.56, Lon: 15.66, LineId: 68 },
    { BusCode: '', Lat: 46.55, Lon: 15.65 },
    { BusCode: '200', Lat: 0, Lon: 0 },
    { BusCode: '201', Lat: '46.54', Lon: '15.64' },
  ] });
  assert.deepEqual(vozilaIz(telo).map(x => x.bus), ['153', '201']);
  assert.deepEqual(vozilaIz('<html>'), []);
  assert.deepEqual(vozilaIz('{"Response":{"Status":-1}}'), []);
});

test('vožnja 300 m na 30 s se prišteje', () => {
  const s = new Map();
  let lat = 46.55;
  dodajVzorec(s, [v('1', lat, 15.65)], T0);
  for (let i = 1; i <= 10; i++) { lat = sever(lat, 300); dodajVzorec(s, [v('1', lat, 15.65)], T0 + i * 30_000); }
  assert.ok(Math.abs(s.get('1').km - 3) < 0.01, s.get('1').km);
  assert.equal(s.get('1').vzorcev, 11);
  assert.equal(s.get('1').nove.length, 11);
});

test('šum GPS stoječega vozila ne nabira kilometrov', () => {
  const s = new Map();
  dodajVzorec(s, [v('1', 46.55, 15.65)], T0);
  for (let i = 1; i <= 120; i++) {
    const m = (i % 2 ? 1 : -1) * (NAJMANJ_KORAK_M - 5);   // skače ±20 m okoli iste točke
    dodajVzorec(s, [v('1', sever(46.55, m), 15.65)], T0 + i * 30_000);
  }
  assert.equal(s.get('1').km, 0);
  assert.equal(s.get('1').nove.length, 1);
});

test('počasna vožnja (10 m na 30 s) se ne izgubi', () => {
  const s = new Map();
  let lat = 46.55;
  dodajVzorec(s, [v('1', lat, 15.65)], T0);
  for (let i = 1; i <= 30; i++) { lat = sever(lat, 10); dodajVzorec(s, [v('1', lat, 15.65)], T0 + i * 30_000); }
  // 300 m skupaj; prišteje se v korakih po ≥25 m, ostanek pod pragom počaka.
  assert.ok(s.get('1').km > 0.27 && s.get('1').km <= 0.3001, s.get('1').km);
});

test('skok položaja (2 km v 30 s) se ne prišteje in prekine pot', () => {
  const s = new Map();
  dodajVzorec(s, [v('1', 46.55, 15.65)], T0);
  dodajVzorec(s, [v('1', sever(46.55, 2000), 15.65)], T0 + 30_000);
  assert.equal(s.get('1').km, 0);
  assert.ok(s.get('1').nove[1].startsWith('!'));
});

test('vrzel nad 5 min se ne prišteje, po dolgem stanju pa se premik šteje', () => {
  const s = new Map();
  dodajVzorec(s, [v('1', 46.55, 15.65)], T0);
  dodajVzorec(s, [v('1', sever(46.55, 1500), 15.65)], T0 + 10 * 60_000);   // 10 min izpada
  assert.equal(s.get('1').km, 0);

  const s2 = new Map();
  dodajVzorec(s2, [v('2', 46.55, 15.65)], T0);
  for (let i = 1; i <= 20; i++) dodajVzorec(s2, [v('2', 46.55, 15.65)], T0 + i * 30_000);  // 10 min na končni
  dodajVzorec(s2, [v('2', sever(46.55, 300), 15.65)], T0 + 21 * 30_000);
  assert.ok(Math.abs(s2.get('2').km - 0.3) < 0.01, s2.get('2').km);
});

test('starejši vzorec ne spremeni novejšega stanja; linije se zbirajo', () => {
  const s = new Map();
  dodajVzorec(s, [v('1', 46.55, 15.65, 67)], T0 + 60_000);
  const sp = dodajVzorec(s, [v('1', sever(46.55, 300), 15.65, 68)], T0);
  assert.equal(sp.size, 0);
  assert.equal(s.get('1').km, 0);
  dodajVzorec(s, [v('1', sever(46.55, 300), 15.65, 68)], T0 + 90_000);
  assert.deepEqual([...s.get('1').linije], [67, 68]);
});

test('dan in ura po ljubljanskem času, tudi ob premiku ure 25.10.2026', () => {
  assert.equal(danLj(Date.UTC(2026, 9, 19, 22, 30)), '2026-10-20');   // 00:30 CEST
  assert.equal(danLj(Date.UTC(2026, 9, 19, 21, 30)), '2026-10-19');   // 23:30 CEST
  assert.deepEqual(uraLj(Date.UTC(2026, 9, 25, 2, 0)), [3, 0]);       // po premiku CET
  assert.deepEqual(uraLj(Date.UTC(2026, 9, 24, 1, 0)), [3, 0]);       // pred premikom CEST
});

test('razcleniPot: prekinitve in pokvarjeni deli', () => {
  assert.deepEqual(razcleniPot('!100,46.5,15.6;130,46.51,15.6;x;!200,46.6,15.7'), [
    [100_000, 46.5, 15.6, 1], [130_000, 46.51, 15.6, 0], [200_000, 46.6, 15.7, 1],
  ]);
  assert.deepEqual(razcleniPot(null), []);
});

// Ponaredek D1: dovolj, da zabeleziVozila teče od začetka do konca.
function laznaBaza(vrstice = []) {
  const zapisi = [];
  return {
    zapisi,
    prepare(sql) {
      return {
        sql,
        bind(...a) { return { sql, a, all: async () => ({ results: vrstice }) }; },
      };
    },
    async batch(st) { zapisi.push(...st); return []; },
  };
}

test('zabeleziVozila: dva vzorca, en zapis na vozilo; ponoči brez drugega vzorca', async () => {
  const telo = (lat) => JSON.stringify({ Response: { Status: 1 }, Vehicles: [
    { BusCode: '153', Lat: lat, Lon: 15.95, LineId: 68 },   // daleč od tras
    { BusCode: '160', Lat: 46.53, Lon: 15.94, LineId: 69 },
  ] });
  let klic = 0;
  // Lažna ura: vsak vzorec se »zgodi« 30 s za prejšnjim.
  const ura = (od) => { let t = od; return () => t; };
  const db = laznaBaza();
  const orig = globalThis.setTimeout;
  try {
    let u = ura(T0);
    const uraFn = () => u();
    globalThis.setTimeout = (f) => { const n = u() + 30_000; u = ura(n); return orig(f, 0); };
    const izid = await zabeleziVozila({ SPREMLJANJE_DB: db }, async () => telo(klic++ ? sever(46.55, 250) : 46.55), uraFn);
    assert.equal(izid.dan, '2026-10-20');
    assert.equal(izid.vzorcev, 2);
    assert.equal(izid.zapisanih, 2);
    const z153 = db.zapisi.find(z => z.a[1] === '153');
    assert.ok(Math.abs(z153.a[2] - 0.25) < 0.005, z153.a[2]);
    assert.equal(z153.a[11].split(';').length, 2);

    // Čez polnoč: prvi vzorec 23:59:45, drugi 00:00:15 — drugi se izpusti.
    const polnoc = laznaBaza();
    klic = 0;
    u = ura(Date.UTC(2026, 9, 20, 21, 59, 45));
    const izP = await zabeleziVozila({ SPREMLJANJE_DB: polnoc }, async () => telo(klic++ ? sever(46.55, 250) : 46.55), uraFn);
    assert.equal(izP.dan, '2026-10-20');
    assert.equal(izP.vzorcev, 1);

    const noc = laznaBaza();
    const izNoc = await zabeleziVozila({ SPREMLJANJE_DB: noc }, async () => '{"Response":{"Status":-1}}', uraFn);
    assert.equal(izNoc.vzorcev, 0);
    assert.equal(noc.zapisi.length, 0);
  } finally {
    globalThis.setTimeout = orig;
  }
});

// ── Razdalja po trasi (prave trase iz src/trase.json) ─────────────────────────
import { razdaljaPoTrasi, projekcije } from '../src/trase.js';
import { repPoti } from '../src/spremljanje.js';
import { readFileSync } from 'node:fs';

const TRASE = JSON.parse(readFileSync(new URL('../src/trase.json', import.meta.url), 'utf8'));
// Točka na trasi pri razdalji `m` od začetka + dolžina do tja (iste formule kot trase.js).
function tockaNaTrasi(id, m) {
  const t = TRASE.trase.find(x => x.id === id).t;
  let s = 0;
  for (let i = 2; i < t.length; i += 2) {
    const d = razdaljaM(t[i - 2], t[i - 1], t[i], t[i + 1]);
    if (s + d >= m) { const u = (m - s) / d; return [t[i - 2] + u * (t[i] - t[i - 2]), t[i - 1] + u * (t[i + 1] - t[i - 1])]; }
    s += d;
  }
  return [t.at(-2), t.at(-1)];
}

test('po trasi G1: razdalja je dolžina trase med točkama, ne ravna črta', () => {
  for (const [a, b] of [[500, 900], [1000, 2500], [3000, 3300]]) {
    const A = tockaNaTrasi(6701, a), B = tockaNaTrasi(6701, b);
    const ravna = razdaljaM(...A, ...B);
    const dp = razdaljaPoTrasi(67, ...A, ...B, ravna);
    assert.ok(dp != null, `${a}-${b} ni na trasi`);
    assert.ok(dp >= ravna - 0.5, `${a}-${b}: po trasi ${dp} < ravna ${ravna}`);
    assert.ok(Math.abs(dp - (b - a)) < 0.03 * (b - a) + 5, `${a}-${b}: ${dp} namesto ~${b - a}`);
  }
});

test('po trasi: tuja linija, točka daleč od trase in vožnja nazaj ne dajo razdalje', () => {
  const A = tockaNaTrasi(6701, 1000), B = tockaNaTrasi(6701, 1600);
  const ravna = razdaljaM(...A, ...B);
  assert.equal(razdaljaPoTrasi(85, ...A, ...B, ravna), null);                 // P19 tu ne vozi
  assert.equal(razdaljaPoTrasi(null, ...A, ...B, ravna), null);
  const dalec = [A[0] + 300 / 111_195, A[1]];                                  // 300 m severno
  assert.equal(razdaljaPoTrasi(67, ...dalec, ...B, razdaljaM(...dalec, ...B)), null);
  assert.equal(projekcije(67, ...dalec).size, 0);
  // B -> A je na nasprotni smeri (6702) lahko veljavno, nikoli pa krajše od ravne črte.
  const nazaj = razdaljaPoTrasi(67, ...B, ...A, ravna);
  assert.ok(nazaj === null || nazaj >= ravna - 0.5);
});

test('po trasi: krožna G3 čez konec trase na začetek', () => {
  const tr = TRASE.trase.find(x => x.id === 6905);
  let L = 0; for (let i = 2; i < tr.t.length; i += 2) L += razdaljaM(tr.t[i - 2], tr.t[i - 1], tr.t[i], tr.t[i + 1]);
  const A = tockaNaTrasi(6905, L - 300), B = tockaNaTrasi(6905, 200);
  const dp = razdaljaPoTrasi(69, ...A, ...B, razdaljaM(...A, ...B));
  assert.ok(dp != null && Math.abs(dp - 500) < 40, String(dp));
});

test('dodajVzorec: po trasi šteje tudi čez 10-minutno vrzel, ravna črta ne', () => {
  const A = tockaNaTrasi(6701, 1000), B = tockaNaTrasi(6701, 4000);
  const s = new Map();
  dodajVzorec(s, [v('1', ...A, 67)], T0);
  dodajVzorec(s, [v('1', ...B, 67)], T0 + 10 * 60_000);
  assert.ok(Math.abs(s.get('1').km - 3) < 0.1, String(s.get('1').km));
  assert.equal(s.get('1').kmTrasa, s.get('1').km);

  const r = new Map();   // ista vožnja brez linije: ravna črta, vrzel > 5 min se ne šteje
  dodajVzorec(r, [v('1', ...A)], T0);
  dodajVzorec(r, [v('1', ...B)], T0 + 10 * 60_000);
  assert.equal(r.get('1').km, 0);
});

test('repPoti: samo novejše točke, načet prvi kos izpuščen', () => {
  assert.equal(repPoti('!100,1,1;130,2,2;160,3,3', false, 130), '160,3,3');
  assert.equal(repPoti('0,1,1;!130,2,2;160,3,3', true, 0), '!130,2,2;160,3,3');
  assert.equal(repPoti('100,1,1', false, 200), '');
  assert.equal(repPoti(null, false, 0), '');
});
