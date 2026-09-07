#!/usr/bin/env node
// Zgradi GTFS iz Marpromovega vmesnika OBA — rezerva, ko uradni gtfs.zip zaostaja.
//
// Zakaj: uradni https://vozniredi.marprom.si/gtfs/gtfs.zip je 07.09.2026 še vedno nosil
// poletni feed (delavniški servis potekel 31.08.), OBA pa je šolski vozni red že stregel
// (GetServiceDates 04.09.–31.12.). Ista podatkovna baza, samo izvoz zaostaja.
//
// OBA ne pozna "vožnje s postanki". Vožnjo sestavimo iz treh klicev na linijo in dan:
//   GetRoutes                 vrstni red postaj po smeri (+ geometrija za shapes.txt)
//   GetStopPointSheduleForLine odhodi po postaji in smeri (brez vezave na vožnjo)
//   GetTrips                  prva/zadnja postaja in čas vsake vožnje
// Vožnjo verižimo po postajah: na vsaki vzamemo najzgodnejši še neporabljen odhod, ki ni
// pred prejšnjim. Končna postaja v OBA nima odhoda — čas dobimo iz uradnega feeda
// (mediana zadnjega odseka), sicer iz razdalje.
//
// Uporaba:
//   node scripts/fetch-gtfs-oba.mjs               zapiše v jpp_maribor/gtfs_raw (z varnostno kopijo)
//   node scripts/fetch-gtfs-oba.mjs --out <mapa>   zapiše drugam (preizkus, primerjava)
//   node scripts/fetch-gtfs-oba.mjs --dates 2026-09-08,2026-09-12,2026-09-13   vzorčni dnevi D,S,N
//   node scripts/fetch-gtfs-oba.mjs --no-scan      brez pregleda vseh dni (prazniki, počitnice)
//
// ID-ji so združljivi z uradnim feedom: stop_id = StopPointId, route_id = LineId, direction_id
// po headsignu iz uradnega feeda — priljubljene postaje in linije v aplikaciji preživijo zamenjavo.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.resolve(__dirname, '../../../jpp_maribor/gtfs_raw');
const OBA = 'https://vozniredi.marprom.si/OBA';
const DELAY_MS = 250;
const SERVICE = { D: 9001, S: 9002, N: 9003 };
// Dela prosti dnevi, ki jih Marprom vozi po nedeljskem redu (preverjeno na OBA 07.09.2026).
// Pregled vseh dni (--scan, privzeto) to potrdi in ujame še tiste, ki jih tu ni.
const HOLIDAYS = new Set(['0101', '0102', '0208', '0427', '0501', '0502', '0625', '0815', '1031', '1101', '1225', '1226']);

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const OUT = arg('--out') ? path.resolve(arg('--out')) : RAW;
const DATES = arg('--dates')?.split(',');
const SCAN = !args.includes('--no-scan');

// --- pomožno ---
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const fmt = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00`;
const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

let reqCount = 0;
async function api(method, params = {}) {
  const u = new URL(`${OBA}/${method}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  for (let attempt = 1; ; attempt++) {
    try {
      reqCount++;
      const res = await fetch(u);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (j.Response?.Status !== 1) throw new Error(`OBA ${j.Response?.Message}`);
      await sleep(DELAY_MS);
      return j;
    } catch (e) {
      if (attempt >= 3) throw new Error(`${method}: ${e.message}`);
      await sleep(1000 * attempt);
    }
  }
}

// Minimalni CSV (enak kot build-gtfs.mjs) — za branje uradnega feeda.
function parseCSV(file) {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const split = (l) => { const out = []; let cur = '', inQ = false;
    for (let i = 0; i < l.length; i++) { const c = l[i];
      if (inQ) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') inQ = false; else cur += c; }
      else if (c === '"') inQ = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; }
    out.push(cur); return out; };
  const head = split(lines[0]);
  return lines.slice(1).map(l => { const v = split(l); const o = {}; head.forEach((h, i) => o[h] = v[i] ?? ''); return o; });
}

// --- uradni feed kot vir za direction_id, dolga imena, čas do končne postaje ---
function loadOfficial(dir) {
  const trips = parseCSV(path.join(dir, 'trips.txt'));
  const routes = parseCSV(path.join(dir, 'routes.txt'));
  const times = parseCSV(path.join(dir, 'stop_times.txt'));
  const stops = parseCSV(path.join(dir, 'stops.txt'));
  const agency = parseCSV(path.join(dir, 'agency.txt'));
  const dirByHeadsign = new Map();
  for (const t of trips) if (!dirByHeadsign.has(t.trip_headsign)) dirByHeadsign.set(t.trip_headsign, +t.direction_id);
  const longName = new Map(routes.map(r => [+r.route_id, r.route_long_name]));
  const stopCode = new Map(stops.map(s => [+s.stop_id, s.stop_code]));
  // Mediana trajanja med zaporednima postajama — rabimo za zadnji odsek (končna postaja v OBA nima odhoda).
  const byTrip = new Map();
  for (const st of times) { if (!byTrip.has(st.trip_id)) byTrip.set(st.trip_id, []); byTrip.get(st.trip_id).push(st); }
  // Odsek 358→192 traja pri G1 ob nedeljah 3 min, med tednom 4, pri P11 3 — zato ključ od
  // najbolj določnega (vrsta dneva + linija + smer) do splošnega (samo par postaj).
  const calendar = parseCSV(path.join(dir, 'calendar.txt'));
  const kindOfService = new Map(calendar.map(c => [c.service_id, +c.sunday ? 'N' : +c.saturday ? 'S' : 'D']));
  const tripInfo = new Map(trips.map(t => [t.trip_id, { route: t.route_id, headsign: t.trip_headsign, kind: kindOfService.get(t.service_id) }]));
  const legs = new Map();
  const termAfter = new Map(); // predzadnja postaja → končna postaja v uradnem feedu
  const legKeys = (kind, route, headsign, from, to) => [
    `${kind}|${route}|${headsign}|${from}>${to}`, `${route}|${headsign}|${from}>${to}`, `${route}|${from}>${to}`, `${from}>${to}`];
  for (const [tripId, arr] of byTrip) {
    arr.sort((a, b) => +a.stop_sequence - +b.stop_sequence);
    const ti = tripInfo.get(tripId) ?? {};
    for (let i = 1; i < arr.length; i++) {
      const d = (toMin(arr[i].arrival_time.slice(0, 5)) - toMin(arr[i - 1].departure_time.slice(0, 5)));
      if (d < 0) continue;
      for (const k of legKeys(ti.kind, ti.route, ti.headsign, arr[i - 1].stop_id, arr[i].stop_id)) {
        if (!legs.has(k)) legs.set(k, []); legs.get(k).push(d);
      }
    }
    if (arr.length >= 2) termAfter.set(+arr[arr.length - 2].stop_id, +arr[arr.length - 1].stop_id);
  }
  const medians = new Map([...legs].map(([k, v]) => [k, median(v)]));
  const legMin = {
    get: (kind, route, headsign, from, to) => { for (const k of legKeys(kind, route, headsign, from, to)) if (medians.has(k)) return medians.get(k); },
    has: (from, to) => medians.has(`${from}>${to}`),
  };
  return { dirByHeadsign, longName, stopCode, legMin, termAfter, agency: agency[0] || null, present: trips.length > 0 };
}

function haversineM(a, b) {
  const R = 6371000, toR = (x) => x * Math.PI / 180;
  const dLat = toR(b.lat - a.lat), dLon = toR(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// --- izbira vzorčnih dni ---
function pickDates(from, to) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let base = today > from ? today : from;
  const isHoliday = (d) => HOLIDAYS.has(ymd(d).slice(4));
  const find = (ok) => { for (let d = base; d <= to; d = addDays(d, 1)) if (ok(d) && !isHoliday(d)) return d; return null; };
  return {
    D: find(d => d.getDay() >= 2 && d.getDay() <= 4) || find(d => d.getDay() >= 1 && d.getDay() <= 5), // tor–čet, ne ob rob tedna
    S: find(d => d.getDay() === 6),
    N: find(d => d.getDay() === 0),
  };
}

// --- gradnja enega dneva ---
async function buildDay(kind, date, off, state) {
  const dateStr = iso(date);
  const lines = (await api('GetLines', { date: dateStr })).Lines ?? [];
  console.log(`\n[oba] ${kind} = ${dateStr}: ${lines.length} linij`);
  const out = { trips: [], stopTimes: [], anomalies: [] };

  for (const line of lines) {
    const lineId = line.LineId, code = line.Code;
    const [routes, sched, trips] = [
      await api('GetRoutes', { lineId, Date: dateStr, IncludeShape: 'true' }),
      await api('GetStopPointSheduleForLine', { lineId, Date: dateStr }),
      await api('GetTrips', { lineId, Date: dateStr, IncludeShape: 'true' }),
    ];
    if (!state.routes.has(lineId)) {
      state.routes.set(lineId, { id: lineId, short: code, long: off.longName.get(lineId) || line.Description || '', color: (line.Color || '').trim().replace('#', '') });
    }

    // Različice smeri: headsign + zaporedje postaj. Isti headsign ima lahko dve različici (npr. skrajšana).
    const variants = [];
    for (const r of routes.Routes ?? []) {
      const nodes = r.ListOfShapeNodes ?? [];
      const stops = nodes.filter(n => n.StopPointId).map(n => n.StopPointId);
      if (!stops.length) continue;
      const key = `${lineId}|${r.HeadsignName}|${stops.join(',')}`;
      if (variants.some(v => v.key === key)) continue;
      let shapeId = state.shapeIds.get(key);
      if (!shapeId) {
        shapeId = lineId * 100 + state.shapeIds.size % 100 + 1;
        while ([...state.shapeIds.values()].includes(shapeId)) shapeId++;
        state.shapeIds.set(key, shapeId);
        state.shapes.push(...nodes.map(n => ({ id: shapeId, seq: n.SequenceNo, lat: n.Lat, lon: n.Lon })));
      }
      for (const n of nodes) if (n.StopPointId && !state.stopPos.has(n.StopPointId)) state.stopPos.set(n.StopPointId, { lat: n.Lat, lon: n.Lon });
      variants.push({ key, headsign: r.HeadsignName, stops, shapeId });
    }
    const firstStopOfLine = variants[0]?.stops[0];

    // Odhodi po (headsign, postaja).
    const deps = new Map();
    for (const s of sched.Schedules ?? []) {
      const sp = s.StopPoint;
      if (sp.Code && !state.stopCode.has(sp.StopPointId)) state.stopCode.set(sp.StopPointId, sp.Code);
      state.stopName.set(sp.StopPointId, sp.Name);
      for (const sfl of s.ScheduleForLine ?? []) for (const ras of sfl.RouteAndSchedules ?? []) {
        const k = `${ras.Direction}|${sp.StopPointId}`;
        const list = (deps.get(k) ?? []);
        list.push(...ras.Departures.map(t => ({ t: toMin(t), used: false })));
        list.sort((a, b) => a.t - b.t);
        deps.set(k, list);
      }
    }

    // Vožnje: OBA vsako ponovi za vsak RouteId — vzamemo po TripId.
    const uniq = new Map();
    for (const t of trips.Trips ?? []) if (!uniq.has(t.TripId)) uniq.set(t.TripId, { id: t.TripId, start: t.ArrivalStopId, startT: toMin(t.ArrivalTime), end: t.DepartureStopId, endT: toMin(t.DepartureTime) });
    const ordered = [...uniq.values()].sort((a, b) => a.startT - b.startT || a.id - b.id);

    // Poskus veriženja po eni različici. Vrne postanke ali null; porabo označi šele ob uspehu.
    const chain = (trip, v, i, j) => {
      const picked = [];
      let prev = trip.startT;
      for (let k = i; k <= j; k++) {
        const pool = deps.get(`${v.headsign}|${v.stops[k]}`) ?? [];
        // Čez polnoč: odhod ob 00:10 po 23:50 je +24 h, ne −23 h.
        const adj = (p) => p.t + (p.t < prev - 720 ? 1440 : 0);
        // Na začetni postaji mora biti odhod točno ob času vožnje — tako ločimo različice
        // z istim začetkom in koncem (G4 Poljane z/brez Lesarske šole, P10 tri poti).
        const cand = pool.find(p => !p.used && (k === i ? adj(p) === prev : adj(p) >= prev));
        if (!cand) return null;
        prev = adj(cand);
        picked.push({ stop: v.stops[k], t: prev, ref: cand });
      }
      return picked;
    };

    let built = 0;
    for (const trip of ordered) {
      // Različice, v katerih je začetna postaja pred končno in ima na začetni postaji odhode.
      // Najprej tiste, kjer je vožnja cela (od prve do predzadnje postaje), potem daljše.
      const cands = variants.map(v => ({ v, i: v.stops.indexOf(trip.start), j: v.stops.indexOf(trip.end) }))
        .filter(c => c.i >= 0 && c.j > c.i && deps.has(`${c.v.headsign}|${trip.start}`))
        .sort((a, b) => ((b.i === 0 && b.j === b.v.stops.length - 2) - (a.i === 0 && a.j === a.v.stops.length - 2)) || (b.j - b.i) - (a.j - a.i));
      let hit = null;
      for (const c of cands) { const picked = chain(trip, c.v, c.i, c.j); if (picked) { hit = { ...c, picked }; break; } }
      if (!hit) { out.anomalies.push(`${code}: vožnja ${trip.start}→${trip.end} ob ${fmt(trip.startT).slice(0, 5)} — nobena smer nima ustreznih odhodov`); continue; }
      const { v, j, picked } = hit;
      for (const p of picked) p.ref.used = true;
      const times = picked.map(p => ({ stop: p.stop, t: p.t }));
      const endT = trip.endT + (trip.endT < trip.startT ? 1440 : 0);
      if (times[times.length - 1].t !== endT) out.anomalies.push(`${code}: vožnja ${trip.id} (${v.headsign}) konča ob ${fmt(times[times.length - 1].t)}, OBA pravi ${fmt(endT)}`);
      // Končna postaja: OBA zanjo nima odhoda. Čas = zadnji odsek iz uradnega feeda ali iz razdalje.
      if (j + 1 < v.stops.length) {
        const from = v.stops[j];
        let to = v.stops[j + 1];
        // OBA konča vožnje proti mestu na 457 (Mlinska 2), uradni feed na 192 (Mlinska 1) — ista
        // Avtobusna postaja. Držimo se uradnega ID-ja, da priljubljene postaje še kažejo prihode.
        const offTerm = off.termAfter.get(from);
        if (!off.legMin.has(from, to) && offTerm != null && offTerm !== to && state.stopName.get(offTerm) === state.stopName.get(to)) {
          out.anomalies.push(`${code}: končna postaja ${to} → ${offTerm} (${state.stopName.get(to)}) po uradnem feedu`);
          to = offTerm;
        }
        let leg = off.legMin.get(kind, lineId, v.headsign, from, to);
        if (leg == null) {
          const a = state.stopPos.get(from), b = state.stopPos.get(to);
          leg = a && b ? Math.max(1, Math.round(haversineM(a, b) / 1000 / 20 * 60)) : 1; // 20 km/h
          out.anomalies.push(`${code}: odsek ${from}→${to} ni v uradnem feedu, ocena ${leg} min`);
        }
        times.push({ stop: to, t: times[times.length - 1].t + leg });
      }
      const tripId = state.tripIds.has(trip.id) ? state.tripIds.size + 900000 + trip.id : trip.id;
      state.tripIds.add(tripId);
      const dir = off.dirByHeadsign.has(v.headsign) ? off.dirByHeadsign.get(v.headsign) : (v.stops[0] === firstStopOfLine ? 0 : 1);
      out.trips.push({ route: lineId, service: SERVICE[kind], id: tripId, headsign: v.headsign, short: code, dir, shape: v.shapeId });
      times.forEach((x, n) => out.stopTimes.push({ trip: tripId, t: x.t, stop: x.stop, seq: n + 1 }));
      built++;
    }
    let leftover = 0;
    for (const [k, list] of deps) { const n = list.filter(p => !p.used).length; if (n) { leftover += n; out.anomalies.push(`${code}: ${n} neporabljenih odhodov na ${k.replace('|', ' @ ')}`); } }
    console.log(`  ${code.padEnd(4)} ${String(built).padStart(3)}/${uniq.size} voženj, ${variants.length} smeri${leftover ? `, ${leftover} neporabljenih odhodov` : ''}`);
  }
  return out;
}

// --- pregled vseh dni: kateri dan vozi po katerem redu ---
async function signature(dateStr, probeLine) {
  const lines = (await api('GetLines', { date: dateStr })).Lines ?? [];
  const codes = lines.map(l => l.Code).sort().join(',');
  if (!lines.some(l => l.LineId === probeLine)) return `${codes}|-`;
  const s = await api('GetStopPointSheduleForLine', { lineId: probeLine, Date: dateStr });
  const deps = (s.Schedules ?? []).flatMap(x => x.ScheduleForLine.flatMap(y => y.RouteAndSchedules.flatMap(z => z.Departures))).join(',');
  return `${codes}|${deps}`;
}

async function scanDays(from, to, sample, probeLine) {
  const sig = {};
  for (const k of Object.keys(sample)) sig[k] = await signature(iso(sample[k]), probeLine);
  const exceptions = [], unknown = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const expected = d.getDay() === 0 ? 'N' : d.getDay() === 6 ? 'S' : 'D';
    const s = await signature(iso(d), probeLine);
    const actual = Object.keys(sig).find(k => sig[k] === s) || null;
    if (actual === expected) continue;
    if (actual) exceptions.push({ date: ymd(d), expected, actual });
    else unknown.push(iso(d));
  }
  return { exceptions, unknown };
}

// --- main ---
const sd = (await api('GetServiceDates')).ServiceDates;
const from = parseISO(sd.DateFrom), to = parseISO(sd.DateTo);
console.log(`[oba] obdobje vmesnika: ${sd.DateFrom} – ${sd.DateTo}`);

const sample = DATES ? { D: parseISO(DATES[0]), S: parseISO(DATES[1]), N: parseISO(DATES[2]) } : pickDates(from, to);
for (const k of ['D', 'S', 'N']) if (!sample[k]) { console.error(`[oba] ✗ v obdobju ni vzorčnega dne za ${k}`); process.exit(1); }

const off = loadOfficial(RAW);
console.log(off.present ? `[oba] uradni feed v ${RAW} rabim za direction_id in končne odseke` : `[oba] ! uradnega feeda ni — direction_id in končni odseki bodo ocenjeni`);

const state = { routes: new Map(), shapeIds: new Map(), shapes: [], stopPos: new Map(), stopCode: new Map(), stopName: new Map(), tripIds: new Set() };
const allStops = (await api('GetAllStopPoints')).StopPoints ?? [];
for (const s of allStops) { state.stopName.set(s.StopPointId, s.Name); state.stopPos.set(s.StopPointId, { lat: s.Lat, lon: s.Lon }); }
const days = {};
for (const k of ['D', 'S', 'N']) days[k] = await buildDay(k, sample[k], off, state);

// Ista posebnost se ponovi za vsako vožnjo — izpis strnemo s števcem.
const anomalyCount = new Map();
for (const a of Object.values(days).flatMap(d => d.anomalies)) anomalyCount.set(a, (anomalyCount.get(a) ?? 0) + 1);
const anomalies = [...anomalyCount].map(([a, n]) => n > 1 ? `${a} (×${n})` : a);
if (anomalies.length) { console.log(`\n[oba] ! ${anomalies.length} posebnosti:`); for (const a of anomalies) console.log(`   ${a}`); }

// Prazniki in počitnice: dnevi, ki ne vozijo po pričakovanem redu.
let calDates = [];
if (SCAN) {
  console.log(`\n[oba] pregledujem vse dni ${sd.DateFrom} – ${sd.DateTo} ...`);
  const probe = state.routes.has(77) ? 77 : [...state.routes.keys()][0];
  const { exceptions, unknown } = await scanDays(from, to, sample, probe);
  for (const e of exceptions) {
    calDates.push({ service: SERVICE[e.expected], date: e.date, type: 2 });
    calDates.push({ service: SERVICE[e.actual], date: e.date, type: 1 });
    console.log(`  ${e.date}: namesto ${e.expected} vozi ${e.actual}`);
  }
  if (unknown.length) console.log(`  ! dnevi z NEZNANIM redom (niso D/S/N — morda počitniški red): ${unknown.join(', ')}`);
  if (!exceptions.length && !unknown.length) console.log(`  vsi dnevi po pričakovanem redu`);
} else {
  for (let d = from; d <= to; d = addDays(d, 1)) if (HOLIDAYS.has(ymd(d).slice(4)) && d.getDay() !== 0) {
    calDates.push({ service: SERVICE[d.getDay() === 6 ? 'S' : 'D'], date: ymd(d), type: 2 }, { service: SERVICE.N, date: ymd(d), type: 1 });
  }
}

// --- zapis ---
const stopsUsed = new Set(Object.values(days).flatMap(d => d.stopTimes.map(s => s.stop)));
const stopRows = allStops.filter(s => stopsUsed.has(s.StopPointId)).map(s => {
  const code = state.stopCode.get(s.StopPointId);
  return `${s.StopPointId},${q(code ? `s${code}` : (off.stopCode.get(s.StopPointId) || ''))},${q(s.Name)},${q(s.Lat)},${q(s.Lon)}`;
});
const missing = [...stopsUsed].filter(id => !allStops.some(s => s.StopPointId === id));
if (missing.length) console.log(`[oba] ! postaje v voznem redu, ki jih GetAllStopPoints ne pozna: ${missing.join(', ')}`);

const ag = off.agency;
const files = {
  'agency.txt': ['agency_id,agency_name,agency_url,agency_timezone,agency_lang,agency_phone,agency_fare_url,agency_email',
    ag ? `${ag.agency_id},${q(ag.agency_name)},${q(ag.agency_url)},${q(ag.agency_timezone)},${q(ag.agency_lang)},${q(ag.agency_phone)},${q(ag.agency_fare_url)},${q(ag.agency_email)}`
       : `3,"Marprom","https://marprom.si","Europe/Ljubljana","sl","","",""`],
  'feed_info.txt': ['feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date,feed_version,feed_contact_email,feed_contact_url',
    `"MARPROM (izvoz iz OBA)","https://vozniredi.marprom.si","sl","${ymd(from)}","${ymd(to)}","oba-${new Date().toISOString().slice(0, 10)}","marprom.transit@gmail.com","https://www.marprom.si"`],
  'stops.txt': ['stop_id,stop_code,stop_name,stop_lat,stop_lon', ...stopRows],
  'routes.txt': ['route_id,agency_id,route_short_name,route_long_name,route_type,route_color',
    ...[...state.routes.values()].sort((a, b) => a.id - b.id).map(r => `${r.id},${ag?.agency_id || 3},${q(r.short)},${q(r.long)},3,${q(r.color)}`)],
  'calendar.txt': ['service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date',
    `${SERVICE.D},1,1,1,1,1,0,0,"${ymd(from)}","${ymd(to)}"`,
    `${SERVICE.S},0,0,0,0,0,1,0,"${ymd(from)}","${ymd(to)}"`,
    `${SERVICE.N},0,0,0,0,0,0,1,"${ymd(from)}","${ymd(to)}"`],
  'calendar_dates.txt': ['service_id,date,exception_type', ...calDates.map(c => `${c.service},"${c.date}",${c.type}`)],
  'trips.txt': ['route_id,service_id,trip_id,trip_headsign,trip_short_name,direction_id,shape_id',
    ...Object.values(days).flatMap(d => d.trips).map(t => `${t.route},${t.service},${t.id},${q(t.headsign)},${q(t.short)},${t.dir},${t.shape}`)],
  'stop_times.txt': ['trip_id,arrival_time,departure_time,stop_id,stop_sequence,timepoint',
    ...Object.values(days).flatMap(d => d.stopTimes).map(s => `${s.trip},"${fmt(s.t)}","${fmt(s.t)}",${s.stop},${s.seq},1`)],
  'shapes.txt': ['shape_id,shape_pt_sequence,shape_pt_lat,shape_pt_lon',
    ...state.shapes.map(p => `${p.id},${p.seq},${q(p.lat)},${q(p.lon)}`)],
};

if (OUT === RAW && off.present) {
  // gtfs_raw ni pod gitom — kot fetch-gtfs.mjs naredimo kopijo, preden prepišemo.
  const fi = parseCSV(path.join(RAW, 'feed_info.txt'))[0];
  const backup = `${RAW}_backup_${fi?.feed_start_date || 'prev'}`;
  if (!fs.existsSync(backup)) {
    fs.mkdirSync(backup, { recursive: true });
    for (const f of fs.readdirSync(RAW)) if (f.endsWith('.txt')) fs.copyFileSync(path.join(RAW, f), path.join(backup, f));
    console.log(`\n[oba] varnostna kopija → ${backup}`);
  }
}
fs.mkdirSync(OUT, { recursive: true });
for (const [name, rows] of Object.entries(files)) fs.writeFileSync(path.join(OUT, name), rows.join('\n') + '\n', 'utf8');

const nTrips = Object.values(days).reduce((n, d) => n + d.trips.length, 0);
const nST = Object.values(days).reduce((n, d) => n + d.stopTimes.length, 0);
console.log(`\n[oba] ✓ zapisano v ${OUT}  (${reqCount} klicev)`);
console.log(`  postaje ${stopRows.length} · linije ${state.routes.size} · vožnje ${nTrips} (D ${days.D.trips.length} / S ${days.S.trips.length} / N ${days.N.trips.length}) · postanki ${nST} · izjeme ${calDates.length / 2}`);
if (anomalies.length) console.log(`  ! ${anomalies.length} posebnosti zgoraj — preglej pred objavo`);
if (OUT === RAW) console.log(`\n  → naslednji korak: node scripts/build-gtfs.mjs`);
