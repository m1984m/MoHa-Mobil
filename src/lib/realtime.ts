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
  arrivalTime: string; // "HH:MM"
  etaMin: number;
  busCode: string;
};

export async function fetchArrivalsForStopPoint(stopPointId: number): Promise<StopArrival[]> {
  const j = await fetchJSON(`/GetArrivalsForStopPoint?stopPointId=${stopPointId}`);
  const out: StopArrival[] = [];
  for (const a of j.ArrivalsForStopPoints ?? []) {
    out.push({
      lineId: a.LineId,
      lineCode: a.LineCode ?? '',
      headsign: a.LineDescription ?? '',
      arrivalTime: a.ArrivalTime ?? '',
      etaMin: a.ETAMin ?? 0,
      busCode: String(a.BusCode ?? ''),
    });
  }
  return out.sort((a, b) => a.etaMin - b.etaMin);
}

// Poll store — auto-refresh na zahtevo.
export type LiveState = { vehicles: LiveVehicle[]; updatedAt: number; error: string | null; loading: boolean };
export const liveVehicles: Writable<LiveState> = writable({ vehicles: [], updatedAt: 0, error: null, loading: false });

let pollTimer: ReturnType<typeof setInterval> | null = null;

export function startPolling(intervalMs = 12_000) {
  stopPolling();
  const tick = async () => {
    liveVehicles.update(s => ({ ...s, loading: true }));
    try {
      const vs = await fetchActiveVehicles();
      liveVehicles.set({ vehicles: vs, updatedAt: Date.now(), error: null, loading: false });
    } catch (e: any) {
      liveVehicles.update(s => ({ ...s, error: e?.message ?? String(e), loading: false }));
    }
  };
  tick();
  pollTimer = setInterval(tick, intervalMs);
}

export function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}
