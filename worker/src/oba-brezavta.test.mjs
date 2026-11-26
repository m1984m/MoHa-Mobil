// node --test src/oba-brezavta.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { brezavtaVOba, razvrstiOdgovor, BREZAVTA_NAJVEC } from './oba.js';

const vrsta = (o) => ({
  route_id: 'MARPROM:74', route_short_name: 'P8', trip_headsign: 'Pekre - Limbuš - Avtobusna postaja',
  passed: false, realtime: false, departure_scheduled: 30600, ...o,
});

test('živ prihod: ETA iz dejanskega časa, zamuda v minutah, Realtime', () => {
  const o = brezavtaVOba([vrsta({ realtime: true, departure_realtime: 31035, departure_delay: 435 })], 30000);
  assert.equal(o.Response.Status, 1);
  const a = o.ArrivalsForStopPoints[0];
  assert.deepEqual(a, {
    LineId: 74, LineCode: 'P8', LineDescription: 'Pekre - Limbuš - Avtobusna postaja',
    ArrivalTime: '08:30', ETAMin: 17, DelayMin: 7, BusCode: '', Realtime: true,
  });
  assert.equal(razvrstiOdgovor('GetArrivalsForStopPoint', JSON.stringify(o)), 'ok');
});

test('vozni red: brez DelayMin, odpeljani in pretekli izpadejo, razvrščeno, največ 12', () => {
  const seznam = [
    vrsta({ departure_scheduled: 30000 + 600 }),
    vrsta({ departure_scheduled: 30000 - 300 }),          // odpeljal pred 5 min
    vrsta({ departure_scheduled: 30000 + 60, passed: true }),
    vrsta({ departure_scheduled: 30000 + 120 }),
    ...Array.from({ length: 20 }, (_, i) => vrsta({ departure_scheduled: 32000 + i * 60 })),
  ];
  const o = brezavtaVOba(seznam, 30000);
  const a = o.ArrivalsForStopPoints;
  assert.equal(a.length, BREZAVTA_NAJVEC);
  assert.deepEqual(a.slice(0, 2).map(x => x.ETAMin), [2, 10]);
  assert.equal('DelayMin' in a[0], false);
  assert.equal(a[0].Realtime, false);
});

test('po polnoči: čas dneva obratovanja > 24 h', () => {
  const o = brezavtaVOba([vrsta({ departure_scheduled: 86400 + 600 })], 86400 - 300);
  assert.equal(o.ArrivalsForStopPoints[0].ETAMin, 15);
  assert.equal(o.ArrivalsForStopPoints[0].ArrivalTime, '00:10');
});

test('po polnoči: vožnja včerajšnjega dneva obratovanja (> 24 h) ni čez 24 ur', () => {
  const o = brezavtaVOba([vrsta({ departure_scheduled: 86400 + 300 })], 120);
  assert.equal(o.ArrivalsForStopPoints[0].ETAMin, 3);
});

test('zvečer jutranje vožnje izpadejo (ne veljajo za jutrišnje), daljše od 3 h tudi', () => {
  const o = brezavtaVOba([
    vrsta({ departure_scheduled: 5 * 3600 }),
    vrsta({ departure_scheduled: 23 * 3600 + 600 }),
  ], 23 * 3600);
  assert.deepEqual(o.ArrivalsForStopPoints.map(x => x.ETAMin), [10]);
  assert.equal(brezavtaVOba([vrsta({ departure_scheduled: 30000 + 4 * 3600 })], 30000).Response.Status, -1);
});

test('živ prihod brez polja zamude: zamuda iz razlike časov, ne 0', () => {
  const o = brezavtaVOba([vrsta({ realtime: true, departure_realtime: 30600 + 240 })], 30000);
  assert.equal(o.ArrivalsForStopPoints[0].DelayMin, 4);
});

test('prazno in neveljavno', () => {
  assert.equal(razvrstiOdgovor('GetArrivalsForStopPoint', JSON.stringify(brezavtaVOba([], 0))), 'prazno');
  assert.equal(brezavtaVOba({ detail: 'Not Found' }), null);
  assert.equal(razvrstiOdgovor('GetArrivalsForStopPoint', JSON.stringify(null)), 'napaka');
});
