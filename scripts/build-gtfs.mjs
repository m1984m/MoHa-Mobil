// GTFS static -> optimized JSON for client.
// Input:  jpp_maribor/gtfs_raw/
// Output: web/public/gtfs/{stops,routes,trips,service,shapes}.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.resolve(__dirname, '../../../jpp_maribor/gtfs_raw');
const OUT = path.resolve(__dirname, '../public/gtfs');
fs.mkdirSync(OUT, { recursive: true });

function parseCSV(file) {
  const text = fs.readFileSync(path.join(RAW, file), 'utf8').replace(/^\uFEFF/, '');
  const rows = [];
  let i = 0, field = '', row = [], inQuote = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { inQuote = false; i++; continue; }
      field += c; i++;
    } else {
      if (c === '"') { inQuote = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows.filter(r => r.length === header.length).map(r => Object.fromEntries(header.map((h, idx) => [h, r[idx]])));
}

function hhmmToSec(t) {
  const [h, m, s] = t.split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
}

console.log('[*] Parsing GTFS...');
const stops   = parseCSV('stops.txt');
const routes  = parseCSV('routes.txt');
const trips   = parseCSV('trips.txt');
const times   = parseCSV('stop_times.txt');
const calendar = parseCSV('calendar.txt');
const calDates = fs.existsSync(path.join(RAW, 'calendar_dates.txt')) ? parseCSV('calendar_dates.txt') : [];
const shapes  = fs.existsSync(path.join(RAW, 'shapes.txt')) ? parseCSV('shapes.txt') : [];

console.log(`  stops: ${stops.length}, routes: ${routes.length}, trips: ${trips.length}, stop_times: ${times.length}`);

// === stops.json ===
const stopsOut = stops.map(s => ({
  id: +s.stop_id,
  name: s.stop_name,
  lat: +s.stop_lat,
  lon: +s.stop_lon,
  code: s.stop_code || null,
}));
fs.writeFileSync(path.join(OUT, 'stops.json'), JSON.stringify(stopsOut));

// === routes.json ===
const routesOut = routes.map(r => ({
  id: +r.route_id,
  short: r.route_short_name,
  long: r.route_long_name,
  type: +r.route_type,
}));
fs.writeFileSync(path.join(OUT, 'routes.json'), JSON.stringify(routesOut));

// === service.json (which services run on which weekday bitmap) ===
const serviceOut = calendar.map(c => ({
  id: +c.service_id,
  days: [c.monday, c.tuesday, c.wednesday, c.thursday, c.friday, c.saturday, c.sunday].map(Number),
  start: c.start_date,
  end: c.end_date,
}));
const exceptionsOut = calDates.map(c => ({
  service: +c.service_id,
  date: c.date,
  type: +c.exception_type, // 1 = added, 2 = removed
}));
fs.writeFileSync(path.join(OUT, 'service.json'), JSON.stringify({ services: serviceOut, exceptions: exceptionsOut }));

// === trips.json grouped by service ===
// Group stop_times by trip; order by stop_sequence
const stByTrip = new Map();
for (const st of times) {
  const tid = +st.trip_id;
  if (!stByTrip.has(tid)) stByTrip.set(tid, []);
  stByTrip.get(tid).push({
    seq: +st.stop_sequence,
    stop: +st.stop_id,
    arr: hhmmToSec(st.arrival_time),
    dep: hhmmToSec(st.departure_time),
  });
}
for (const arr of stByTrip.values()) arr.sort((a, b) => a.seq - b.seq);

const tripsOut = trips.map(t => {
  const st = stByTrip.get(+t.trip_id) || [];
  return {
    id: +t.trip_id,
    route: +t.route_id,
    service: +t.service_id,
    headsign: t.trip_headsign,
    short: t.trip_short_name,
    dir: +t.direction_id,
    shape: t.shape_id ? +t.shape_id : null,
    stops: st.map(s => [s.stop, s.arr, s.dep]),
  };
});
fs.writeFileSync(path.join(OUT, 'trips.json'), JSON.stringify(tripsOut));

// === shapes.json ===
if (shapes.length) {
  const byId = new Map();
  for (const p of shapes) {
    const id = +p.shape_id;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push({ seq: +p.shape_pt_sequence, lat: +p.shape_pt_lat, lon: +p.shape_pt_lon });
  }
  const shapesOut = [...byId].map(([id, pts]) => ({
    id,
    pts: pts.sort((a, b) => a.seq - b.seq).map(p => [p.lat, p.lon]),
  }));
  fs.writeFileSync(path.join(OUT, 'shapes.json'), JSON.stringify(shapesOut));
}

// === meta.json ===
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({
  built: new Date().toISOString(),
  counts: { stops: stopsOut.length, routes: routesOut.length, trips: tripsOut.length, services: serviceOut.length },
}));

const sz = (f) => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(1) + ' kB';
console.log('[OK] wrote:');
for (const f of fs.readdirSync(OUT)) console.log(`  ${f}  ${sz(f)}`);
