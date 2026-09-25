<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { Home, Map as MapIcon, Star, Settings as SettingsIcon, CalendarClock, ArrowLeft } from 'lucide-svelte';
  import { fade } from 'svelte/transition';
  import { initTheme, type Theme } from './lib/theme';
  import { loadGTFS, type GTFS, type Stop } from './lib/gtfs';
  import { getLocation, watchLocation, MARIBOR } from './lib/geo';
  import { fetchWeather, type Weather } from './lib/weather';
  import { defaultTab, liveLocationWatch } from './lib/settings';
  import { simpleView, simpleActive, simpleFullApp, largeUI, type SimplePlace } from './lib/simple';
  import { initAnalytics, track } from './lib/analytics';
  import { alarms } from './lib/alarms';
  import { ensureSubscribed, scheduleSync } from './lib/push';
  import { pushBack, type BackRelease } from './lib/backstack';
  import { lang, t, tr } from './lib/i18n';
  import { onboardingDone, introSeen } from './lib/onboarding';
  import WelcomeModal from './lib/ui/WelcomeModal.svelte';
  import PetraCard from './lib/ui/PetraCard.svelte';
  import FaresModal from './lib/screens/FaresModal.svelte';
  import type { Plan } from './lib/planner';
  import TabBar from './lib/ui/TabBar.svelte';
  import HomeScreen from './lib/screens/HomeScreen.svelte';
  import FavScreen from './lib/screens/FavScreen.svelte';
  import SettingsScreen from './lib/screens/SettingsScreen.svelte';
  import TimetablesScreen from './lib/screens/TimetablesScreen.svelte';
  import WeatherModal from './lib/screens/WeatherModal.svelte';
  import AlarmsScreen from './lib/screens/AlarmsScreen.svelte';
  import UpdateToast from './lib/ui/UpdateToast.svelte';
  import Toast from './lib/ui/Toast.svelte';
  import SimpleScreen from './lib/screens/SimpleScreen.svelte';
  import SimpleStopScreen from './lib/screens/SimpleStopScreen.svelte';
  import SimpleRouteScreen, { type SimpleRouteState } from './lib/screens/SimpleRouteScreen.svelte';
  import SimplePlaceEditor from './lib/screens/SimplePlaceEditor.svelte';

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
  $: if (activeTab === 'map' || simpleMapOpen) ensureMapScreen();
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
  type ShownPlan = {
    plan: Plan;
    geoms: { kind: 'walk' | 'bus'; coords: [number, number][]; color: string }[];
    from: { lat: number; lon: number; name: string };
    to: { lat: number; lon: number; name: string };
  };
  let activePlan: ShownPlan | null = null;
  let plannerOpen = false;
  let weatherOpen = false;
  // Alarmi so poln prekrivni sloj, ne šesti zavihek — TabBar je s petimi zavihki
  // na 390 px že zapolnjen. Vstop je iz Priljubljenih in iz Nastavitev.
  let alarmsOpen = false;
  // Od kod so bili opomniki odprti — napis gumba nazaj pove, kam se vrneš.
  let alarmsFrom: 'settings' | 'fav' = 'settings';
  // Skriti zaslon s statistiko (deset dotikov na ime v Nastavitvah). Naloži se
  // šele ob prvem odprtju — v paketu za navadnega uporabnika nima kaj iskati.
  let statsOpen = false;
  let StatsScreenComp: typeof import('./lib/screens/StatsScreen.svelte').default | null = null;
  let statsLoading: Promise<void> | null = null;
  function openStats() {
    if (!StatsScreenComp && !statsLoading) {
      statsLoading = import('./lib/screens/StatsScreen.svelte')
        .then(m => { StatsScreenComp = m.default; })
        .catch(() => { statsLoading = null; });
    }
    statsOpen = true;
  }
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
  let backStats: (() => void) | null = null;
  $: if (statsOpen && !backStats) {
    backStats = pushBack(() => statsOpen = false);
  } else if (!statsOpen && backStats) {
    const r = backStats; backStats = null; r();
  }
  let backAlarms: (() => void) | null = null;
  $: if (alarmsOpen && !backAlarms) {
    backAlarms = pushBack(() => alarmsOpen = false);
  } else if (!alarmsOpen && backAlarms) {
    const r = backAlarms; backAlarms = null; r();
  }
  let faresOpen = false;
  let backFares: (() => void) | null = null;
  $: if (faresOpen && !backFares) {
    backFares = pushBack(() => faresOpen = false);
  } else if (!faresOpen && backFares) {
    const r = backFares; backFares = null; r();
  }
  // V preprostem pogledu karta nima svojih vnosov v zgodovini — tam jo zapira
  // backSimpleMap spodaj, sicer bi en pritisk nazaj zaprl samo izbiro na karti.
  let backStop: (() => void) | null = null;
  $: if (selectedStop && !backStop && !$simpleActive) {
    backStop = pushBack(() => selectedStop = null);
  } else if (!selectedStop && backStop) {
    const r = backStop; backStop = null; r();
  }
  let backPlan: (() => void) | null = null;
  $: if (activePlan && !backPlan && !$simpleActive) {
    backPlan = pushBack(() => activePlan = null);
  } else if (!activePlan && backPlan) {
    const r = backPlan; backPlan = null; r();
  }

  // ---------- Preprost pogled ----------
  let simpleStop: Stop | null = null;
  let simpleRoute: SimpleRouteState | null = null;
  // Cilj trenutne poti — za "Poskusi znova" in da prepozen izračun ne odpre
  // zaslona, ki ga je uporabnik medtem že zaprl.
  type Place = { lat: number; lon: number; name: string };
  // from: izhodišče, izbrano v planerju; brez njega se pot vedno računa od trenutne lege.
  let simpleTarget: { title: string; to: Place; from?: Place } | null = null;
  // Pot za karto se hrani posebej; activePlan dobi šele ob odprtju karte.
  let simplePlanForMap: ShownPlan | null = null;
  let simpleMapOpen = false;
  let placeEdit: { kind: 'home' | 'place'; place: SimplePlace | null } | null = null;

  let backSimpleStop: (() => void) | null = null;
  $: if (simpleStop && !backSimpleStop) {
    backSimpleStop = pushBack(() => simpleStop = null);
  } else if (!simpleStop && backSimpleStop) {
    const r = backSimpleStop; backSimpleStop = null; r();
  }
  let backSimpleRoute: (() => void) | null = null;
  $: if (simpleRoute && !backSimpleRoute) {
    backSimpleRoute = pushBack(closeSimpleRoute);
  } else if (!simpleRoute && backSimpleRoute) {
    const r = backSimpleRoute; backSimpleRoute = null; r();
  }
  let backPlaceEdit: (() => void) | null = null;
  $: if (placeEdit && !backPlaceEdit) {
    backPlaceEdit = pushBack(() => placeEdit = null);
  } else if (!placeEdit && backPlaceEdit) {
    const r = backPlaceEdit; backPlaceEdit = null; r();
  }
  // Vnos karte se upravlja ročno, ne z reaktivnim blokom: ob zaprtju mora MapScreen
  // najprej sprostiti svoje vnose (odprt bus, vozni red), šele nato je vnos karte
  // na vrhu. Reaktivni blok bi ga sprostil prej in vnos bi ostal mrtev v zgodovini.
  let backSimpleMap: BackRelease | null = null;
  let backFullApp: BackRelease | null = null;

  function closeSimpleRoute() { simpleRoute = null; simpleTarget = null; simplePlanForMap = null; }
  async function closeSimpleMap() {
    if (!simpleMapOpen) return;
    const r = backSimpleMap; backSimpleMap = null;
    simpleMapOpen = false; activePlan = null; selectedStop = null;
    await tick();   // MapScreen je uničen in je sprostil svoje vnose
    r?.();
  }

  // Celotna aplikacija iz preprostega pogleda: sistemski nazaj vrne v preprost pogled,
  // ne zapre PWA.
  $: if ($simpleView && $simpleFullApp && !backFullApp) {
    backFullApp = pushBack(() => simpleFullApp.set(false));
  } else if (!($simpleView && $simpleFullApp) && backFullApp) {
    const r = backFullApp; backFullApp = null; r();
  }
  function returnToSimple() {
    // Izbira na karti celotne aplikacije v preprostem pogledu ni vidna — pospravi jo,
    // da je sistemski nazaj ne bi "zapiral" nevidno.
    selectedStop = null; activePlan = null;
    simpleFullApp.set(false);
  }
  function openFullApp() {
    simpleStop = null; placeEdit = null; closeSimpleRoute();
    simpleFullApp.set(true);
  }

  // Vklop preprostega pogleda (v Nastavitvah ali vodiču) takoj pokaže njegov zaslon,
  // tudi če je bil uporabnik prej v "Celotni aplikaciji".
  let prevSimpleView = get(simpleView);
  $: {
    if ($simpleView && !prevSimpleView) { selectedStop = null; activePlan = null; simpleFullApp.set(false); }
    prevSimpleView = $simpleView;
  }

  async function runSimpleRoute(title: string, to: Place, fixedFrom?: Place, denied = false) {
    const target = { title, to, from: fixedFrom };
    simpleTarget = target;
    simplePlanForMap = null;
    if (!fixedFrom && !hasGeo) { simpleRoute = { status: 'geo', title, toName: to.name, denied }; return; }
    simpleRoute = { status: 'loading', title, toName: to.name };
    // Vozni redi se ob zagonu še nalagajo — brez njih bi pisalo "ni poti", kar ne drži.
    while (!gtfs && !gtfsError) {
      await new Promise(r => setTimeout(r, 250));
      if (simpleTarget !== target) return;
    }
    const from = fixedFrom ?? { lat: origin.lat, lon: origin.lon, name: tr('Moja lokacija') };
    let found: ShownPlan | null = null;
    const ok = await buildAndShowPlan(from, to, (plan, geoms, f, t2) => { found = { plan, geoms, from: f, to: t2 }; });
    if (simpleTarget !== target) return; // zaprto ali zamenjano med računanjem
    const res = found as ShownPlan | null;
    if (ok && res) {
      simplePlanForMap = res;
      simpleRoute = { status: 'ok', title, toName: to.name, plan: res.plan };
    } else {
      simpleRoute = { status: 'none', title, toName: to.name };
    }
  }

  function simpleRoutePlace(p: SimplePlace) {
    runSimpleRoute(p.kind === 'home' ? tr('Domov') : p.label, { lat: p.lat, lon: p.lon, name: p.name });
  }

  function retrySimpleRoute() {
    if (simpleTarget) runSimpleRoute(simpleTarget.title, simpleTarget.to, simpleTarget.from);
  }

  async function simpleLocateAndRetry() {
    await requestLocation();
    // Po zavrnitvi brskalnik ne vpraša znova — zaslon to pove, namesto da se tiho ponovi.
    if (simpleTarget) runSimpleRoute(simpleTarget.title, simpleTarget.to, simpleTarget.from, !hasGeo);
  }

  // Pot iz planerja ali s karte: najprej zapri, kar je odprto, in šele nato odpri
  // zaslon s koraki (vnosi v zgodovini morajo iti LIFO).
  async function showSimplePlan(title: string, to: Place, plan: ShownPlan) {
    if (simpleMapOpen) await closeSimpleMap();
    simpleTarget = { title, to, from: plan.from };
    simplePlanForMap = plan;
    simpleRoute = { status: 'ok', title, toName: to.name, plan: plan.plan };
  }

  async function simpleOpenPlanner() {
    const to = simpleTarget?.to;
    closeSimpleRoute();
    await tick();   // vnos poti je sproščen, preden planer potisne svojega
    if (to) pendingDest = { ...to };
    plannerOpen = true;
  }

  function openSimpleMap(opts: { stop?: Stop | null; plan?: ShownPlan | null } = {}) {
    activePlan = opts.plan ?? null;
    selectedStop = opts.stop ?? null;
    simpleMapOpen = true;
    backSimpleMap = pushBack(() => { void closeSimpleMap(); });
  }

  $: tabs = [
    { id: 'home',       label: $t('Dom'),         icon: Home },
    { id: 'timetables', label: $t('Vozni redi'),  icon: CalendarClock },
    { id: 'map',        label: $t('Karta'),       icon: MapIcon },
    { id: 'fav',        label: $t('Priljub.'),    icon: Star },
    { id: 'settings',   label: $t('Nastav.'),     icon: SettingsIcon },
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

  // Razred za način za starejše. Ločen od tem (applyTheme prevrača samo svoje
  // razrede), zato se lahko kombinira s katerokoli temo.
  $: if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('senior', $largeUI);
    document.documentElement.classList.toggle('mm-simple', $simpleActive);
    // Vrstica "Nazaj na preprost pogled" nad zavihki — prostor zanjo doda app.css.
    document.documentElement.classList.toggle('mm-simple-back', $simpleView && $simpleFullApp);
  }

  onMount(() => {
    theme = initTheme();
    // Za analitiko šteje tema, kot je videti ob zagonu, zato po initTheme.
    initAnalytics();
    // GTFS in geolokacija tečeta PARALELNO — prej je čakanje na geolocation
    // prompt/timeout (do 8 s) blokiralo nalaganje voznih redov in deep link.
    (async () => {
      await tryLoadGtfs();
      if (gtfs) await tryDeepLinkPlan();
    })();
    (async () => {
      // Nov uporabnik: sistemsko okno za lokacijo naj ne prekine prve kartice vodiča —
      // lokacijo zahteva kartica 3 ali konec vodiča (reaktivni blok spodaj).
      if (get(onboardingDone)) await requestLocation();
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
    // Naročnina na obvestila se lahko tiho zavrže (brskalnik zarotira endpoint) —
    // preveri jo ob vsakem zagonu. Razpored alarmov nato osveži reaktivni blok nižje.
    void ensureSubscribed();
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
  async function buildAndShowPlan(
    from: { lat: number; lon: number; name: string },
    to: { lat: number; lon: number; name: string },
    onDone: (plan: Plan, geoms: any[], from: any, to: any) => void = handleShowPlan,
  ): Promise<boolean> {
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
      onDone(chosen, geoms, from, to);
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

  // Vodič je bil v tej seji odprt in je končan brez lokacije (preskočen ali gumb
  // ni bil tapnjen): vprašaj enkrat zdaj. Obstoječi uporabnik gre skozi onMount.
  let onboardingShown = !get(onboardingDone);
  let askedAfterOnboarding = false;
  $: if (!$onboardingDone) onboardingShown = true;
  $: if ($onboardingDone && onboardingShown && !hasGeo && !askedAfterOnboarding) {
    askedAfterOnboarding = true;
    void requestLocation().then(refreshWeather);
  }

  // Dinamično sledenje stikala v Nastavitvah — brez potrebe po reload-u.
  $: {
    if ($liveLocationWatch && hasGeo && !stopWatch) startWatch();
    if (!$liveLocationWatch && stopWatch) { stopWatch(); stopWatch = null; }
  }
  // Vsaka sprememba alarmov — in zagon, ko se GTFS naloži — osveži razpored zvonjenja
  // na strežniku. scheduleSync sam združi rafal sprememb v eno zahtevo.
  // $lang: besedilo obvestil se sestavi na telefonu, zato ga ob menjavi jezika pošlji znova.
  $: $lang, scheduleSync(gtfs, $alarms);

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
    // Preprost pogled (planer "Drug cilj"): pot po korakih, karta na gumb.
    if (get(simpleActive)) {
      void showSimplePlan(to.name, to, { plan, geoms, from, to });
      return;
    }
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
    track({ e: 'zavihek', d: [id] });
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

<!-- Ob menjavi jezika se vmesnik izriše na novo: besedila, ki jih moduli .ts sestavijo
     ob klicu (tr(), time.ts), sicer ne bi sledila jeziku. Podatki (GTFS, lokacija)
     živijo v tej komponenti in se ne naložijo znova. -->
<!-- Escape v preprostem pogledu deluje kot sistemski nazaj: zapre samo zgornji zaslon.
     Zasloni sami Escape ne poslušajo — ob dveh odprtih bi en pritisk zaprl oba.
     Karta in planer imata svojo obravnavo. -->
<svelte:window on:keydown={(e) => {
  if (e.key === 'Escape' && $simpleActive && !simpleMapOpen && !plannerOpen && (simpleStop || simpleRoute || placeEdit)) history.back();
}} />

{#key $lang}
<div class="fixed inset-0">

  {#if $simpleActive}
    {#if simpleMapOpen}
      <div class="absolute inset-0">
        {#if MapScreenComp}
          <svelte:component this={MapScreenComp} {gtfs} {origin} {hasGeo} {selectedStop} {activePlan}
            simple onBack={closeSimpleMap}
            onStopChange={(s) => selectedStop = s}
            onClearPlan={closeSimpleMap}
            onOpenPlanner={handleOpenPlanner}
            onLongPressDest={() => {}}
            onPlanToStop={async (s) => { await closeSimpleMap(); runSimpleRoute(s.name, { lat: s.lat, lon: s.lon, name: s.name }); }} />
        {:else}
          <div class="absolute inset-0 flex items-center justify-center surface">
            <div class="flex items-center gap-2 t-body text-muted" aria-live="polite">
              <span class="w-3 h-3 rounded-full animate-pulse" style="background: var(--accent)"></span>
              {$t('Nalagam karto…')}
            </div>
          </div>
        {/if}
      </div>
    {:else}
      <SimpleScreen {gtfs} {origin} {hasGeo}
        onOpenStop={(s) => simpleStop = s}
        onRoute={simpleRoutePlace}
        onEditPlace={(kind, place) => placeEdit = { kind, place }}
        onOpenPlanner={handleOpenPlanner}
        onOpenMap={() => openSimpleMap()}
        onFullApp={openFullApp}
        onRequestLocation={async () => { await requestLocation(); await refreshWeather(); }} />
    {/if}
  {:else if activeTab === 'home'}
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
            {$t('Nalagam karto…')}
          </div>
        </div>
      {/if}
    </div>
  {:else if activeTab === 'fav'}
    <div class="absolute inset-0" in:fade={{ duration: 180 }}>
      <FavScreen {gtfs} onStopSelect={handleStopSelect} onRunSavedRoute={runSavedRoute}
        onOpenAlarms={() => { alarmsFrom = 'fav'; alarmsOpen = true; }} />
    </div>
  {:else if activeTab === 'settings'}
    <div class="absolute inset-0" in:fade={{ duration: 180 }}>
      <SettingsScreen {theme} onThemeChange={(t) => theme = t}
        onOpenAlarms={() => { alarmsFrom = 'settings'; alarmsOpen = true; }} onOpenStats={openStats}
        onOpenFares={() => faresOpen = true} />
    </div>
  {/if}

  {#if !$simpleActive}
    <TabBar {tabs} active={activeTab} onChange={changeTab} />
  {/if}

  {#if $simpleView && $simpleFullApp}
    <!-- Iz celotne aplikacije je pot nazaj vedno vidna — v preverjenih "načinih za
         starejše" je uporabnik najpogosteje obtičal prav tu. -->
    <button type="button" class="pressable mm-simple-return shadow-float"
            on:click={returnToSimple}>
      <ArrowLeft size={22} strokeWidth={2.25} /> {$t('Nazaj na preprost pogled')}
    </button>
  {/if}

  {#if PlannerModalComp}
    <svelte:component this={PlannerModalComp} open={plannerOpen} {gtfs} {origin} {hasGeo}
      bind:candidates={plannerCandidates}
      {pendingDest}
      onClose={() => { plannerOpen = false; pendingDest = null; }}
      onShowPlan={handleShowPlan} />
  {/if}

  <WeatherModal open={weatherOpen} lat={origin.lat} lon={origin.lon}
    onClose={() => weatherOpen = false} />

  <FaresModal open={faresOpen} onClose={() => faresOpen = false} />

  <AlarmsScreen open={alarmsOpen} {gtfs} onClose={() => alarmsOpen = false}
    backLabel={alarmsFrom === 'fav' ? $t('Priljubljene') : $t('Nastavitve')} />

  {#if $simpleActive}
    <SimpleStopScreen {gtfs} stop={simpleStop} hidden={simpleMapOpen}
      onClose={() => simpleStop = null}
      onShowMap={(s) => openSimpleMap({ stop: s })} />
    <SimpleRouteScreen state={simpleRoute} hidden={simpleMapOpen}
      onClose={closeSimpleRoute}
      onShowMap={() => openSimpleMap({ plan: simplePlanForMap })}
      onRetry={retrySimpleRoute}
      onOpenPlanner={simpleOpenPlanner}
      onRequestLocation={simpleLocateAndRetry} />
    <SimplePlaceEditor target={placeEdit} {origin} {hasGeo}
      onClose={() => placeEdit = null}
      onRequestLocation={async () => { await requestLocation(); }} />
  {/if}

  {#if StatsScreenComp}
    <svelte:component this={StatsScreenComp} open={statsOpen} {gtfs} onClose={() => statsOpen = false} />
  {/if}

  <UpdateToast />
  <Toast />

  {#if routeRunning}
    <div class="fixed left-1/2 -translate-x-1/2 z-[60] pointer-events-none"
         style="bottom: calc(var(--tabbar-space) + 2.5rem)">
      <div class="surface rounded-full border border-base shadow-elev px-4 h-10 flex items-center gap-2 t-footnote font-medium">
        <span class="w-2 h-2 rounded-full animate-pulse" style="background: var(--accent)"></span>
        {$t('Iščem pot…')}
      </div>
    </div>
  {/if}

  {#if gtfsError}
    <div class="fixed inset-0 z-[100] flex items-center justify-center surface px-6"
         style="padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom);">
      <div class="max-w-sm w-full text-center space-y-4">
        <div class="t-title2 font-semibold">{$t('Voznih redov ni bilo mogoče naložiti')}</div>
        <div class="t-footnote text-muted">{$t('Preveri internetno povezavo in poskusi znova.')}</div>
        <button class="pressable h-12 px-6 rounded-xl t-subhead font-semibold disabled:opacity-60"
                style="background: var(--accent); color: #ffffff;"
                disabled={gtfsRetrying}
                on:click={retryGtfs}>
          {gtfsRetrying ? $t('Nalagam…') : $t('Poskusi znova')}
        </button>
      </div>
    </div>
  {/if}
</div>
{/key}

<!-- Zunaj {#key}: ob izbiri jezika na prvi kartici se vodič ne sme zapreti ali vrniti na začetek. -->
<!-- Novost po posodobitvi: predstavitev Petre, enkrat, samo za obstoječe uporabnike. -->
{#if $onboardingDone && !$introSeen.petra && !gtfsError}
  <PetraCard />
{/if}

{#if !$onboardingDone && !gtfsError}
  <WelcomeModal {hasGeo} onRequestLocation={async () => { await requestLocation(); await refreshWeather(); }} />
{/if}
