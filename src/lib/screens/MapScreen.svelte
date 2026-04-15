<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { Navigation, X, Star, Clock, Footprints, Bus, Flame, Leaf, Share2, CalendarClock, ListOrdered } from 'lucide-svelte';
  import StopTimetableModal from './StopTimetableModal.svelte';
  import LineTimetableModal from './LineTimetableModal.svelte';
  import MapView from '../MapView.svelte';
  import BottomSheet from '../BottomSheet.svelte';
  import LineBadge from '../ui/LineBadge.svelte';
  import LiveDot from '../ui/LiveDot.svelte';
  import { upcomingDepartures, loadShapes, shapesForStop, routeColor, type GTFS, type Shape, type Stop } from '../gtfs';
  import { activeVehicles, type Vehicle } from '../vehicles';
  import type { Plan } from '../planner';
  import { favStops } from '../favorites';
  import { liveVehicles, startPolling, stopPolling, fetchArrivalsForStopPoint, type LiveVehicle, type StopArrival } from '../realtime';
  import { mapStyleKind } from '../settings';
  import { savedRoutes } from '../savedRoutes';

  export let gtfs: GTFS | null;
  export let origin: { lat: number; lon: number };
  export let hasGeo: boolean;
  export let selectedStop: Stop | null = null;
  export let activePlan: { plan: Plan; geoms: { kind: 'walk' | 'bus'; coords: [number, number][]; color: string }[]; from: { lat: number; lon: number; name: string }; to: { lat: number; lon: number; name: string } } | null = null;
  export let onStopChange: (s: Stop | null) => void;
  export let onClearPlan: () => void;
  export let onOpenPlanner: () => void;
  export let onLongPressDest: (lat: number, lon: number) => void;

  let mapRef: any;
  let sheetRef: any;
  let shapesMap: Map<number, Shape> | null = null;
  let activeShapes: (Shape & { color: string })[] = [];
  let synthVehicles: Vehicle[] = [];
  let vehicleTimer: ReturnType<typeof setInterval> | null = null;
  let selectedVehicle: Vehicle | null = null;
  let selectedLive: LiveVehicle | null = null;
  let liveArrivals: StopArrival[] = [];
  let liveArrivalsLoading = false;
  let liveArrivalsTimer: ReturnType<typeof setInterval> | null = null;
  let planExpanded = false;
  let stopTimetableOpen = false;
  let lineTimetableOpen = false;
  let lineTimetableRoute: any = null;
  let lineTimetableDir = 0;

  function openLineTimetable(route: any, dir = 0) {
    lineTimetableRoute = route;
    lineTimetableDir = dir;
    lineTimetableOpen = true;
  }
  let tick30 = 0;
  let tick30Timer: ReturnType<typeof setInterval> | null = null;

  onMount(async () => {
    shapesMap = await loadShapes();
    refreshSynth();
    vehicleTimer = setInterval(refreshSynth, 10_000);
    tick30Timer = setInterval(() => tick30++, 30_000);
    startPolling(12_000);
  });
  onDestroy(() => {
    if (vehicleTimer) clearInterval(vehicleTimer);
    if (tick30Timer) clearInterval(tick30Timer);
    if (liveArrivalsTimer) clearInterval(liveArrivalsTimer);
    stopPolling();
  });

  async function refreshArrivals(stopId: number) {
    liveArrivalsLoading = liveArrivals.length === 0;
    try {
      const arr = await fetchArrivalsForStopPoint(stopId);
      if (selectedStop?.id === stopId) liveArrivals = arr;
    } catch {
      // GTFS fallback stays visible
    } finally {
      liveArrivalsLoading = false;
    }
  }

  function refreshSynth() {
    if (!gtfs || !shapesMap) return;
    synthVehicles = activeVehicles(gtfs, shapesMap, new Date());
  }

  // Real vozila iz Marprom Trak8 OBA (vsakih 12s). Fallback = sintetična iz GTFS voznega reda.
  $: live = $liveVehicles;
  $: routeIdByShort = gtfs
    ? new Map(gtfs.routes.map(r => [r.short.toLowerCase(), r.id]))
    : new Map<string, number>();
  $: liveDisplay = live.vehicles.map(v => {
    const gtfsRouteId = routeIdByShort.get(v.lineCode.toLowerCase());
    return {
      tripId: v.deviceId,
      routeId: gtfsRouteId ?? v.routeId,
      routeShort: v.lineCode,
      headsign: v.headsign,
      lat: v.lat, lon: v.lon, bearing: 0,
      color: gtfsRouteId != null ? routeColor(gtfsRouteId) : v.color,
      nextStopId: v.nextStopPointId ?? -1,
      dwelling: false,
    } as Vehicle;
  });
  $: vehicles = live.vehicles.length > 0 ? liveDisplay : synthVehicles;
  $: isLive = live.vehicles.length > 0 && !live.error;

  // React to incoming selectedStop / activePlan
  $: handleStopChange(selectedStop);
  async function handleStopChange(s: Stop | null) {
    if (liveArrivalsTimer) { clearInterval(liveArrivalsTimer); liveArrivalsTimer = null; }
    liveArrivals = [];
    if (s) {
      selectedVehicle = null;
      await tick();
      mapRef?.flyTo(s.lat, s.lon, 16);
      sheetRef?.setSnap(1);
      refreshArrivals(s.id);
      liveArrivalsTimer = setInterval(() => refreshArrivals(s.id), 15_000);
      if (!gtfs) return;
      const combos = shapesForStop(gtfs, s.id);
      const shMap = await loadShapes();
      activeShapes = combos
        .map(c => { const sh = shMap.get(c.shape); return sh ? { ...sh, color: routeColor(c.route) } : null; })
        .filter((x): x is Shape & { color: string } => !!x);
    } else {
      activeShapes = [];
      sheetRef?.setSnap(0);
    }
  }

  $: if (activePlan) {
    requestAnimationFrame(() => {
      const all = activePlan!.geoms.flatMap(g => g.coords);
      if (all.length) mapRef?.fitBounds(all);
      sheetRef?.setSnap(0);
    });
    selectedVehicle = null;
    planExpanded = false;
    onStopChange(null);
  }

  function onVehicleTap(idx: number) {
    const v = shownVehicles[idx];
    if (!v) return;
    selectedVehicle = v;
    selectedLive = isLive ? (live.vehicles.find(lv => lv.deviceId === v.tripId) ?? null) : null;
    onStopChange(null);
    mapRef?.flyTo(v.lat, v.lon, 16);
    sheetRef?.setSnap(1);
  }
  function closeVehicle() { selectedVehicle = null; selectedLive = null; sheetRef?.setSnap(0); }

  function onMapLongPress(lat: number, lon: number) {
    if ('vibrate' in navigator) navigator.vibrate(25);
    onLongPressDest(lat, lon);
  }

  // Filter vehicles (match by routeShort → deluje za sintetične in žive vozila)
  $: selectedRouteShorts = gtfs && selectedStop
    ? new Set(shapesForStop(gtfs, selectedStop.id).map(c => gtfs.routes.find(r => r.id === c.route)?.short).filter(Boolean) as string[])
    : null;
  $: shownVehicles = selectedRouteShorts
    ? vehicles.filter(v => selectedRouteShorts!.has(v.routeShort))
    : selectedVehicle
      ? vehicles.filter(v => v.tripId === selectedVehicle!.tripId)
      : vehicles;

  $: departures = (tick30, gtfs && selectedStop) ? upcomingDepartures(gtfs!, selectedStop.id, new Date(), 4) : [];
  $: nextWait = liveArrivals.length > 0
    ? liveArrivals[0].etaMin
    : (departures[0]?.minutesFromNow ?? null);
  $: isFav = selectedStop ? $favStops.has(selectedStop.id) : false;

  // Vehicle trip info
  $: planSummary = activePlan ? (() => {
    const walkM = activePlan.plan.legs.reduce((a, l) => a + (l.kind === 'walk' ? l.meters : 0), 0);
    // Car-equivalent razdalja (detour factor 1.3 nad zračno linijo)
    const driveKm = haversineM(activePlan.from.lat, activePlan.from.lon, activePlan.to.lat, activePlan.to.lon) * 1.3 / 1000;
    return {
      transfers: activePlan.plan.transfers ?? Math.max(0, activePlan.plan.legs.filter(l => l.kind === 'bus').length - 1),
      walkM,
      walkMin: Math.round(activePlan.plan.legs.reduce((a, l) => a + (l.kind === 'walk' ? l.sec : 0), 0) / 60),
      rideMin: Math.round(activePlan.plan.legs.reduce((a, l) => a + (l.kind === 'bus' ? (l.arrSec - l.depSec) : 0), 0) / 60),
      busCount: activePlan.plan.legs.filter(l => l.kind === 'bus').length,
      kcal: Math.round((walkM / 1000) * 50),       // ~50 kcal/km za počasno hojo (2 km/h)
      co2SavedKg: Math.round(driveKm * 0.150 * 10) / 10, // 150 g/km → kg, 1 decimalka
      driveKm: Math.round(driveKm * 10) / 10,
    };
  })() : { transfers: 0, walkM: 0, walkMin: 0, rideMin: 0, busCount: 0, kcal: 0, co2SavedKg: 0, driveKm: 0 };

  function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const toRad = (x: number) => (x * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  $: vehTrip = gtfs && selectedVehicle ? gtfs.trips.find(t => t.id === selectedVehicle!.tripId) : null;
  $: vehNextStops = (() => {
    if (!gtfs || !selectedVehicle || !vehTrip) return [];
    const nowSec = new Date().getHours() * 3600 + new Date().getMinutes() * 60 + new Date().getSeconds();
    const stopById = new Map(gtfs.stops.map(s => [s.id, s]));
    const idx = vehTrip.stops.findIndex(st => st[0] === selectedVehicle!.nextStopId);
    if (idx < 0) return [];
    return vehTrip.stops.slice(idx, idx + 8).map(st => ({
      stop: stopById.get(st[0])!,
      arr: st[1],
      minutes: Math.max(0, Math.round((st[1] - nowSec) / 60)),
    }));
  })();

  function fmtTime(sec: number) {
    const h = Math.floor(sec / 3600) % 24;
    const m = Math.floor((sec % 3600) / 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  function fmtDur(sec: number) {
    const m = Math.round(sec / 60);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    return r === 0 ? `${h} h` : `${h} h ${r} min`;
  }
  function sameCoord(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
    return Math.abs(a.lat - b.lat) < 0.0001 && Math.abs(a.lon - b.lon) < 0.0001;
  }
  $: isPlanSaved = activePlan
    ? $savedRoutes.some(r => sameCoord(r.from, activePlan!.from) && sameCoord(r.to, activePlan!.to))
    : false;

  let saveToast = '';
  let saveToastTimer: ReturnType<typeof setTimeout> | null = null;
  function flashToast(msg: string) {
    saveToast = msg;
    if (saveToastTimer) clearTimeout(saveToastTimer);
    saveToastTimer = setTimeout(() => saveToast = '', 2200);
  }
  function savePlan() {
    if (!activePlan) return;
    const match = $savedRoutes.find(r => sameCoord(r.from, activePlan!.from) && sameCoord(r.to, activePlan!.to));
    if (match) {
      savedRoutes.remove(match.id);
      flashToast('Pot odstranjena iz priljubljenih');
      return;
    }
    const label = `${activePlan.from.name} → ${activePlan.to.name}`;
    savedRoutes.add({ label, from: activePlan.from, to: activePlan.to });
    flashToast('Pot shranjena med priljubljene');
  }

  let shareDialogOpen = false;
  let shareText = '';
  let shareUrl = '';

  function buildShareInfo(): { title: string; text: string; url: string } {
    const f = activePlan!.from, t = activePlan!.to;
    const url = `${location.origin}${location.pathname}?from=${f.lat.toFixed(5)},${f.lon.toFixed(5)},${encodeURIComponent(f.name)}&to=${t.lat.toFixed(5)},${t.lon.toFixed(5)},${encodeURIComponent(t.name)}`;
    const title = `Pot: ${f.name} → ${t.name}`;
    const lines: string[] = [];
    lines.push(`${f.name} → ${t.name}`);
    lines.push(`Odhod ${fmtTime(activePlan!.plan.depSec)} · prihod ${fmtTime(activePlan!.plan.arrSec)} (${fmtDur(activePlan!.plan.arrSec - activePlan!.plan.depSec)})`);
    const busShorts = activePlan!.plan.legs.filter(l => l.kind === 'bus').map((l: any) => l.route.short);
    if (busShorts.length > 0) lines.push(`Linije: ${busShorts.join(' → ')}`);
    if (planSummary.transfers > 0) lines.push(`Prestopi: ${planSummary.transfers}`);
    if (planSummary.walkMin > 0) lines.push(`Hoja: ${planSummary.walkMin} min (${Math.round(planSummary.walkM)} m)`);
    lines.push('');
    lines.push(`Odpri v MoHa Mobil: ${url}`);
    return { title, text: lines.join('\n'), url };
  }

  async function sharePlan() {
    if (!activePlan) return;
    const info = buildShareInfo();
    const nav: any = navigator;
    if (nav.share) {
      try {
        await nav.share({ title: info.title, text: info.text, url: info.url });
        return;
      } catch (e: any) {
        if (e && e.name === 'AbortError') return;
      }
    }
    shareText = info.text;
    shareUrl = info.url;
    shareDialogOpen = true;
  }

  async function copyShare(what: 'text' | 'url') {
    const value = what === 'text' ? shareText : shareUrl;
    const nav: any = navigator;
    try {
      if (nav.clipboard?.writeText) {
        await nav.clipboard.writeText(value);
        flashToast(what === 'url' ? 'Povezava kopirana' : 'Besedilo kopirano');
        return;
      }
    } catch {}
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      flashToast(ok ? 'Kopirano' : 'Kopiranje ni uspelo');
    } catch {
      flashToast('Kopiranje ni uspelo');
    }
  }

  function waitLabel(m: number | null): string {
    if (m === null) return 'Danes ni več odhodov';
    if (m <= 0) return 'Avtobus prihaja zdaj';
    if (m === 1) return 'Naslednji avtobus čez 1 minuto';
    if (m < 5) return `Naslednji avtobus čez ${m} minute`;
    if (m < 60) return `Naslednji avtobus čez ${m} minut`;
    const h = Math.floor(m / 60), r = m % 60;
    return r === 0 ? `Naslednji avtobus čez ${h} h` : `Čez ${h} h ${r} min`;
  }
</script>

<div class="absolute inset-0">
  <MapView bind:this={mapRef}
    stops={gtfs?.stops ?? []}
    user={hasGeo ? origin : null}
    selectedId={selectedStop?.id ?? null}
    nearbyIds={[]}
    shapes={activePlan ? [] : activeShapes}
    planLegs={activePlan?.geoms ?? []}
    planEndpoints={activePlan ? [
      { lat: activePlan.from.lat, lon: activePlan.from.lon, kind: 'origin' as const },
      { lat: activePlan.to.lat, lon: activePlan.to.lon, kind: 'dest' as const },
    ] : []}
    vehicles={shownVehicles}
    mapStyle={$mapStyleKind}
    onStopTap={(s) => onStopChange(s)}
    onMapTap={() => {}}
    onMapLongPress={onMapLongPress}
    onVehicleTap={onVehicleTap} />

  <!-- Active plan floating card (expands inline) -->
  {#if activePlan}
    <div class="absolute left-0 right-0 px-4 z-30"
         style="top: calc(env(safe-area-inset-top) + 0.75rem); max-height: calc(100dvh - env(safe-area-inset-top) - 6.5rem);">
      <div class="surface rounded-2xl border border-base shadow-elev overflow-hidden max-w-screen-sm mx-auto flex flex-col"
           style="max-height: calc(100dvh - env(safe-area-inset-top) - 6.5rem);">
        <div class="flex items-stretch shrink-0">
          <div class="pressable flex-1 min-w-0 text-left px-4 py-3 cursor-pointer"
               on:click={() => planExpanded = !planExpanded}
               on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') planExpanded = !planExpanded; }}
               role="button" tabindex="0"
               aria-label="Pokaži podrobnosti">
            <div class="flex items-start gap-3">
              <div class="min-w-0 flex-1">
                <div class="t-footnote text-muted truncate">{activePlan.from.name} → {activePlan.to.name}</div>
                <div class="t-title3 font-semibold">{fmtDur(activePlan.plan.arrSec - activePlan.plan.depSec)} · prihod {fmtTime(activePlan.plan.arrSec)}</div>
                <div class="t-footnote text-muted mt-0.5">
                  {#if planSummary.transfers === 0}brez prestopanja{:else if planSummary.transfers === 1}1 prestop{:else}{planSummary.transfers} prestopov{/if}
                  {#if planSummary.walkMin > 0} · {planSummary.walkMin} min peš ({Math.round(planSummary.walkM)} m){/if}
                </div>
              </div>
              <div class="shrink-0 self-center transition-transform" style="transform: rotate({planExpanded ? 180 : 0}deg)">
                <span class="t-title3 text-muted">⌄</span>
              </div>
            </div>
            <div class="flex items-center gap-1.5 flex-wrap mt-2">
              {#each activePlan.plan.legs as leg, i}
                {#if i > 0}<span class="text-muted">›</span>{/if}
                {#if leg.kind === 'walk'}
                  <span class="inline-flex items-center gap-1 px-2 h-7 rounded-lg surface-2 t-footnote">
                    <Footprints size={14} /> {Math.round(leg.sec / 60)}′
                  </span>
                {:else}
                  <LineBadge short={leg.route.short} routeId={leg.route.id} size="sm" />
                {/if}
              {/each}
            </div>
          </div>
          <div class="flex flex-col border-l border-base shrink-0 w-12" style="touch-action: manipulation;">
            <button type="button"
                    class="flex-1 min-h-[44px] grid place-items-center border-b border-base"
                    style="touch-action: manipulation; -webkit-tap-highlight-color: rgba(0,0,0,0.08);"
                    on:click|stopPropagation={onClearPlan}
                    aria-label="Počisti pot">
              <X size={18} />
            </button>
            <button type="button"
                    class="flex-1 min-h-[44px] grid place-items-center"
                    style="touch-action: manipulation; -webkit-tap-highlight-color: rgba(0,0,0,0.08);"
                    on:click|stopPropagation={savePlan}
                    aria-label={isPlanSaved ? 'Odstrani shranjeno pot' : 'Shrani pot'}>
              {#key isPlanSaved}
                <Star size={18}
                      fill={isPlanSaved ? 'var(--status-delay)' : 'none'}
                      color={isPlanSaved ? 'var(--status-delay)' : 'var(--text-muted)'} />
              {/key}
            </button>
          </div>
        </div>

        {#if planExpanded}
          <div class="border-t border-base overflow-y-auto scrollbox" style="flex: 1 1 auto;">
            <div class="p-4">
              <div class="rounded-2xl p-4 mb-4"
                   style="background: linear-gradient(135deg, var(--surface-2), var(--surface-3));">
                <div class="flex items-baseline gap-2">
                  <div class="t-title1 font-bold">{fmtTime(activePlan.plan.depSec)}</div>
                  <div class="t-callout text-muted">→</div>
                  <div class="t-title1 font-bold">{fmtTime(activePlan.plan.arrSec)}</div>
                  <div class="ml-auto t-callout font-semibold" style="color: var(--accent)">{fmtDur(activePlan.plan.arrSec - activePlan.plan.depSec)}</div>
                </div>
                <div class="grid grid-cols-3 gap-2 mt-3">
                  <div class="text-center">
                    <div class="t-title3 font-bold">{planSummary.transfers}</div>
                    <div class="t-footnote text-muted">{planSummary.transfers === 1 ? 'prestop' : 'prestopov'}</div>
                  </div>
                  <div class="text-center">
                    <div class="t-title3 font-bold">{planSummary.walkMin}′</div>
                    <div class="t-footnote text-muted">peš · {Math.round(planSummary.walkM)} m</div>
                  </div>
                  <div class="text-center">
                    <div class="t-title3 font-bold">{planSummary.rideMin}′</div>
                    <div class="t-footnote text-muted">vožnja</div>
                  </div>
                </div>
              </div>

              <div class="grid grid-cols-2 gap-3 mb-4">
                <div class="rounded-2xl p-3 flex items-center gap-3"
                     style="background: linear-gradient(135deg, rgba(255,149,0,0.12), rgba(255,149,0,0.04));">
                  <div class="w-10 h-10 rounded-xl grid place-items-center" style="background: var(--status-delay); color: white;">
                    <Flame size={18} />
                  </div>
                  <div class="min-w-0">
                    <div class="t-footnote text-muted">Porabil(a) si</div>
                    <div class="t-title3 font-bold">{planSummary.kcal} kcal</div>
                  </div>
                </div>
                <div class="rounded-2xl p-3 flex items-center gap-3"
                     style="background: linear-gradient(135deg, rgba(52,199,89,0.12), rgba(52,199,89,0.04));">
                  <div class="w-10 h-10 rounded-xl grid place-items-center" style="background: var(--status-ontime); color: white;">
                    <Leaf size={18} />
                  </div>
                  <div class="min-w-0">
                    <div class="t-footnote text-muted">Prihranek CO₂</div>
                    <div class="t-title3 font-bold">{planSummary.co2SavedKg} kg</div>
                  </div>
                </div>
              </div>
              <div class="t-footnote text-muted px-1 mb-3">
                Razdalja z avtom je ~{planSummary.driveKm} km.
              </div>

              <button type="button"
                      class="pressable w-full h-11 rounded-xl surface-2 border border-base mb-4 flex items-center justify-center gap-2"
                      on:click|stopPropagation={sharePlan}>
                <Share2 size={16} />
                <span class="t-callout font-medium">Deli pot</span>
              </button>

              <div class="t-footnote text-muted uppercase tracking-wide mb-2">Koraki</div>
              <ul class="surface rounded-2xl border border-base overflow-hidden shadow-card">
                {#each activePlan.plan.legs as leg, i}
                  <li class="px-4 py-3 flex items-start gap-3 {i > 0 ? 'border-t border-base' : ''}">
                    {#if leg.kind === 'walk'}
                      <div class="w-10 h-10 rounded-xl surface-2 grid place-items-center shrink-0">
                        <Footprints size={18} />
                      </div>
                      <div class="flex-1 min-w-0">
                        <div class="t-callout font-medium">Hoja · {Math.round(leg.meters)} m</div>
                        <div class="t-footnote text-muted">
                          {#if leg.fromStop && leg.toStop}{leg.fromStop.name} → {leg.toStop.name}
                          {:else if leg.toStop}do {leg.toStop.name}
                          {:else if leg.fromStop}od {leg.fromStop.name}{/if}
                        </div>
                      </div>
                      <div class="t-footnote text-muted">{fmtDur(leg.sec)}</div>
                    {:else}
                      <div class="shrink-0"><LineBadge short={leg.route.short} routeId={leg.route.id} size="md" /></div>
                      <div class="flex-1 min-w-0">
                        <div class="t-callout font-medium truncate">→ {leg.headsign}</div>
                        <div class="t-footnote text-muted truncate">{leg.from.name} · {fmtTime(leg.depSec)} → {leg.to.name} · {fmtTime(leg.arrSec)}</div>
                      </div>
                      <div class="t-footnote text-muted">{leg.stopCount}×</div>
                    {/if}
                  </li>
                {/each}
              </ul>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Live indicator -->
  {#if !activePlan}
    <div class="absolute z-20 left-1/2 -translate-x-1/2 pointer-events-none"
         style="top: calc(env(safe-area-inset-top) + 0.75rem)">
      <div class="surface rounded-full border border-base shadow-card px-3 h-8 flex items-center gap-2">
        <span class="w-2 h-2 rounded-full"
              style="background: {isLive ? 'var(--status-ontime)' : 'var(--status-delay)'}"></span>
        <span class="t-footnote" style="color: var(--text-muted)">
          {isLive ? `${live.vehicles.length} vozil v živo` : (live.loading ? 'Povezovanje…' : (live.error ? 'Offline · po voznem redu' : 'Po voznem redu'))}
        </span>
      </div>
    </div>
  {/if}

  <!-- FAB: plan -->
  {#if !activePlan && !selectedStop && !selectedVehicle}
    <button class="pressable absolute z-30 right-4 h-14 px-5 rounded-full bg-accent text-white t-headline shadow-float flex items-center gap-2"
            style="bottom: calc(env(safe-area-inset-bottom) + 5.5rem)"
            on:click={onOpenPlanner}>
      <Navigation size={18} />
      Pot
    </button>
  {/if}

  <!-- Recenter -->
  {#if hasGeo && !activePlan}
    <button class="pressable absolute z-30 left-4 w-11 h-11 rounded-full surface border border-base shadow-card grid place-items-center"
            style="bottom: calc(env(safe-area-inset-bottom) + 5.5rem)"
            on:click={() => mapRef?.flyTo(origin.lat, origin.lon, 15)}
            aria-label="Moja lokacija">
      <Navigation size={18} color="var(--accent)" />
    </button>
  {/if}

  <!-- Contextual bottom sheet -->
  <BottomSheet bind:this={sheetRef} snaps={[0.0, 0.50, 0.92]} snapIndex={0}>
    <div class="px-4 pb-28 max-w-screen-sm mx-auto">

      {#if selectedStop}
        <div class="flex items-start justify-between gap-3 mb-3">
          <div class="min-w-0">
            <div class="t-footnote text-muted uppercase tracking-wide">Postaja</div>
            <h2 class="t-title2 font-semibold truncate">{selectedStop.name}</h2>
            {#if selectedStop.code}<div class="t-footnote text-muted">{selectedStop.code}</div>{/if}
          </div>
          <div class="flex items-center gap-2">
            <button class="pressable w-10 h-10 rounded-full surface-2 grid place-items-center"
                    on:click={() => stopTimetableOpen = true}
                    aria-label="Vozni red postaje">
              <CalendarClock size={18} />
            </button>
            <button class="pressable w-10 h-10 rounded-full surface-2 grid place-items-center"
                    on:click={() => favStops.toggle(selectedStop!.id)}
                    aria-label={isFav ? 'Odstrani iz priljubljenih' : 'Dodaj med priljubljena'}>
              <Star size={18} fill={isFav ? 'var(--status-delay)' : 'none'} color={isFav ? 'var(--status-delay)' : 'var(--text-muted)'} />
            </button>
            <button class="pressable w-10 h-10 rounded-full surface-2 grid place-items-center" on:click={() => onStopChange(null)} aria-label="Zapri">
              <X size={18} />
            </button>
          </div>
        </div>

        <div class="rounded-2xl p-4 flex items-center gap-3 mb-4"
             style="background: linear-gradient(135deg, var(--surface-2), var(--surface-3));">
          <div class="w-11 h-11 rounded-xl grid place-items-center" style="background: var(--accent); color: white;">
            <Clock size={20} />
          </div>
          <div class="flex-1 min-w-0">
            <div class="t-footnote text-muted">Čakanje</div>
            <div class="t-headline font-semibold">{waitLabel(nextWait)}</div>
          </div>
        </div>

        <div class="flex items-center justify-between mb-2">
          <div class="t-footnote text-muted uppercase tracking-wide">Naslednji odhodi</div>
          <LiveDot label={liveArrivals.length > 0 ? 'V živo' : 'Po voznem redu'} />
        </div>
        {#if liveArrivals.length > 0}
          <ul class="surface rounded-2xl border border-base overflow-hidden shadow-card">
            {#each liveArrivals.slice(0, 6) as a, i}
              {@const gtfsRoute = gtfs?.routes.find(r => r.short.toLowerCase() === a.lineCode.toLowerCase())}
              <li class="px-4 py-3 flex items-center gap-3 {i > 0 ? 'border-t border-base' : ''}">
                <button class="pressable" on:click={() => gtfsRoute && openLineTimetable(gtfsRoute, 0)} aria-label="Vozni red linije {a.lineCode}">
                  <LineBadge short={a.lineCode} routeId={gtfsRoute?.id ?? a.lineId} size="md" />
                </button>
                <div class="flex-1 min-w-0">
                  <div class="t-callout font-medium truncate">{a.headsign}</div>
                  <div class="t-footnote text-muted">{a.arrivalTime}{a.busCode ? ` · bus #${a.busCode}` : ''}</div>
                </div>
                <div class="text-right leading-none">
                  {#if a.etaMin <= 0}
                    <span class="t-title3 font-bold" style="color: var(--status-ontime)">zdaj</span>
                  {:else}
                    <span class="t-title1 font-bold">{a.etaMin}</span>
                    <span class="t-footnote text-muted ml-0.5">min</span>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        {:else if liveArrivalsLoading}
          <div class="surface-2 rounded-2xl p-4 t-callout text-muted">Nalagam žive prihode…</div>
        {:else if departures.length === 0}
          <div class="surface-2 rounded-2xl p-4 t-callout text-muted">Danes ni več odhodov s te postaje.</div>
        {:else}
          <ul class="surface rounded-2xl border border-base overflow-hidden shadow-card">
            {#each departures as d, i}
              <li class="px-4 py-3 flex items-center gap-3 {i > 0 ? 'border-t border-base' : ''}">
                <button class="pressable" on:click={() => openLineTimetable(d.route, d.trip.dir)} aria-label="Vozni red linije {d.route.short}">
                  <LineBadge short={d.route.short} routeId={d.route.id} size="md" />
                </button>
                <div class="flex-1 min-w-0">
                  <div class="t-callout font-medium truncate">{d.trip.headsign}</div>
                  <div class="t-footnote text-muted">{fmtTime(d.depSec)}</div>
                </div>
                <div class="text-right leading-none">
                  {#if d.minutesFromNow <= 0}
                    <span class="t-title3 font-bold" style="color: var(--status-ontime)">zdaj</span>
                  {:else}
                    <span class="t-title1 font-bold">{d.minutesFromNow}</span>
                    <span class="t-footnote text-muted ml-0.5">min</span>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}

      {:else if selectedVehicle}
        <div class="flex items-start justify-between gap-3 mb-3">
          <div class="flex items-center gap-3 min-w-0">
            <LineBadge short={selectedVehicle.routeShort} routeId={selectedVehicle.routeId} size="lg" />
            <div class="min-w-0">
              <div class="t-footnote text-muted uppercase tracking-wide flex items-center gap-1.5">
                Avtobus
                {#if selectedLive}<span class="t-footnote" style="color: var(--text-muted)">#{selectedLive.busCode}</span>{/if}
              </div>
              <div class="t-title3 font-semibold truncate">→ {selectedVehicle.headsign}</div>
            </div>
          </div>
          <button class="pressable w-10 h-10 rounded-full surface-2 grid place-items-center" on:click={closeVehicle}>
            <X size={18} />
          </button>
        </div>
        {#if selectedLive}
          <div class="rounded-2xl p-4 mb-4 flex items-center gap-3"
               style="background: linear-gradient(135deg, var(--surface-2), var(--surface-3));">
            <div class="w-11 h-11 rounded-xl grid place-items-center" style="background: {selectedLive.color}; color: white;">
              <Bus size={20} />
            </div>
            <div class="flex-1 min-w-0">
              <div class="t-footnote text-muted">Naslednja postaja</div>
              <div class="t-headline font-semibold">
                {selectedLive.etaMin === 0 ? 'prihaja zdaj' : `čez ${selectedLive.etaMin} min`}
              </div>
            </div>
            {#if selectedLive.predicted}
              <span class="px-2 h-6 rounded-full surface t-footnote border border-base grid place-items-center" style="color: var(--status-delay)">ocena</span>
            {:else}
              <span class="px-2 h-6 rounded-full surface t-footnote border border-base grid place-items-center" style="color: var(--status-ontime)">GPS</span>
            {/if}
          </div>
        {/if}
        <div class="flex items-center justify-between mb-2">
          <div class="t-footnote text-muted uppercase tracking-wide">Naslednje postaje</div>
          <LiveDot label={isLive ? 'V živo' : 'Ocenjeno'} />
        </div>
        <ul class="surface rounded-2xl border border-base overflow-hidden shadow-card">
          {#each vehNextStops as ns, i}
            <li class="px-4 py-2.5 flex items-center gap-3 {i > 0 ? 'border-t border-base' : ''}">
              <div class="w-2.5 h-2.5 rounded-full" style="background: {i === 0 ? selectedVehicle.color : 'var(--border-strong)'}"></div>
              <div class="flex-1 min-w-0 t-body {i === 0 ? 'font-semibold' : ''} truncate">{ns.stop.name}</div>
              <div class="t-footnote text-muted">{fmtTime(ns.arr)} · {ns.minutes}′</div>
            </li>
          {/each}
        </ul>
        <p class="mt-3 t-footnote text-muted px-1">Pozicija je ocenjena iz voznega reda (±1–2 min).</p>

      {/if}
    </div>
  </BottomSheet>

  {#if shareDialogOpen}
    <div class="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
         style="background: rgba(0,0,0,0.45); backdrop-filter: blur(6px);"
         on:click|self={() => shareDialogOpen = false}
         role="dialog" aria-modal="true">
      <div class="surface w-full sm:max-w-md rounded-3xl shadow-float overflow-hidden flex flex-col"
           style="max-height: calc(100dvh - 2rem);">
        <div class="flex items-center gap-3 px-5 pt-4 pb-2 shrink-0">
          <div class="min-w-0 flex-1">
            <div class="t-footnote text-muted uppercase tracking-wide">Deli pot</div>
            <div class="t-title3 font-semibold">Predogled</div>
          </div>
          <button class="pressable w-9 h-9 rounded-full surface-2 grid place-items-center"
                  on:click={() => shareDialogOpen = false} aria-label="Zapri">
            <X size={18} />
          </button>
        </div>
        <div class="px-5 pb-4 space-y-3 overflow-y-auto">
          <div class="t-footnote text-muted">Informacije, ki jih deliš:</div>
          <pre class="surface-2 rounded-xl border border-base p-3 t-footnote whitespace-pre-wrap break-all">{shareText}</pre>
          <div class="flex gap-2">
            <button class="pressable flex-1 h-11 rounded-xl bg-accent text-white t-callout font-semibold"
                    on:click={() => copyShare('text')}>Kopiraj vse</button>
            <button class="pressable flex-1 h-11 rounded-xl surface-2 border border-base t-callout font-semibold"
                    on:click={() => copyShare('url')}>Samo povezavo</button>
          </div>
        </div>
      </div>
    </div>
  {/if}

  {#if saveToast}
    <div class="absolute z-50 left-1/2 -translate-x-1/2 px-4"
         style="bottom: calc(env(safe-area-inset-bottom) + 6.5rem); pointer-events: none;">
      <div class="surface rounded-full border border-base shadow-elev px-4 h-10 flex items-center t-footnote font-medium">
        {saveToast}
      </div>
    </div>
  {/if}

  <StopTimetableModal open={stopTimetableOpen} {gtfs} stop={selectedStop}
    onClose={() => stopTimetableOpen = false} />
  <LineTimetableModal open={lineTimetableOpen} {gtfs} route={lineTimetableRoute} initialDir={lineTimetableDir}
    onClose={() => lineTimetableOpen = false} />
</div>
