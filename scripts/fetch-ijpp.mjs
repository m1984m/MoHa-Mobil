#!/usr/bin/env node
// Medkrajevni (IJPP) vozni redi okolice Maribora iz zrcala derp.si → public/gtfs/ijpp.json.
//
// Uporaba:
//   node scripts/fetch-ijpp.mjs              prenesi zip in zapiši ijpp.json
//   node scripts/fetch-ijpp.mjs <pot.zip>    uporabi že prenesen zip (brez prenosa)
//
// Vir: nacionalni IJPP feed (DUJPP / NAP), zrcalo gitlab.com/derp-si/gtfs-generators,
// licenca CC-BY-SA 4.0 (navedba vira je v nastavitvah aplikacije). Marpromovega feeda se
// ne dotika: izhod je ločena datoteka, ki jo aplikacija naloži šele ob prvem odprtju
// postajališča (src/lib/ijpp.ts).
//
// Filter:
//  - prevozniki brez LPP (ljubljanski mestni promet); vlaki SŽ ostanejo (route_type 2
//    ustavlja na Maribor, Tezno, Pesnica …), ker so del medkrajevne ponudbe;
//  - postajališča v pravokotniku okolice Maribora (BBOX);
//  - vožnje, ki z vsaj enega takega postajališča odpeljejo, z dnevi vožnje od danes
//    naprej DAYS dni;
//  - od vožnje ostanejo SAMO postanki v območju, brez zadnje postaje vožnje (tam je
//    prihod, ne odhod; enako pravilo kot upcomingDepartures v gtfs.ts). Zakaj ne cele
//    vožnje: aplikacija kaže odhode s postajališča in cilj iz opisa vožnje (»… - Ljubljana
//    AP«), postanki zunaj Maribora bi izhod povečali nekajkrat brez koristi za prikaz.
//    Za planer bi bili potrebni samo postanki v območju tudi tako.
//
// Oblika izhoda (kompaktna, indeksi namesto ponovljenih nizov):
//   { meta, agencies:[[ime, barva]], routes:[[agencija, oznaka, tip, barva]],
//     stops:[[ime, lat, lon]], heads:[opis], days:['0110…'], start:'YYYYMMDD',
//     trips:[[route, days, head, [stop, min, stop, min, …]]] }
// `days[i]` je niz 0/1 za DAYS dni od `start`; min = minute od polnoči dneva službe (lahko > 1440).

import { writeFile, readFile } from 'node:fs/promises';
import { inflateRawSync, gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename } from 'node:path';

const URL_IJPP = 'https://gitlab.com/api/v4/projects/derp-si%2Fgtfs-generators/packages/generic/IJPP/latest/ijpp_gtfs.zip';
const BBOX = { w: 15.45, e: 15.85, s: 46.45, n: 46.65 };
const DAYS = 60;
const SKIP_AGENCIES = new Set(['1118']); // LPP

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../public/gtfs/ijpp.json');

// --- minimalni ZIP reader (enak kot fetch-gtfs.mjs; ZIP64 ni podprt, zip ima ~50 MB) ---
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP: End of Central Directory ni najden');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('ZIP: pokvarjen central directory');
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    const dataOff = localOff + 30 + buf.readUInt16LE(localOff + 26) + buf.readUInt16LE(localOff + 28);
    // shapes.txt (170 MB) ne potrebujemo — ne razširimo ga.
    if (!name.endsWith('/') && name !== 'shapes.txt') {
      const raw = buf.subarray(dataOff, dataOff + compSize);
      if (method !== 0 && method !== 8) throw new Error(`ZIP: nepodprta kompresija ${method} (${name})`);
      files.set(basename(name), method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
    }
    off += 46 + nameLen + extraLen + commLen;
  }
  return files;
}

// CSV z narekovaji (imena prevoznikov imajo vejice).
function parseLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
function* rows(buf) {
  const lines = buf.toString('utf8').replace(/^﻿/, '').split(/\r?\n/);
  const head = parseLine(lines[0]);
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const v = parseLine(lines[i]);
    const o = {};
    head.forEach((h, j) => { o[h] = v[j] ?? ''; });
    yield o;
  }
}

const ymd = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

const arg = process.argv[2];
let zip;
if (arg) {
  zip = await readFile(arg);
} else {
  console.log(`[ijpp] prenašam ${URL_IJPP}`);
  const r = await fetch(URL_IJPP);
  if (!r.ok) throw new Error(`prenos HTTP ${r.status}`);
  zip = Buffer.from(await r.arrayBuffer());
}
console.log(`[ijpp] zip ${(zip.length / 1e6).toFixed(1)} MB`);
const f = unzip(zip);

// Okno dni: od danes (Europe/Ljubljana) naprej.
const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Ljubljana' }).format(new Date()); // YYYY-MM-DD
const start = new Date(todayStr + 'T00:00:00Z');
const dates = Array.from({ length: DAYS }, (_, i) => { const d = new Date(start); d.setUTCDate(d.getUTCDate() + i); return d; });
const dateIdx = new Map(dates.map((d, i) => [ymd(d), i]));

// Službe → niz 0/1 po dnevih okna.
const svc = new Map();
const WD = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
for (const c of rows(f.get('calendar.txt'))) {
  const bits = dates.map(d => {
    const s = ymd(d);
    return s >= c.start_date && s <= c.end_date && c[WD[d.getUTCDay()]] === '1' ? 1 : 0;
  });
  svc.set(c.service_id, bits);
}
for (const e of rows(f.get('calendar_dates.txt'))) {
  const i = dateIdx.get(e.date);
  if (i === undefined) continue;
  let bits = svc.get(e.service_id);
  if (!bits) svc.set(e.service_id, bits = new Array(DAYS).fill(0));
  bits[i] = e.exception_type === '1' ? 1 : 0;
}

const agencyName = new Map([...rows(f.get('agency.txt'))].map(a => [a.agency_id, a.agency_name]));
const routes = new Map();
for (const r of rows(f.get('routes.txt'))) {
  if (SKIP_AGENCIES.has(r.agency_id) || r.route_id.startsWith('LPP')) continue;
  routes.set(r.route_id, r);
}
const stopsAll = new Map();
for (const s of rows(f.get('stops.txt'))) {
  const lat = +s.stop_lat, lon = +s.stop_lon;
  if (lat >= BBOX.s && lat <= BBOX.n && lon >= BBOX.w && lon <= BBOX.e) stopsAll.set(s.stop_id, { name: s.stop_name, lat, lon });
}
const trips = new Map();
for (const t of rows(f.get('trips.txt'))) {
  if (!routes.has(t.route_id)) continue;
  const bits = svc.get(t.service_id);
  if (!bits || !bits.includes(1)) continue;
  trips.set(t.trip_id, { t, st: [] });
}
// stop_times: vse postanke izbranih voženj (zadnjo postajo moramo poznati tudi zunaj območja).
for (const s of rows(f.get('stop_times.txt'))) {
  const e = trips.get(s.trip_id);
  if (e) e.st.push([+s.stop_sequence, s.stop_id, s.departure_time || s.arrival_time]);
}

const agencies = [], agencyIx = new Map();
const outRoutes = [], routeIx = new Map();
const outStops = [], stopIx = new Map();
const heads = [], headIx = new Map();
const days = [], daysIx = new Map();
const outTrips = [];
const ix = (map, arr, key, make) => { let i = map.get(key); if (i === undefined) { i = arr.length; arr.push(make()); map.set(key, i); } return i; };

for (const { t, st } of trips.values()) {
  st.sort((a, b) => a[0] - b[0]);
  const seq = [];
  for (let i = 0; i < st.length - 1; i++) {   // brez zadnje postaje vožnje
    const [, sid, time] = st[i];
    const s = stopsAll.get(sid);
    if (!s || !time) continue;
    seq.push(ix(stopIx, outStops, sid, () => [s.name, +s.lat.toFixed(5), +s.lon.toFixed(5)]), toMin(time));
  }
  if (!seq.length) continue;
  const r = routes.get(t.route_id);
  const a = ix(agencyIx, agencies, r.agency_id, () => [agencyName.get(r.agency_id) ?? r.agency_id, r.route_color ? '#' + r.route_color : '']);
  const ri = ix(routeIx, outRoutes, t.route_id, () => [a, r.route_short_name || r.route_long_name, +r.route_type]);
  const bits = svc.get(t.service_id).join('');
  const di = ix(daysIx, days, bits, () => bits);
  const head = t.trip_headsign || r.route_long_name || '';
  const hi = ix(headIx, heads, head, () => head);
  outTrips.push([ri, di, hi, seq]);
}

const feedInfo = [...rows(f.get('feed_info.txt'))][0] ?? {};
const out = {
  meta: { built: new Date().toISOString(), source: 'derp.si / NAP (IJPP), CC-BY-SA 4.0', feedVersion: feedInfo.feed_version ?? '', bbox: BBOX },
  start: ymd(start), agencies, routes: outRoutes, stops: outStops, heads, days, trips: outTrips,
};
const json = JSON.stringify(out);
await writeFile(OUT, json, 'utf8');
const perAgency = agencies.map((ag, i) => `${ag[0]}: ${outRoutes.filter(r => r[0] === i).length} linij`);
console.log(`[ijpp] ${outStops.length} postajališč, ${outRoutes.length} linij, ${outTrips.length} voženj, ${days.length} vzorcev dni`);
console.log(`[ijpp] ${perAgency.join('; ')}`);
console.log(`[ijpp] ${OUT}: ${(json.length / 1024).toFixed(0)} kB, gzip ${(gzipSync(json).length / 1024).toFixed(0)} kB`);
