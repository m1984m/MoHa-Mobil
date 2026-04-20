// Live vozila + prihodi iz Marprom Trak8 OBA API.
// Base: https://vozniredi.marprom.si/OBA/  (odprto, brez auth)
// API nima CORS header-jev, zato pride skozi proxy (env VITE_OBA_PROXY).
// Privzeto se uporabi corsproxy.io. Za produkcijo priporočen lasten Cloudflare Worker (1 datoteka):
//   export default { fetch: (req) => {
//     const u = new URL(req.url); const t = u.searchParams.get('u');
//     const r = await fetch('https://vozniredi.marprom.si' + t);
//     return new Response(r.body, { headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }});
//   }}

import { writable, get, type Writable } from 'svelte/store';
import { smoothVehicleMotion } from './settings';

const OBA_BASE = 'https://vozniredi.marprom.si/OBA';
const PROXY = (import.meta as any).env?.VITE_OBA_PROXY as string | undefined;

function url(path: string): string {
  const full = OBA_BASE + path;
  if (!PROXY) return `https://corsproxy.io/?url=${encodeURIComponent(full)}`;
  if (PROXY.includes('{URL}')) return PROXY.replace('{URL}', encodeURIComponent(full));
  return PROXY.replace(/\/$/, '') + path;
}

export type ObaLine = { LineId: number; Code: string; Description: string; Color: string };

export type LiveVehicle = {
  deviceId: number;
  busCode: string;          // št. vozila (npr. "158")
  lineId: number;
  routeId: number;
  lineCode: string;         // G1 / 1 / 2 ... (match z GTFS route_short_name)
  color: string;            // "#323033" (iz OBA Line)
  lat: number;
  lon: number;
  headsign: string;
  nextStopPointId: number | null;
  etaMin: number | null;
  predicted: boolean;       // true = ocenjeno (ne pravi GPS)
  direction: number;
};

export type LiveArrival = {
  stopPointId: number;
  routeId: number;
  headsign: string;
  delayMin: number;
  etaSec: number;
  predicted: boolean;
};

async function fetchJSON(p: string): Promise<any> {
  const r = await fetch(url(p), { cache: 'no-store' });
  if (!r.ok) throw new Error('OBA ' + r.status);
  return r.json();
}

let linesCache: Map<number, ObaLine> | null = null;
export async function loadLines(): Promise<Map<number, ObaLine>> {
  if (linesCache) return linesCache;
  const j = await fetchJSON('/GetLines');
  const m = new Map<number, ObaLine>();
  for (const l of j.Lines ?? []) {
    m.set(l.LineId, { LineId: l.LineId, Code: l.Code, Description: l.Description, Color: (l.Color || '').trim() });
  }
  linesCache = m;
  return m;
}

export async function fetchActiveVehicles(): Promise<LiveVehicle[]> {
  const [lines, j] = await Promise.all([loadLines(), fetchJSON('/GetActiveDeviceDetails')]);
  const out: LiveVehicle[] = [];
  for (const v of j.Vehicles ?? []) {
    const line = lines.get(v.LineId);
    out.push({
      deviceId: v.DeviceId,
      busCode: String(v.BusCode ?? ''),
      lineId: v.LineId,
      routeId: v.RouteId,
      lineCode: line?.Code ?? String(v.LineId),
      color: line?.Color || '#1A7DB8',
      lat: v.Lat,
      lon: v.Lon,
      headsign: v.DirectionDescription ?? '',
      nextStopPointId: v.NextStopPointId ?? null,
      etaMin: typeof v.ETA === 'number' ? v.ETA : null,
      predicted: !!v.Predicted,
      direction: v.Direction ?? 0,
    });
  }
  return out;
}

export type StopArrival = {
  lineId: number;
  lineCode: string;
  headsign: string;   // LineDescription (smer)
  arrivalTime: string; // "HH:MM" (ScheduledArrivalTime fallback)
  etaMin: number;
  busCode: string;
  predicted: boolean;  // true = GPS vozilo; false = po voznem redu
  delayMin: number;    // pozitivno = zamuda, negativno = prehitevanje; 0 = na voznem redu
};

function parseHHMMtoMin(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hm ?? '');
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export async function fetchArrivalsForStopPoint(stopPointId: number): Promise<StopArrival[]> {
  const j = await fetchJSON(`/GetArrivalsForStopPoint?stopPointId=${stopPointId}`);
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const out: StopArrival[] = [];
  for (const a of j.ArrivalsForStopPoints ?? []) {
    const etaMin = a.ETAMin ?? 0;
    // DelayMin iz API-ja, ali izpeljano iz razlike med ETA in voznim redom.
    let delayMin = typeof a.DelayMin === 'number' ? a.DelayMin : 0;
    if (delayMin === 0) {
      const schedMin = parseHHMMtoMin(a.ArrivalTime ?? '');
      if (schedMin != null) delayMin = etaMin - (schedMin - nowMin);
    }
    out.push({
      lineId: a.LineId,
      lineCode: a.LineCode ?? '',
      headsign: a.LineDescription ?? '',
      arrivalTime: a.ArrivalTime ?? '',
      etaMin,
      busCode: String(a.BusCode ?? ''),
      predicted: !!a.Predicted,
      delayMin,
    });
  }
  return out.sort((a, b) => a.etaMin - b.etaMin);
}

// Poll store — auto-refresh na zahtevo.
export type LiveState = { vehicles: LiveVehicle[]; updatedAt: number; error: string | null; loading: boolean };
export const liveVehicles: Writable<LiveState> = writable({ vehicles: [], updatedAt: 0, error: null, loading: false });

// Interpolirane pozicije za gladek prikaz med dvema poll-oma (RAF, ~60 fps).
// Ko je na voljo shape (polilinija linije), bus drsi vzdolž nje — ne v ravni črti čez zrak.
export type SmoothedVehicle = { deviceId: number; displayLat: number; displayLon: number; bearing: number; moving: boolean };
export const smoothedVehicles: Writable<SmoothedVehicle[]> = writable([]);
// Sekunde od zadnjega uspešnega poll-a — za prikaz "svežine" v UI.
export const liveStaleSec: Writable<number> = writable(0);

type Snap = { lat: number; lon: number; at: number; s?: number };
let prevSnap: Map<number, Snap> = new Map();
let curSnap: Map<number, Snap> = new Map();
let curVehicles: LiveVehicle[] = [];
let lastPollAt = 0;
let pollIntervalMs = 8_000;

// Per-vozilo shape polilinija (lahko pride od zunaj — MapScreen jo sestavi po vsakem poll-u
// iz GTFS match-a). Če polilinije ni, padec nazaj na linearno lerp med snapshoti.
// `cumLen` je v METRIH (lokalna Maribor projekcija ~46.5° lat), da lahko napredujemo pri
// realni hitrosti m/s. `pts` ostanejo [lat, lon] stopinje.
type PolyIndex = { pts: [number, number][]; cumLen: number[]; totalM: number };

// VehiclePath = shape + stop-by-stop časovnica iz GTFS voznega reda.
// S tem bus animiramo po schedule (napreduje tudi če OBA ne vrne novega GPS-a),
// OBA pa služi le kot anchor/korekcija (premakne offset, ko pride sveža pozicija).
export type VehiclePath = {
  shape: PolyIndex;
  stopSeq: { s: number; time: number }[];  // s=m od začetka shape, time=sec od polnoči
};

let vehiclePaths: Map<number, VehiclePath> = new Map();
// Anchor: zadnja ne-duplicirana GPS pozicija (s, clock sec-of-day) — iz nje
// računamo trajni offset od schedule.
type Anchor = { s: number; clockSec: number; lat: number; lon: number };
let anchors: Map<number, Anchor> = new Map();

const LAT_M_PER_DEG = 111320;
const LON_M_PER_DEG = 111320 * Math.cos(46.5 * Math.PI / 180); // ~76800 @ Maribor

function buildIndex(pts: [number, number][]): PolyIndex {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const dLat = (pts[i][0] - pts[i - 1][0]) * LAT_M_PER_DEG;
    const dLon = (pts[i][1] - pts[i - 1][1]) * LON_M_PER_DEG;
    cum.push(cum[i - 1] + Math.hypot(dLat, dLon));
  }
  return { pts, cumLen: cum, totalM: cum[cum.length - 1] };
}

// Projekcija točke na polilinijo; vrne kumulativno razdaljo (v metrih) od začetka
// polilinije do najbližje točke, in d2 (v stopinje²) za sanity threshold.
// Če je `preferNearS` podan, pri skoraj-enako-oddaljenih segmentih izberi tistega,
// čigar s je bližje preferenci. Reši duplicate-coord dvoumnost na krožnih
// shape-ih (G3: prva in zadnja točka imata iste koordinate → brez preferenca
// bi lahko projekcija skočila med 0 in totalM).
function projectToPoly(idx: PolyIndex, lat: number, lon: number, preferNearS?: number): { s: number; d2: number } {
  const { pts, cumLen } = idx;
  let bestS = 0, bestD = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1]; // deg
    const denom = dx * dx + dy * dy;
    const t = denom > 0 ? Math.max(0, Math.min(1, ((lat - a[0]) * dx + (lon - a[1]) * dy) / denom)) : 0;
    const px = a[0] + t * dx, py = a[1] + t * dy;
    const d2 = (px - lat) ** 2 + (py - lon) ** 2;
    if (d2 < bestD) {
      bestD = d2;
      const segM = cumLen[i + 1] - cumLen[i];
      bestS = cumLen[i] + t * segM;
    }
  }
  if (preferNearS == null) return { s: bestS, d2: bestD };
  // Drugi prehod: med segmenti v EPS (15 m) od best pobere tistega, čigar s je
  // najbližje preferenci. Ne-krožne trase tukaj ne dobijo alternative (d² razlike
  // so velike), zato so nespremenjene.
  const EPS = (15 / LAT_M_PER_DEG) ** 2;
  let bestDelta = Math.abs(bestS - preferNearS);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const denom = dx * dx + dy * dy;
    const t = denom > 0 ? Math.max(0, Math.min(1, ((lat - a[0]) * dx + (lon - a[1]) * dy) / denom)) : 0;
    const px = a[0] + t * dx, py = a[1] + t * dy;
    const d2 = (px - lat) ** 2 + (py - lon) ** 2;
    if (d2 > bestD + EPS) continue;
    const segM = cumLen[i + 1] - cumLen[i];
    const s = cumLen[i] + t * segM;
    const delta = Math.abs(s - preferNearS);
    if (delta < bestDelta) { bestDelta = delta; bestS = s; bestD = d2; }
  }
  return { s: bestS, d2: bestD };
}

function pointAtS(idx: PolyIndex, s: number): { lat: number; lon: number; bearing: number } {
  const { pts, cumLen } = idx;
  const total = cumLen[cumLen.length - 1];
  const target = Math.max(0, Math.min(total, s));
  let i = 0;
  while (i < cumLen.length - 1 && cumLen[i + 1] < target) i++;
  if (i >= pts.length - 1) {
    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2] ?? last;
    const b = (Math.atan2(last[1] - prev[1], last[0] - prev[0]) * 180 / Math.PI + 360) % 360;
    return { lat: last[0], lon: last[1], bearing: b };
  }
  const segLen = cumLen[i + 1] - cumLen[i];
  const frac = segLen > 0 ? (target - cumLen[i]) / segLen : 0;
  const lat = pts[i][0] + frac * (pts[i + 1][0] - pts[i][0]);
  const lon = pts[i][1] + frac * (pts[i + 1][1] - pts[i][1]);
  const bearing = (Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]) * 180 / Math.PI + 360) % 360;
  return { lat, lon, bearing };
}

export function setVehicleShapes(m: Map<number, [number, number][]>) {
  const next = new Map<number, PolyIndex>();
  for (const [id, pts] of m) if (pts.length >= 2) next.set(id, buildIndex(pts));
  // Posodobi samo shape-a; stopSeq ostane, če že obstaja
  const merged = new Map<number, VehiclePath>();
  for (const [id, shape] of next) {
    const prev = vehiclePaths.get(id);
    merged.set(id, { shape, stopSeq: prev?.stopSeq ?? [] });
  }
  vehiclePaths = merged;
}

// Nastavi kompleten path (shape + stopSeq) iz GTFS trip match-a.
// `trip` je trenutni GTFS trip za ta bus, `stopCoords` iz gtfs.stops.
export function setVehiclePaths(
  data: Map<number, { shapePts: [number, number][]; stops: { lat: number; lon: number; time: number }[] }>
) {
  const next = new Map<number, VehiclePath>();
  for (const [id, d] of data) {
    if (d.shapePts.length < 2 || d.stops.length < 2) continue;
    const shape = buildIndex(d.shapePts);
    const stopSeq: { s: number; time: number }[] = [];
    let lastS = 0;
    for (let i = 0; i < d.stops.length; i++) {
      const st = d.stops[i];
      // preferNearS = lastS sili projekcijo naprej; pri krožnih tripih zadnja
      // postaja (iste koordinate kot prva) preferira s ≈ totalM namesto 0.
      const { s } = projectToPoly(shape, st.lat, st.lon, lastS);
      // Monotono naraščajoče (projekcija včasih malo odplava nazaj).
      const sMono = Math.max(s, lastS);
      stopSeq.push({ s: sMono, time: st.time });
      lastS = sMono;
    }
    next.set(id, { shape, stopSeq });

    // Inicializiraj anchor takoj, če že imamo GPS snapshot — da animacija
    // začne že po prvem poll-u, ne čakamo na drugega.
    if (!anchors.has(id)) {
      const cur = curSnap.get(id);
      if (cur) {
        const { s, d2 } = projectToPoly(shape, cur.lat, cur.lon);
        if (Math.sqrt(d2) < 0.0008) {
          anchors.set(id, { s, clockSec: secOfDay(cur.at), lat: cur.lat, lon: cur.lon });
        }
      }
    }
  }
  vehiclePaths = next;
  // Počisti anchor-je za vozila, ki jih ni več.
  for (const k of [...anchors.keys()]) if (!next.has(k)) anchors.delete(k);
}

// Vrni pozicijo po voznem redu ob `clockSec` (sekunde od polnoči).
function scheduleS(path: VehiclePath, clockSec: number): number {
  const seq = path.stopSeq;
  if (seq.length === 0) return 0;
  if (clockSec <= seq[0].time) return seq[0].s;
  const last = seq[seq.length - 1];
  if (clockSec >= last.time) return last.s;
  // Bisection
  let lo = 0, hi = seq.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (seq[mid].time <= clockSec) lo = mid; else hi = mid;
  }
  const a = seq[lo], b = seq[hi];
  const dt = b.time - a.time;
  const frac = dt > 0 ? (clockSec - a.time) / dt : 0;
  return a.s + (b.s - a.s) * frac;
}

function secOfDay(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000;
}

function snapshot(vs: LiveVehicle[]) {
  const now = Date.now();
  lastPollAt = now;
  prevSnap = new Map(curSnap);
  curSnap = new Map();
  let movedCount = 0;
  for (const v of vs) {
    const snap: Snap = { lat: v.lat, lon: v.lon, at: now };
    const path = vehiclePaths.get(v.deviceId);
    // Anchor: osveži samo, če je GPS res nov (drugačen od shranjenega anchor-ja >15 m).
    // S tem se izognemo reset-u nazaj, ko OBA vrne isto cached pozicijo.
    const prevAnchor = anchors.get(v.deviceId);
    if (path) {
      // preferNearS = prevAnchor.s — prepreči teleport projekcije na krožnih
      // tripih (G3), kjer start-točka = end-točka polilinije.
      const { s, d2 } = projectToPoly(path.shape, v.lat, v.lon, prevAnchor?.s);
      // Sanity: bus mora biti <80 m od polilinije, da snap veljavni.
      if (Math.sqrt(d2) < 0.0008) snap.s = s;
    }
    curSnap.set(v.deviceId, snap);

    const movedFromAnchor = prevAnchor
      ? Math.hypot((v.lat - prevAnchor.lat) * LAT_M_PER_DEG, (v.lon - prevAnchor.lon) * LON_M_PER_DEG)
      : Infinity;
    if (path && snap.s != null && (movedFromAnchor > 15 || !prevAnchor)) {
      anchors.set(v.deviceId, { s: snap.s, clockSec: secOfDay(now), lat: v.lat, lon: v.lon });
      movedCount++;
    }
  }
  curVehicles = vs;
  if (prevSnap.size > 0) {
    // eslint-disable-next-line no-console
    console.log(`[OBA poll] vehicles=${vs.length} newGps=${movedCount}/${vs.length} paths=${vehiclePaths.size}`);
  }
}

function interpolate() {
  const now = Date.now();
  const nowSec = secOfDay(now);
  const out: SmoothedVehicle[] = curVehicles.map(v => {
    const cur = curSnap.get(v.deviceId);
    const path = vehiclePaths.get(v.deviceId);
    const anchor = anchors.get(v.deviceId);

    if (!cur) {
      return { deviceId: v.deviceId, displayLat: v.lat, displayLon: v.lon, bearing: 0, moving: false };
    }

    // Pot 1: hibrid — GTFS schedule + anchor offset iz OBA.
    // Bus napreduje po voznem redu (continuously), offset pa se prilagodi,
    // ko pride sveža OBA korekcija. Če OBA vrne isti GPS, anchor se ne zamenja,
    // a schedule progresa naprej — bus se vidno premika.
    if (path && path.stopSeq.length >= 2 && anchor) {
      const seq = path.stopSeq;
      const schedNow = scheduleS(path, nowSec);
      const schedAnchor = scheduleS(path, anchor.clockSec);
      const offset = anchor.s - schedAnchor;
      let s = schedNow + offset;

      // CAP po urniku (se premika s časom): schedB = prva postaja s time > nowSec.
      // Bus sme napredovati do schedB.s - 5; ne prehiteva več kot 1 segment naprej od
      // tega, kjer bi po voznem redu moral biti. Cap se avtomatično sprosti, ko
      // nowSec prečka schedB.time — bus nadaljuje v naslednji segment.
      let schedB = seq[seq.length - 1];
      for (const st of seq) {
        if (st.time > nowSec) { schedB = st; break; }
      }
      const cap = Math.max(anchor.s, schedB.s - 5);
      if (s > cap) s = cap;
      if (s < anchor.s) s = anchor.s; // nikoli nazaj od anchor-ja
      if (s < 0) s = 0;
      if (s > path.shape.totalM) s = path.shape.totalM;

      const p = pointAtS(path.shape, s);
      const inside = nowSec > seq[0].time && nowSec < seq[seq.length - 1].time;
      return { deviceId: v.deviceId, displayLat: p.lat, displayLon: p.lon, bearing: p.bearing, moving: inside };
    }

    // Pot 2: imamo shape + anchor, a brez stopSeq (starejši fallback): freeze na anchor.
    if (path && anchor) {
      const p = pointAtS(path.shape, anchor.s);
      return { deviceId: v.deviceId, displayLat: p.lat, displayLon: p.lon, bearing: p.bearing, moving: false };
    }

    // Pot 3: brez path-a — prikaži raw GPS.
    return { deviceId: v.deviceId, displayLat: cur.lat, displayLon: cur.lon, bearing: 0, moving: false };
  });
  smoothedVehicles.set(out);
  liveStaleSec.set(Math.max(0, Math.round((now - lastPollAt) / 1000)));
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
let rafId: number | null = null;
let motionUnsub: (() => void) | null = null;

function rafLoop() {
  interpolate();
  rafId = requestAnimationFrame(rafLoop);
}

// Raw prikaz: napolni smoothedVehicles z GPS pozicijami iz OBA brez interpolacije.
// Uporabimo, ko je smoothVehicleMotion=false — bus "skoči" vsakih 30 s na novo pozicijo.
function populateRaw(vs: LiveVehicle[]) {
  const out: SmoothedVehicle[] = vs.map(v => ({
    deviceId: v.deviceId,
    displayLat: v.lat,
    displayLon: v.lon,
    bearing: 0,
    moving: true,
  }));
  smoothedVehicles.set(out);
  liveStaleSec.set(Math.max(0, Math.round((Date.now() - lastPollAt) / 1000)));
}

// Marprom GPS se v praksi posodablja ~60 s. 30 s poll = 2× oversampling za lov
// prve sveže pozicije v povprečju ~15 s po server update-u; 8 s bi bil wasteful.
export function startPolling(intervalMs = 30_000) {
  stopPolling();
  pollIntervalMs = intervalMs;
  const poll = async () => {
    liveVehicles.update(s => ({ ...s, loading: true }));
    try {
      const vs = await fetchActiveVehicles();
      snapshot(vs);
      liveVehicles.set({ vehicles: vs, updatedAt: Date.now(), error: null, loading: false });
      if (!get(smoothVehicleMotion)) populateRaw(vs);
    } catch (e: any) {
      liveVehicles.update(s => ({ ...s, error: e?.message ?? String(e), loading: false }));
    }
  };
  poll();
  pollTimer = setInterval(poll, intervalMs);
  if (get(smoothVehicleMotion)) rafId = requestAnimationFrame(rafLoop);

  // Dinamičen preklop stikala v Nastavitvah med živim polling-om:
  //  - ON (in polling aktiven): startaj RAF loop, preplavi smoothedVehicles z interpolacijo
  //  - OFF: ustavi RAF in takoj napolni raw iz trenutnih vozil
  motionUnsub = smoothVehicleMotion.subscribe(on => {
    if (pollTimer == null) return; // prvi initial call pride ko še ni pollerja — preskoči
    if (on && rafId == null) {
      rafId = requestAnimationFrame(rafLoop);
    } else if (!on && rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
      populateRaw(curVehicles);
    }
  });
}

export function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
  if (motionUnsub) { motionUnsub(); motionUnsub = null; }
}
