// Live vozila + prihodi iz Marprom Trak8 OBA API.
// Base: https://vozniredi.marprom.si/OBA/  (odprto, brez auth)
// API nima CORS header-jev, zato pride skozi proxy (env VITE_OBA_PROXY).
// Privzeto se uporabi corsproxy.io. Za produkcijo priporočen lasten Cloudflare Worker (1 datoteka):
//   export default { fetch: (req) => {
//     const u = new URL(req.url); const t = u.searchParams.get('u');
//     const r = await fetch('https://vozniredi.marprom.si' + t);
//     return new Response(r.body, { headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }});
//   }}

import { writable, type Writable } from 'svelte/store';

const OBA_BASE = 'https://vozniredi.marprom.si/OBA';
const PROXY = (import.meta as any).env?.VITE_OBA_PROXY as string | undefined;

// Public proxy fallback chain. Če VITE_OBA_PROXY ni nastavljen, rotira skozi te ob
// napaki (429/5xx/network/timeout). Lasten proxy (env) pomeni, da ima user nadzor
// — no fallback, da ne pošiljamo potencialno občutljivih zahtev mimo njegovega endpointa.
const PUBLIC_PROXIES: Array<(u: string) => string> = [
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
];
let currentProxyIdx = 0;

function customProxyUrl(path: string): string {
  const full = OBA_BASE + path;
  if (!PROXY) return ''; // unreachable (klicni gate spodaj)
  if (PROXY.includes('{URL}')) return PROXY.replace('{URL}', encodeURIComponent(full));
  return PROXY.replace(/\/$/, '') + path;
}

function publicProxyUrl(idx: number, path: string): string {
  const full = OBA_BASE + path;
  return PUBLIC_PROXIES[idx](full);
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

async function fetchWithTimeout(u: string, ms: number): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(u, { cache: 'no-store', signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

async function fetchJSON(p: string): Promise<any> {
  // Custom proxy — no fallback. User ima svoj endpoint in nadzor.
  if (PROXY) {
    const r = await fetchWithTimeout(customProxyUrl(p), 8_000);
    if (!r.ok) throw new Error('OBA ' + r.status);
    return r.json();
  }

  // Public proxy: sticky trenutni, ob napaki rotiraj na naslednjega. En cikel (vsi
  // proxy-ji enkrat), nato throw. 4 s timeout per proxy — ne drži celega polla.
  let lastErr: any = null;
  for (let attempt = 0; attempt < PUBLIC_PROXIES.length; attempt++) {
    const idx = (currentProxyIdx + attempt) % PUBLIC_PROXIES.length;
    try {
      const r = await fetchWithTimeout(publicProxyUrl(idx, p), 4_000);
      if (!r.ok) { lastErr = new Error('OBA ' + r.status); throw lastErr; }
      if (idx !== currentProxyIdx) currentProxyIdx = idx;
      return await r.json();
    } catch (e) {
      lastErr = e;
      const nextIdx = (idx + 1) % PUBLIC_PROXIES.length;
      if (attempt < PUBLIC_PROXIES.length - 1) {
        // eslint-disable-next-line no-console
        console.warn(`[OBA] proxy ${idx} failed, switching to ${nextIdx}`);
        currentProxyIdx = nextIdx;
      }
    }
  }
  throw lastErr ?? new Error('OBA all proxies failed');
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
    // DelayMin iz API-ja je source of truth — ne prepiši vrednosti 0 ("točen").
    // Fallback kliče samo, če API ne vrne DelayMin (undefined/null), ne pa ko je 0.
    // Prej je imel bug: DelayMin === 0 je sprožil fallback, ki zaradi zaokroževanja
    // na minuto (nowMin, schedMin) lahko produciral ±1 min pri dejansko točnem busu.
    let delayMin: number;
    if (typeof a.DelayMin === 'number') {
      delayMin = a.DelayMin;
    } else {
      const schedMin = parseHHMMtoMin(a.ArrivalTime ?? '');
      delayMin = schedMin != null ? etaMin - (schedMin - nowMin) : 0;
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

// SmoothedVehicle ohranja isto obliko kot prej (obstoječi UI bere sm?.displayLat itd.),
// samo da displayLat/Lon = raw OBA GPS, bearing pa heading iz prev→cur snapshot-a.
// Prejšnja GTFS schedule + anchor interpolacija je odstranjena (v0.8.0) — povzročala
// je drift med ikono in dejansko OBA pozicijo, ko je bus odstopal od voznega reda.
export type SmoothedVehicle = { deviceId: number; displayLat: number; displayLon: number; bearing: number; moving: boolean };
export const smoothedVehicles: Writable<SmoothedVehicle[]> = writable([]);
// Sekunde od zadnjega uspešnega poll-a — za prikaz "svežine" v UI.
export const liveStaleSec: Writable<number> = writable(0);

type Snap = { lat: number; lon: number; at: number };
let prevSnap: Map<number, Snap> = new Map();
let curSnap: Map<number, Snap> = new Map();
let lastPollAt = 0;

const LAT_M_PER_DEG = 111320;
const LON_M_PER_DEG = 111320 * Math.cos(46.5 * Math.PI / 180); // ~76800 @ Maribor

// Heading iz prev→cur: atan2 nad metrskimi komponentami (ne deg, ker se
// razmerje lat:lon spači na 46.5°). Če je premik <5 m (GPS jitter / bus stoji),
// vrni undefined — ohrani prejšnji bearing, da ikona ne rotira naključno.
function bearingFromSnaps(prev: Snap, cur: Snap): number | undefined {
  const dxM = (cur.lon - prev.lon) * LON_M_PER_DEG;
  const dyM = (cur.lat - prev.lat) * LAT_M_PER_DEG;
  if (Math.hypot(dxM, dyM) < 5) return undefined;
  return (Math.atan2(dxM, dyM) * 180 / Math.PI + 360) % 360;
}

function snapshot(vs: LiveVehicle[]) {
  const now = Date.now();
  lastPollAt = now;
  prevSnap = new Map(curSnap);
  curSnap = new Map();
  for (const v of vs) {
    curSnap.set(v.deviceId, { lat: v.lat, lon: v.lon, at: now });
  }
  let movedCount = 0;
  for (const [id, cur] of curSnap) {
    const prev = prevSnap.get(id);
    if (!prev) continue;
    const dxM = (cur.lon - prev.lon) * LON_M_PER_DEG;
    const dyM = (cur.lat - prev.lat) * LAT_M_PER_DEG;
    if (Math.hypot(dxM, dyM) > 5) movedCount++;
  }
  if (prevSnap.size > 0) {
    // eslint-disable-next-line no-console
    console.log(`[OBA poll] vehicles=${vs.length} newGps=${movedCount}/${vs.length}`);
  }
}

// Posledni bearing per deviceId — ohranjen preko pollov, da ikona ne poskoči
// nazaj v "0°" ob mirovanju busa.
const bearingCache: Map<number, number> = new Map();

function populateRaw(vs: LiveVehicle[]) {
  const out: SmoothedVehicle[] = vs.map(v => {
    const cur = curSnap.get(v.deviceId);
    const prev = prevSnap.get(v.deviceId);
    let bearing = bearingCache.get(v.deviceId) ?? 0;
    let moving = false;
    if (prev && cur) {
      const b = bearingFromSnaps(prev, cur);
      if (b != null) { bearing = b; moving = true; bearingCache.set(v.deviceId, b); }
    }
    return {
      deviceId: v.deviceId,
      displayLat: v.lat,
      displayLon: v.lon,
      bearing,
      moving,
    };
  });
  smoothedVehicles.set(out);
  liveStaleSec.set(Math.max(0, Math.round((Date.now() - lastPollAt) / 1000)));
}

// Marprom GPS se v praksi posodablja ~60 s. 30 s poll = 2× oversampling za lov
// prve sveže pozicije v povprečju ~15 s po server update-u; 8 s bi bil wasteful.
let pollTimer: ReturnType<typeof setInterval> | null = null;

export function startPolling(intervalMs = 30_000) {
  stopPolling();
  const poll = async () => {
    liveVehicles.update(s => ({ ...s, loading: true }));
    try {
      const vs = await fetchActiveVehicles();
      snapshot(vs);
      liveVehicles.set({ vehicles: vs, updatedAt: Date.now(), error: null, loading: false });
      populateRaw(vs);
    } catch (e: any) {
      liveVehicles.update(s => ({ ...s, error: e?.message ?? String(e), loading: false }));
    }
  };
  poll();
  pollTimer = setInterval(poll, intervalMs);
}

export function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}
