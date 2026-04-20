// Self-test za OBA live podatke — preveri, ali so pozicije busov sinhrone s postajami.
// Polla /GetActiveDeviceDetails + /GetArrivalsForStopPoint za 2 min in flaga nedoslednosti:
//   1) bus v /GetActiveDeviceDetails ni v /GetArrivalsForStopPoint po BusCode
//   2) etaMin iz dveh endpointov se razlikujeta za >1 min
//   3) GPS razdalja bus→nextStop je nerazumna glede na ETA
//      (city bus @ 50 km/h ≈ 833 m/min, dopušča margin; zastoj → neskončen čas, zato spodnja meja)
//
// Run: node scripts/sanity-live.mjs
// Trajanje: 120 s (5 poll-ov na 30 s) — PWA uporablja isti interval.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STOPS_PATH = resolve(__dirname, '..', 'public', 'gtfs', 'stops.json');

const OBA_BASE = 'https://vozniredi.marprom.si/OBA';
const POLL_INTERVAL_MS = 30_000;
const POLL_COUNT = 5; // ~ 2 min s prvim takoj
const ETA_DIFF_TOL_MIN = 1;
const MAX_METERS_PER_MIN = 900; // realna zgornja meja city bus (54 km/h)
const EXTRA_BUFFER_M = 400;     // ETA zaokrožen na minuto + distance to next stop centerpoint

const stops = JSON.parse(readFileSync(STOPS_PATH, 'utf8'));
const stopById = new Map(stops.map(s => [s.id, s]));

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function fetchJSON(path) {
  const r = await fetch(OBA_BASE + path, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

function fmt(n, d = 0) { return Number.isFinite(n) ? n.toFixed(d) : '—'; }

async function oneCycle(cycleIdx) {
  const t0 = Date.now();
  const dd = await fetchJSON('/GetActiveDeviceDetails');
  const vehicles = dd.Vehicles ?? [];

  // Zberi unikatne NextStopPointId-je
  const stopIds = [...new Set(vehicles.map(v => v.NextStopPointId).filter(x => x != null))];

  // Paralel fetch arrivals
  const arrivalsByStop = new Map();
  await Promise.all(stopIds.map(async (sid) => {
    try {
      const j = await fetchJSON(`/GetArrivalsForStopPoint?stopPointId=${sid}`);
      arrivalsByStop.set(sid, j.ArrivalsForStopPoints ?? []);
    } catch (e) {
      arrivalsByStop.set(sid, null); // fail marker
    }
  }));

  const stats = {
    cycle: cycleIdx,
    vehicles: vehicles.length,
    gpsPredicted: 0,
    okArrivalMatch: 0,
    notInArrivals: 0,
    etaMismatch: 0,
    distOutOfRange: 0,
    stopsWithoutCoord: 0,
    stopsFetchFailed: 0,
    issues: [],
  };

  for (const v of vehicles) {
    if (v.Predicted) stats.gpsPredicted++;
    const stopId = v.NextStopPointId;
    if (stopId == null) continue;

    const stop = stopById.get(stopId);
    if (!stop) {
      stats.stopsWithoutCoord++;
      continue;
    }

    const arrivals = arrivalsByStop.get(stopId);
    if (arrivals == null) { stats.stopsFetchFailed++; continue; }

    // 1) ali je ta bus v seznamu arrivals po BusCode
    const match = arrivals.find(a => String(a.BusCode ?? '') === String(v.BusCode ?? ''));

    const distM = haversineM(v.Lat, v.Lon, stop.lat, stop.lon);
    const eta = typeof v.ETA === 'number' ? v.ETA : null;
    const maxReasonableM = (eta ?? 0) * MAX_METERS_PER_MIN + EXTRA_BUFFER_M;

    const issue = [];
    if (!match) {
      stats.notInArrivals++;
      issue.push(`NOT_IN_ARRIVALS`);
    } else {
      stats.okArrivalMatch++;
      const arrEta = match.ETAMin;
      if (typeof arrEta === 'number' && eta != null && Math.abs(arrEta - eta) > ETA_DIFF_TOL_MIN) {
        stats.etaMismatch++;
        issue.push(`ETA_DIFF vehETA=${eta} arrETA=${arrEta}`);
      }
    }
    // 3) distance sanity samo za GPS-predicted bus-e — za scheduled so pozicije često stale/interp.
    if (v.Predicted && eta != null && distM > maxReasonableM) {
      stats.distOutOfRange++;
      issue.push(`DIST_TOO_FAR dist=${fmt(distM)}m eta=${eta}min max=${fmt(maxReasonableM)}m`);
    }

    if (issue.length > 0) {
      stats.issues.push(
        `  #${v.BusCode} L${v.LineId} → stop ${stopId} "${stop.name}" | GPS=${v.Predicted ? 'y' : 'n'} dist=${fmt(distM)}m eta=${eta ?? '—'}min :: ${issue.join(' | ')}`
      );
    }
  }

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  return { stats, elapsedSec: dt };
}

function printCycle(r) {
  const s = r.stats;
  console.log(`\n[cycle ${s.cycle}] ${s.vehicles} buses (GPS: ${s.gpsPredicted}) · fetched in ${r.elapsedSec}s`);
  console.log(`  ✓ v arrivals: ${s.okArrivalMatch}/${s.vehicles}`);
  if (s.notInArrivals) console.log(`  ✗ NOT_IN_ARRIVALS: ${s.notInArrivals}`);
  if (s.etaMismatch)   console.log(`  ✗ ETA_DIFF >${ETA_DIFF_TOL_MIN}min: ${s.etaMismatch}`);
  if (s.distOutOfRange) console.log(`  ✗ DIST_TOO_FAR (GPS): ${s.distOutOfRange}`);
  if (s.stopsWithoutCoord) console.log(`  ! stops manjkajo v GTFS: ${s.stopsWithoutCoord}`);
  if (s.stopsFetchFailed)  console.log(`  ! arrivals fetch failed: ${s.stopsFetchFailed}`);
  if (s.issues.length > 0) {
    console.log(`  Issues:`);
    for (const line of s.issues) console.log(line);
  }
}

async function main() {
  console.log(`=== OBA live sanity check ===`);
  console.log(`Base: ${OBA_BASE}`);
  console.log(`Poll: ${POLL_COUNT}× @ ${POLL_INTERVAL_MS / 1000}s (≈ ${(POLL_COUNT - 1) * POLL_INTERVAL_MS / 1000}s observation)`);
  console.log(`Tolerances: ETA diff ≤ ${ETA_DIFF_TOL_MIN} min, max ${MAX_METERS_PER_MIN} m/min for GPS buses`);

  const agg = {
    cycles: 0,
    totalVehicles: 0,
    totalGps: 0,
    okArrivalMatch: 0,
    notInArrivals: 0,
    etaMismatch: 0,
    distOutOfRange: 0,
  };

  for (let i = 0; i < POLL_COUNT; i++) {
    const r = await oneCycle(i + 1);
    printCycle(r);
    agg.cycles++;
    agg.totalVehicles += r.stats.vehicles;
    agg.totalGps += r.stats.gpsPredicted;
    agg.okArrivalMatch += r.stats.okArrivalMatch;
    agg.notInArrivals += r.stats.notInArrivals;
    agg.etaMismatch += r.stats.etaMismatch;
    agg.distOutOfRange += r.stats.distOutOfRange;
    if (i < POLL_COUNT - 1) await new Promise(res => setTimeout(res, POLL_INTERVAL_MS));
  }

  const total = agg.totalVehicles;
  const okPct = total > 0 ? (agg.okArrivalMatch / total * 100).toFixed(1) : '—';
  const healthy = agg.notInArrivals === 0 && agg.etaMismatch === 0 && agg.distOutOfRange === 0;

  console.log(`\n=== SUMMARY (${agg.cycles} cycles) ===`);
  console.log(`Vehicles observed: ${total} (GPS: ${agg.totalGps})`);
  console.log(`In arrivals (busCode match): ${agg.okArrivalMatch}/${total} (${okPct}%)`);
  console.log(`NOT_IN_ARRIVALS:  ${agg.notInArrivals}`);
  console.log(`ETA_DIFF >${ETA_DIFF_TOL_MIN}min:   ${agg.etaMismatch}`);
  console.log(`DIST_TOO_FAR:     ${agg.distOutOfRange}`);
  console.log(`Verdict: ${healthy ? '✓ HEALTHY' : '✗ ISSUES DETECTED'}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
