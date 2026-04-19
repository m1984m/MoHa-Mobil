<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { Home, Map as MapIcon, Star, Settings as SettingsIcon, CalendarClock } from 'lucide-svelte';
  import { fade } from 'svelte/transition';
  import { initTheme, type Theme } from './lib/theme';
  import { loadGTFS, type GTFS, type Stop } from './lib/gtfs';
  import { getLocation, MARIBOR } from './lib/geo';
  import { fetchWeather, type Weather } from './lib/weather';
  import { defaultTab } from './lib/settings';
  import type { Plan } from './lib/planner';
  import TabBar from './lib/ui/TabBar.svelte';
  import HomeScreen from './lib/screens/HomeScreen.svelte';
  import MapScreen from './lib/screens/MapScreen.svelte';
  import FavScreen from './lib/screens/FavScreen.svelte';
  import SettingsScreen from './lib/screens/SettingsScreen.svelte';
  import TimetablesScreen from './lib/screens/TimetablesScreen.svelte';
  import PlannerModal from './lib/screens/PlannerModal.svelte';
  import WeatherModal from './lib/screens/WeatherModal.svelte';
  import UpdateToast from './lib/ui/UpdateToast.svelte';

  type TabId = 'home' | 'timetables' | 'map' | 'fav' | 'settings';

  // Obnovi zadnji tab iz sessionStorage — iOS/Android lahko evict+reload PWA,
  // kar bi brez persistence vrglo uporabnika nazaj na Home sredi brskanja.
  function restoreTab(): TabId {
    try {
      const v = sessionStorage.getItem('mm_tab');
      if (v === 'home' || v === 'timetables' || v === 'map' || v === 'fav' || v === 'settings') return v;
    } catch {}
    return get(defaultTab);
  }

  let theme: Theme = 'auto';
  let activeTab: TabId = restoreTab();
  $: try { sessionStorage.setItem('mm_tab', activeTab); } catch {}
  let gtfs: GTFS | null = null;
  let gtfsError: boolean = false;
  let gtfsRetrying: boolean = false;
  let origin = { lat: MARIBOR.lat, lon: MARIBOR.lon };
  let hasGeo = false;
  let weather: Weather | null = null;
  let weatherTimer: ReturnType<typeof setInterval> | null = null;

  let selectedStop: Stop | null = null;
  let activePlan: {
    plan: Plan;
    geoms: { kind: 'walk' | 'bus'; coords: [number, number][]; color: string }[];
    from: { lat: number; lon: number; name: string };
    to: { lat: number; lon: number; name: string };
  } | null = null;
  let plannerOpen = false;
  let weatherOpen = false;
  let pendingLongPress: { lat: number; lon: number } | null = null;
  let plannerCandidates: Plan[] = [];
  $: hasPlanAlternatives = plannerCandidates.length > 1;

  const tabs = [
    { id: 'home',       label: 'Dom',         icon: Home },
    { id: 'timetables', label: 'Vozni redi',  icon: CalendarClock },
    { id: 'map',        label: 'Karta',       icon: MapIcon },
    { id: 'fav',        label: 'Priljub.',    icon: Star },
    { id: 'settings',   label: 'Nastav.',     icon: SettingsIcon },
  ];

  async function tryLoadGtfs() {
    gtfsError = false;
    try {
      gtfs = await loadGTFS();
    } catch {
      gtfs = null;
      gtfsError = true;
    }
  }

  async function retryGtfs() {
    if (gtfsRetrying) return;
    gtfsRetrying = true;
    try {
      await tryLoadGtfs();
      if (gtfs) await tryDeepLinkPlan();
    } finally {
      gtfsRetrying = false;
    }
  }

  onMount(async () => {
    theme = initTheme();
    await tryLoadGtfs();
    await requestLocation();
    await refreshWeather();
    weatherTimer = setInterval(refreshWeather, 15 * 60 * 1000);
    if (gtfs) await tryDeepLinkPlan();
  });

  function parsePlace(s: string | null): { lat: number; lon: number; name: string } | null {
    if (!s) return null;
    const parts = s.split(',');
    if (parts.length < 2) return null;
    const lat = parseFloat(parts[0]);
    const lon = parseFloat(parts[1]);
    if (!isFinite(lat) || !isFinite(lon)) return null;
    const name = parts.length >= 3 ? decodeURIComponent(parts.slice(2).join(',')) : `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    return { lat, lon, name };
  }

  async function tryDeepLinkPlan() {
    const params = new URLSearchParams(location.search);
    const from = parsePlace(params.get('from'));
    const to = parsePlace(params.get('to'));
    if (!from || !to || !gtfs) return;
    const { planAll } = await import('./lib/planner');
    const { loadShapes, cropShape, routeColor } = await import('./lib/gtfs');
    const { walkRoute, walkMapForStops } = await import('./lib/routing');
    const now = new Date();
    const depSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const [accessMap, egressMap] = await Promise.all([
      walkMapForStops(from, gtfs.stops),
      walkMapForStops(to, gtfs.stops),
    ]);
    const plans = planAll(gtfs, from, to, depSec, now, accessMap, egressMap);
    if (plans.length === 0) return;
    const chosen = plans[0];
    const shMap = await loadShapes();
    const walks = await Promise.all(chosen.legs.map(l => l.kind === 'walk' ? walkRoute({ lat: l.fromLat, lon: l.fromLon }, { lat: l.toLat, lon: l.toLon }) : Promise.resolve(null)));
    const geoms = chosen.legs.map((leg, i) => {
      if (leg.kind === 'walk') {
        const wr = walks[i]!;
        (leg as any).meters = wr.meters;
        (leg as any).sec = wr.sec;
        return { kind: 'walk' as const, coords: wr.coords, color: '#6B7280' };
      }
      const shape = leg.shapeId != null ? shMap.get(leg.shapeId) : null;
      const coords: [number, number][] = shape
        ? cropShape(shape, leg.from, leg.to).map(([lat, lon]) => [lon, lat])
        : [[leg.from.lon, leg.from.lat], [leg.to.lon, leg.to.lat]];
      return { kind: 'bus' as const, coords, color: routeColor(leg.route.id) };
    });
    chosen.walkMeters = chosen.legs.reduce((a, l) => a + (l.kind === 'walk' ? l.meters : 0), 0);
    handleShowPlan(chosen, geoms, from, to);
    history.replaceState(null, '', location.pathname);
  }

  onDestroy(() => {
    if (weatherTimer) clearInterval(weatherTimer);
  });

  async function requestLocation() {
    try {
      const p = await getLocation();
      origin = { lat: p.coords.latitude, lon: p.coords.longitude };
      hasGeo = true;
    } catch {}
  }
  async function refreshWeather() {
    weather = await fetchWeather(origin.lat, origin.lon);
  }

  async function handleStopSelect(s: Stop) {
    selectedStop = s;
    activeTab = 'map';
    await tick();
  }

  function handleOpenPlanner() { plannerOpen = true; }

  function handleShowPlan(plan: Plan, geoms: any[], from: any, to: any) {
    activePlan = { plan, geoms, from, to };
    selectedStop = null;
    activeTab = 'map';
  }

  function handleClearPlan() { activePlan = null; }

  function handleLongPressDest(lat: number, lon: number) {
    pendingLongPress = { lat, lon };
    plannerOpen = true;
  }

  function changeTab(id: string) {
    activeTab = id as TabId;
  }

  async function runSavedRoute(r: { from: { lat: number; lon: number; name: string }; to: { lat: number; lon: number; name: string } }) {
    if (!gtfs) return;
    const { planAll } = await import('./lib/planner');
    const { loadShapes, cropShape, routeColor } = await import('./lib/gtfs');
    const { walkRoute, walkMapForStops } = await import('./lib/routing');
    const now = new Date();
    const depSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const [accessMap, egressMap] = await Promise.all([
      walkMapForStops(r.from, gtfs.stops),
      walkMapForStops(r.to, gtfs.stops),
    ]);
    const plans = planAll(gtfs, r.from, r.to, depSec, now, accessMap, egressMap);
    if (plans.length === 0) return;
    const chosen = plans[0];
    const shMap = await loadShapes();
    const walks = await Promise.all(chosen.legs.map(l => l.kind === 'walk' ? walkRoute({ lat: l.fromLat, lon: l.fromLon }, { lat: l.toLat, lon: l.toLon }) : Promise.resolve(null)));
    const geoms = chosen.legs.map((leg, i) => {
      if (leg.kind === 'walk') {
        const wr = walks[i]!;
        (leg as any).meters = wr.meters;
        (leg as any).sec = wr.sec;
        return { kind: 'walk' as const, coords: wr.coords, color: '#6B7280' };
      }
      const shape = leg.shapeId != null ? shMap.get(leg.shapeId) : null;
      const coords: [number, number][] = shape
        ? cropShape(shape, leg.from, leg.to).map(([lat, lon]) => [lon, lat])
        : [[leg.from.lon, leg.from.lat], [leg.to.lon, leg.to.lat]];
      return { kind: 'bus' as const, coords, color: routeColor(leg.route.id) };
    });
    chosen.walkMeters = chosen.legs.reduce((a, l) => a + (l.kind === 'walk' ? l.meters : 0), 0);
    handleShowPlan(chosen, geoms, r.from, r.to);
  }
</script>

<div class="fixed inset-0">

  {#if activeTab === 'home'}
    <div class="absolute inset-0" in:fade={{ duration: 180 }}>
      <HomeScreen {gtfs} {origin} {hasGeo} {weather}
        onStopSelect={handleStopSelect}
        onOpenPlanner={handleOpenPlanner}
        onOpenWeather={() => weatherOpen = true}
        onRequestLocation={async () => { await requestLocation(); await refreshWeather(); }} />
    </div>
  {:else if activeTab === 'timetables'}
    <div class="absolute inset-0" in:fade={{ duration: 180 }}>
      <TimetablesScreen {gtfs} />
    </div>
  {:else if activeTab === 'map'}
    <div class="absolute inset-0" in:fade={{ duration: 180 }}>
      <MapScreen {gtfs} {origin} {hasGeo} {selectedStop} {activePlan} hasAlternatives={hasPlanAlternatives}
        onStopChange={(s) => selectedStop = s}
        onClearPlan={handleClearPlan}
        onOpenPlanner={handleOpenPlanner}
        onLongPressDest={handleLongPressDest} />
    </div>
  {:else if activeTab === 'fav'}
    <div class="absolute inset-0" in:fade={{ duration: 180 }}>
      <FavScreen {gtfs} onStopSelect={handleStopSelect} onRunSavedRoute={runSavedRoute} />
    </div>
  {:else if activeTab === 'settings'}
    <div class="absolute inset-0" in:fade={{ duration: 180 }}>
      <SettingsScreen {theme} onThemeChange={(t) => theme = t} />
    </div>
  {/if}

  <TabBar {tabs} active={activeTab} onChange={changeTab} />

  <PlannerModal open={plannerOpen} {gtfs} {origin} {hasGeo}
    bind:candidates={plannerCandidates}
    onClose={() => { plannerOpen = false; pendingLongPress = null; }}
    onShowPlan={handleShowPlan} />

  <WeatherModal open={weatherOpen} lat={origin.lat} lon={origin.lon}
    onClose={() => weatherOpen = false} />

  <UpdateToast />

  {#if gtfsError}
    <div class="fixed inset-0 z-[100] flex items-center justify-center surface px-6"
         style="padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom);">
      <div class="max-w-sm w-full text-center space-y-4">
        <div class="t-title2 font-semibold">Voznih redov ni bilo mogoče naložiti</div>
        <div class="t-footnote text-muted">Preveri internetno povezavo in poskusi znova.</div>
        <button class="pressable h-12 px-6 rounded-xl t-subhead font-semibold disabled:opacity-60"
                style="background: var(--accent); color: #ffffff;"
                disabled={gtfsRetrying}
                on:click={retryGtfs}>
          {gtfsRetrying ? 'Nalagam…' : 'Poskusi znova'}
        </button>
      </div>
    </div>
  {/if}
</div>
