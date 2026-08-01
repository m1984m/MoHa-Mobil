<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { Home, Map as MapIcon, Star, Settings as SettingsIcon, CalendarClock } from 'lucide-svelte';
  import { fade } from 'svelte/transition';
  import { initTheme, type Theme } from './lib/theme';
  import { loadGTFS, type GTFS, type Stop } from './lib/gtfs';
  import { getLocation, watchLocation, MARIBOR } from './lib/geo';
  import { fetchWeather, type Weather } from './lib/weather';
  import { defaultTab, liveLocationWatch } from './lib/settings';
  import { pushBack } from './lib/backstack';
  import type { Plan } from './lib/planner';
  import TabBar from './lib/ui/TabBar.svelte';
  import HomeScreen from './lib/screens/HomeScreen.svelte';
  import FavScreen from './lib/screens/FavScreen.svelte';
  import SettingsScreen from './lib/screens/SettingsScreen.svelte';
  import TimetablesScreen from './lib/screens/TimetablesScreen.svelte';
  import WeatherModal from './lib/screens/WeatherModal.svelte';
  import UpdateToast from './lib/ui/UpdateToast.svelte';
  import Toast from './lib/ui/Toast.svelte';

  type TabId = 'home' | 'timetables' | 'map' | 'fav' | 'settings';

  // Code-split: MapScreen (vleče MapLibre, ~800 KB) in PlannerModal (planner+routing)
  // se naložita šele ob prvi rabi. Brez tega je bil ves MapLibre v začetnem paketu,
  // tudi če uporabnik nikoli ne odpre Karte. Po prvem izrisu ju prefetchamo v ozadju,
  // da je preklop zavihka kljub temu takojšen.
  let MapScreenComp: typeof import('./lib/screens/MapScreen.svelte').default | null = null;
  let PlannerModalComp: typeof import('./lib/screens/PlannerModal.svelte').default | null = null;
  let mapScreenLoading: Promise<void> | null = null;
  let plannerLoading: Promise<void> | null = null;
  function ensureMapScreen(): Promise<void> {
    if (MapScreenComp) return Promise.resolve();
    if (!mapScreenLoading) {
      mapScreenLoading = import('./lib/screens/MapScreen.svelte')
        .then(m => { MapScreenComp = m.default; })
        .catch(() => { mapScreenLoading = null; }); // retry ob naslednjem klicu (npr. izpad mreže)
    }
    return mapScreenLoading;
  }
  function ensurePlanner(): Promise<void> {
    if (PlannerModalComp) return Promise.resolve();
    if (!plannerLoading) {
      plannerLoading = import('./lib/screens/PlannerModal.svelte')
        .then(m => { PlannerModalComp = m.default; })
        .catch(() => { plannerLoading = null; });
    }
    return plannerLoading;
  }
  $: if (activeTab === 'map') ensureMapScreen();
  $: if (plannerOpen) ensurePlanner();

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
  let stopWatch: (() => void) | null = null;

  let selectedStop: Stop | null = null;
  let activePlan: {
    plan: Plan;
    geoms: { kind: 'walk' | 'bus'; coords: [number, number][]; color: string }[];
    from: { lat: number; lon: number; name: string };
    to: { lat: number; lon: number; name: string };
  } | null = null;
  let plannerOpen = false;
  let weatherOpen = false;
  // Predizpolnjen cilj za PlannerModal — bodisi iz long-pressa na karti (brez imena, reverse-geocode
   // naknadno), bodisi iz gumba "pot do te postaje" (z imenom).
  let pendingDest: { lat: number; lon: number; name?: string } | null = null;
  let plannerCandidates: Plan[] = [];
  $: hasPlanAlternatives = plannerCandidates.length > 1;
  // Indikator med večsekundnim izračunom shranjene poti / deep linka —
  // prej tap na shranjeno pot ni dal NOBENE povratne informacije.
  let routeRunning = false;

  // Sistemski "nazaj" (Android) zapira modale/izbire namesto izhoda iz PWA.
  let backPlanner: (() => void) | null = null;
  $: if (plannerOpen && !backPlanner) {
    backPlanner = pushBack(() => { plannerOpen = false; pendingDest = null; });
  } else if (!plannerOpen && backPlanner) {
    const r = backPlanner; backPlanner = null; r();
  }
  let backWeather: (() => void) | null = null;
  $: if (weatherOpen && !backWeather) {
    backWeather = pushBack(() => weatherOpen = false);
  } else if (!weatherOpen && backWeather) {
    const r = backWeather; backWeather = null; r();
  }
  let backStop: (() => void) | null = null;
  $: if (selectedStop && !backStop) {
    backStop = pushBack(() => selectedStop = null);
  } else if (!selectedStop && backStop) {
    const r = backStop; backStop = null; r();
  }
  let backPlan: (() => void) | null = null;
  $: if (activePlan && !backPlan) {
    backPlan = pushBack(() => activePlan = null);
  } else if (!activePlan && backPlan) {
    const r = backPlan; backPlan = null; r();
  }

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

  onMount(() => {
    theme = initTheme();
    // GTFS in geolokacija tečeta PARALELNO — prej je čakanje na geolocation
    // prompt/timeout (do 8 s) blokiralo nalaganje voznih redov in deep link.
    (async () => {
      await tryLoadGtfs();
      if (gtfs) await tryDeepLinkPlan();
    })();
    (async () => {
      await requestLocation();
      await refreshWeather();
      weatherTimer = setInterval(refreshWeather, 15 * 60 * 1000);
    })();
    // Prefetch odloženih chunkov, ko je glavna nit prosta — preklop na Karto/planer
    // je potem takojšen, začetni paket pa ostane majhen.
    const idle = (cb: () => void) =>
      'requestIdleCallback' in window
        ? (window as any).requestIdleCallback(cb, { timeout: 5000 })
        : setTimeout(cb, 2500);
    idle(() => { ensureMapScreen(); ensurePlanner(); });
  });

  function parsePlace(s: string | null): { lat: number; lon: number; name: string } | null {
    if (!s) return null;
    const parts = s.split(',');
    if (parts.length < 2) return null;
    const lat = parseFloat(parts[0]);
    const lon = parseFloat(parts[1]);
    if (!isFinite(lat) || !isFinite(lon)) return null;
    // Pokvarjen/skrajšan share link z osamljenim '%' vrže URIError — fallback na surov niz.
    let name = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    if (parts.length >= 3) {
      const raw = parts.slice(2).join(',');
      try { name = decodeURIComponent(raw); } catch { name = raw; }
    }
    return { lat, lon, name };
  }

  // Skupni pipeline plan→geoms za deep link in shranjene poti (prej 2 kopiji;
  // tretja, edina z AbortSignal, ostaja v PlannerModal.choosePlan).
  async function buildAndShowPlan(from: { lat: number; lon: number; name: string }, to: { lat: number; lon: number; name: string }): Promise<boolean> {
    if (!gtfs) return false;
    routeRunning = true;
    try {
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
      if (plans.length === 0) return false;
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
      return true;
    } catch {
      return false;
    } finally {
      routeRunning = false;
    }
  }

  async function tryDeepLinkPlan() {
    const params = new URLSearchParams(location.search);
    const from = parsePlace(params.get('from'));
    const to = parsePlace(params.get('to'));
    if (!from || !to || !gtfs) return;
    const ok = await buildAndShowPlan(from, to);
    if (!ok) {
      // Deep link brez rešitve: odpri planer s prednastavljenim ciljem,
      // da uporabnik vidi kontekst in razlog — prej je link tiho odpovedal.
      pendingDest = { lat: to.lat, lon: to.lon, name: to.name };
      plannerOpen = true;
    }
    history.replaceState(null, '', location.pathname);
  }

  onDestroy(() => {
    if (weatherTimer) clearInterval(weatherTimer);
    stopWatch?.();
    stopWatch = null;
  });

  async function requestLocation() {
    try {
      const p = await getLocation();
      origin = { lat: p.coords.latitude, lon: p.coords.longitude };
      hasGeo = true;
      if (get(liveLocationWatch)) startWatch();
    } catch {}
  }

  function startWatch() {
    if (stopWatch) return;
    stopWatch = watchLocation(
      (p) => { origin = { lat: p.lat, lon: p.lon }; },
      (err) => {
        // PERMISSION_DENIED (1): user je revoke-al → ustavi in reset hasGeo.
        // POSITION_UNAVAILABLE (2) / TIMEOUT (3): naslednji update pride sam,
        // watcher ne ubij — samo pusti mimo.
        if (err.code === 1) {
          stopWatch?.();
          stopWatch = null;
          hasGeo = false;
        }
      },
    );
  }

  // Dinamično sledenje stikala v Nastavitvah — brez potrebe po reload-u.
  $: {
    if ($liveLocationWatch && hasGeo && !stopWatch) startWatch();
    if (!$liveLocationWatch && stopWatch) { stopWatch(); stopWatch = null; }
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
    pendingDest = { lat, lon };
    plannerOpen = true;
  }

  function handlePlanToStop(s: Stop) {
    pendingDest = { lat: s.lat, lon: s.lon, name: s.name };
    plannerOpen = true;
  }

  function changeTab(id: string) {
    activeTab = id as TabId;
  }

  async function runSavedRoute(r: { from: { lat: number; lon: number; name: string }; to: { lat: number; lon: number; name: string } }) {
    if (!gtfs || routeRunning) return;
    const ok = await buildAndShowPlan(r.from, r.to);
    if (!ok) {
      // Ni rešitve (npr. konec obratovanja): odpri planer s ciljem,
      // da uporabnik vidi razlog — prej tap ni naredil ničesar.
      pendingDest = { lat: r.to.lat, lon: r.to.lon, name: r.to.name };
      plannerOpen = true;
    }
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
      <TimetablesScreen {gtfs} onStopSelect={handleStopSelect} />
    </div>
  {:else if activeTab === 'map'}
    <div class="absolute inset-0" in:fade={{ duration: 180 }}>
      {#if MapScreenComp}
        <svelte:component this={MapScreenComp} {gtfs} {origin} {hasGeo} {selectedStop} {activePlan} hasAlternatives={hasPlanAlternatives}
          onStopChange={(s) => selectedStop = s}
          onClearPlan={handleClearPlan}
          onOpenPlanner={handleOpenPlanner}
          onLongPressDest={handleLongPressDest}
          onPlanToStop={handlePlanToStop} />
      {:else}
        <!-- Chunk s karto se še prenaša (samo ob prvem obisku brez idle prefetcha) -->
        <div class="absolute inset-0 flex items-center justify-center surface">
          <div class="flex items-center gap-2 t-footnote text-muted" aria-live="polite">
            <span class="w-2 h-2 rounded-full animate-pulse" style="background: var(--accent)"></span>
            Nalagam karto…
          </div>
        </div>
      {/if}
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

  {#if PlannerModalComp}
    <svelte:component this={PlannerModalComp} open={plannerOpen} {gtfs} {origin} {hasGeo}
      bind:candidates={plannerCandidates}
      {pendingDest}
      onClose={() => { plannerOpen = false; pendingDest = null; }}
      onShowPlan={handleShowPlan} />
  {/if}

  <WeatherModal open={weatherOpen} lat={origin.lat} lon={origin.lon}
    onClose={() => weatherOpen = false} />

  <UpdateToast />
  <Toast />

  {#if routeRunning}
    <div class="fixed left-1/2 -translate-x-1/2 z-[60] pointer-events-none"
         style="bottom: calc(env(safe-area-inset-bottom) + 6.5rem)">
      <div class="surface rounded-full border border-base shadow-elev px-4 h-10 flex items-center gap-2 t-footnote font-medium">
        <span class="w-2 h-2 rounded-full animate-pulse" style="background: var(--accent)"></span>
        Iščem pot…
      </div>
    </div>
  {/if}

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
