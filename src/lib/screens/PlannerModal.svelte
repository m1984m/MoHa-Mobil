<script lang="ts">
  import { X, MapPin, Flag, Navigation, ArrowRightLeft, Star, Clock, Route as RouteIcon, ArrowRight } from 'lucide-svelte';
  import { cropShape, loadShapes, routeColor, type GTFS, type Stop } from '../gtfs';
  import { planAll, type Plan } from '../planner';
  import { walkRoute, walkMapForStops } from '../routing';
  import LineBadge from '../ui/LineBadge.svelte';
  import Skeleton from '../ui/Skeleton.svelte';
  import { favStops } from '../favorites';
  import { plannerShowFavs } from '../settings';
  import { savedRoutes } from '../savedRoutes';

  export let open: boolean = false;
  export let gtfs: GTFS | null;
  export let origin: { lat: number; lon: number };
  export let hasGeo: boolean;
  export let onClose: () => void;
  export let onShowPlan: (plan: Plan, geoms: any[], from: { lat: number; lon: number; name: string }, to: { lat: number; lon: number; name: string }) => void;

  type Place = { lat: number; lon: number; name: string };
  let fromQuery = '';
  let toQuery = '';
  let fromPlace: Place | null = null;
  let toPlace: Place | null = null;
  let fromFocus = false;
  let toFocus = false;
  let running = false;
  let error = '';
  let fromAddrResults: Place[] = [];
  let toAddrResults: Place[] = [];
  let fromAddrTimer: any = null;
  let toAddrTimer: any = null;
  export let candidates: Plan[] = [];

  type TimeMode = 'now' | 'depart' | 'arrive';
  let timeMode: TimeMode = 'now';
  let timeExpanded = false;
  let timeStr: string = defaultTimeStr();

  function defaultTimeStr() {
    const n = new Date();
    return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
  }
  function parseHM(s: string): number {
    const [h, m] = s.split(':').map(x => parseInt(x, 10));
    if (!isFinite(h) || !isFinite(m)) return 0;
    return h * 3600 + m * 60;
  }
  $: timeModeLabel = timeMode === 'now' ? 'Zdaj' : timeMode === 'depart' ? `Odhod ob ${timeStr}` : `Prihod do ${timeStr}`;

  $: fromResults = gtfs && fromFocus && !fromPlace && fromQuery.trim()
    ? gtfs.stops.filter(s => s.name.toLowerCase().includes(fromQuery.trim().toLowerCase())).slice(0, 6)
    : [];
  $: toResults = gtfs && toFocus && !toPlace && toQuery.trim()
    ? gtfs.stops.filter(s => s.name.toLowerCase().includes(toQuery.trim().toLowerCase())).slice(0, 6)
    : [];
  $: favList = gtfs && $plannerShowFavs ? gtfs.stops.filter(s => $favStops.has(s.id)) : [];
  $: showFromFavs = fromFocus && !fromPlace && !fromQuery.trim() && favList.length > 0;
  $: showToFavs = toFocus && !toPlace && !toQuery.trim() && favList.length > 0;

  $: scheduleAddr('from', fromQuery, fromFocus, fromPlace);
  $: scheduleAddr('to', toQuery, toFocus, toPlace);

  function scheduleAddr(which: 'from' | 'to', q: string, focus: boolean, place: Place | null) {
    const timerRef = which === 'from' ? fromAddrTimer : toAddrTimer;
    if (timerRef) clearTimeout(timerRef);
    if (!focus || place || !q.trim() || q.trim().length < 3) {
      if (which === 'from') fromAddrResults = []; else toAddrResults = [];
      return;
    }
    const t = setTimeout(async () => {
      const res = await geocodeMany(q.trim());
      if (which === 'from') fromAddrResults = res; else toAddrResults = res;
    }, 350);
    if (which === 'from') fromAddrTimer = t; else toAddrTimer = t;
  }

  async function geocodeMany(q: string): Promise<Place[]> {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + ', Maribor, Slovenija')}&format=json&countrycodes=si&limit=5&addressdetails=1`, { headers: { 'Accept-Language': 'sl', 'User-Agent': 'MoHaMobil/0.4.0 (github.com/m1984m/MoHa-Mobil)' } });
      if (!r.ok) return [];
      const j = await r.json();
      if (!Array.isArray(j)) return [];
      return j.map((it: any) => ({
        lat: parseFloat(it.lat),
        lon: parseFloat(it.lon),
        name: it.display_name.split(',').slice(0, 2).join(',').trim(),
      }));
    } catch { return []; }
  }

  function pickSavedRoute(r: { from: Place; to: Place }) {
    fromPlace = { ...r.from };
    toPlace = { ...r.to };
    fromQuery = r.from.name;
    toQuery = r.to.name;
    fromFocus = false;
    toFocus = false;
    run();
  }

  function pickFromAddr(p: Place) { fromPlace = p; fromQuery = p.name; fromFocus = false; fromAddrResults = []; }
  function pickToAddr(p: Place) { toPlace = p; toQuery = p.name; toFocus = false; toAddrResults = []; }

  function useMyLocationAsFrom() {
    if (!hasGeo) return;
    fromPlace = { lat: origin.lat, lon: origin.lon, name: 'Moja lokacija' };
    fromQuery = 'Moja lokacija';
    fromFocus = false;
  }
  function pickFrom(s: Stop) { fromPlace = { lat: s.lat, lon: s.lon, name: s.name }; fromQuery = s.name; fromFocus = false; }
  function pickTo(s: Stop) { toPlace = { lat: s.lat, lon: s.lon, name: s.name }; toQuery = s.name; toFocus = false; }
  function swap() { const f = fromPlace, q = fromQuery; fromPlace = toPlace; fromQuery = toQuery; toPlace = f; toQuery = q; }

  async function geocode(q: string): Promise<Place | null> {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + ', Maribor, Slovenija')}&format=json&countrycodes=si&limit=1`, { headers: { 'Accept-Language': 'sl', 'User-Agent': 'MoHaMobil/0.4.0 (github.com/m1984m/MoHa-Mobil)' } });
      if (!r.ok) return null;
      const j = await r.json();
      if (!Array.isArray(j) || j.length === 0) return null;
      return { lat: parseFloat(j[0].lat), lon: parseFloat(j[0].lon), name: j[0].display_name.split(',').slice(0, 2).join(',').trim() };
    } catch { return null; }
  }

  async function run() {
    if (!gtfs) return;
    error = '';
    if (!fromPlace && fromQuery.trim()) {
      const ql = fromQuery.trim().toLowerCase();
      const st = gtfs.stops.find(s => s.name.toLowerCase() === ql);
      fromPlace = st ? { lat: st.lat, lon: st.lon, name: st.name } : await geocode(fromQuery.trim());
    }
    if (!toPlace && toQuery.trim()) {
      const ql = toQuery.trim().toLowerCase();
      const st = gtfs.stops.find(s => s.name.toLowerCase() === ql);
      toPlace = st ? { lat: st.lat, lon: st.lon, name: st.name } : await geocode(toQuery.trim());
    }
    if (!fromPlace || !toPlace) { error = 'Ne najdem izhodišča ali cilja.'; return; }

    running = true;
    try {
      const now = new Date();
      const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
      // Prefetch OSRM walk matrike za access/egress postaje — enkrat pred vsemi iteracijami
      // arrive-by loopa (access/egress stopi so isti, spreminja se le čas odhoda).
      const [accessMap, egressMap] = await Promise.all([
        walkMapForStops(fromPlace, gtfs.stops),
        walkMapForStops(toPlace, gtfs.stops),
      ]);
      let plans: Plan[] = [];
      if (timeMode === 'arrive') {
        const target = parseHM(timeStr);
        // Iterate backwards in 20-min steps to find latest departures still arriving ≤ target
        const collected: Plan[] = [];
        for (let back = 0; back <= 180 * 60; back += 20 * 60) {
          const ds = target - back;
          if (ds < nowSec - 3600) break;
          const res = planAll(gtfs, fromPlace, toPlace, Math.max(0, ds), now, accessMap, egressMap);
          for (const p of res) if (p.arrSec <= target) collected.push(p);
          if (collected.length >= 6) break;
        }
        // Deduplicate by depSec+arrSec+transfers and pick latest departures
        const seen = new Set<string>();
        plans = collected.filter(p => {
          const k = `${p.depSec}|${p.arrSec}|${p.transfers}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        }).sort((a, b) => b.depSec - a.depSec).slice(0, 3);
      } else {
        const depSec = timeMode === 'depart' ? parseHM(timeStr) : nowSec;
        plans = planAll(gtfs, fromPlace, toPlace, depSec, now, accessMap, egressMap);
      }
      if (plans.length === 0) { error = 'Ni povezave.'; return; }
      candidates = plans;
    } catch (e: any) {
      error = 'Napaka: ' + (e?.message ?? e);
    } finally {
      running = false;
    }
  }

  async function choosePlan(chosen: Plan) {
    if (!gtfs || !fromPlace || !toPlace) return;
    running = true;
    try {
      const shMap = await loadShapes();
      const walkPromises = chosen.legs.map(l => l.kind === 'walk' ? walkRoute({ lat: l.fromLat, lon: l.fromLon }, { lat: l.toLat, lon: l.toLon }) : Promise.resolve(null));
      const walks = await Promise.all(walkPromises);
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
      onShowPlan(chosen, geoms, fromPlace!, toPlace!);
      onClose();
    } finally {
      running = false;
    }
  }

  function fmtDur(sec: number): string {
    const m = Math.round(sec / 60);
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)} h ${m % 60} min`;
  }
  function fmtTime(sec: number): string {
    const h = Math.floor(sec / 3600) % 24;
    const m = Math.floor((sec % 3600) / 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  function busLegs(p: Plan) { return p.legs.filter(l => l.kind === 'bus') as any[]; }

  function reset() {
    fromQuery = ''; toQuery = ''; fromPlace = null; toPlace = null; error = ''; candidates = [];
    timeMode = 'now'; timeExpanded = false; timeStr = defaultTimeStr();
  }

  function handleClose() { reset(); onClose(); }
</script>

{#if open}
  <div class="fixed inset-0 z-50 flex flex-col" style="background: rgba(0,0,0,0.35); backdrop-filter: blur(4px);">
    <div class="surface rounded-b-3xl shadow-float overflow-hidden"
         style="padding-top: env(safe-area-inset-top);">
      <div class="flex items-center justify-between px-4 pt-4 pb-2">
        <div class="t-title2">Načrtuj pot</div>
        <button class="pressable w-9 h-9 rounded-full surface-2 grid place-items-center" on:click={handleClose} aria-label="Zapri">
          <X size={18} />
        </button>
      </div>

      <div class="px-4 pb-4 space-y-3">
        <!-- From -->
        <div class="relative">
          <div class="relative surface-2 rounded-xl border border-base">
            <MapPin size={18} color="var(--status-ontime)" class="absolute left-3 top-1/2 -translate-y-1/2" />
            <input bind:value={fromQuery}
              on:focus={() => { fromFocus = true; if (fromPlace) fromPlace = null; }}
              on:blur={() => setTimeout(() => fromFocus = false, 150)}
              class="w-full h-12 bg-transparent pl-10 pr-3 t-body outline-none"
              placeholder="Od — postaja, naslov ali moja lokacija" />
          </div>
          {#if fromFocus && !fromPlace && (hasGeo || fromResults.length > 0 || fromAddrResults.length > 0 || showFromFavs)}
            <ul class="absolute left-0 right-0 mt-1 surface rounded-xl border border-base shadow-elev max-h-72 overflow-y-auto z-20">
              {#if hasGeo}
                <li>
                  <button class="pressable w-full text-left px-3 py-3 t-body flex items-center gap-2 border-b border-base" on:mousedown|preventDefault={useMyLocationAsFrom}>
                    <Navigation size={16} color="var(--accent)" />
                    <span class="font-medium">Moja lokacija</span>
                  </button>
                </li>
              {/if}
              {#if showFromFavs}
                <li class="px-3 pt-2 pb-1 t-footnote text-muted uppercase tracking-wide">Priljubljena</li>
                {#each favList as s}
                  <li><button class="pressable w-full text-left px-3 py-3 t-body flex items-center gap-2 border-b border-base" on:mousedown|preventDefault={() => pickFrom(s)}>
                    <Star size={14} fill="var(--status-delay)" color="var(--status-delay)" />
                    <span>{s.name}</span>
                  </button></li>
                {/each}
              {/if}
              {#each fromResults as s}
                <li><button class="pressable w-full text-left px-3 py-3 t-body flex items-center gap-2 border-b border-base" on:mousedown|preventDefault={() => pickFrom(s)}>
                  <MapPin size={14} color="var(--accent)" />
                  <span>{s.name}</span>
                  <span class="ml-auto t-footnote text-muted">postaja</span>
                </button></li>
              {/each}
              {#each fromAddrResults as p}
                <li><button class="pressable w-full text-left px-3 py-3 t-body flex items-center gap-2 border-b border-base" on:mousedown|preventDefault={() => pickFromAddr(p)}>
                  <MapPin size={14} color="var(--text-muted)" />
                  <span class="truncate">{p.name}</span>
                  <span class="ml-auto t-footnote text-muted">naslov</span>
                </button></li>
              {/each}
            </ul>
          {/if}
        </div>

        <!-- Swap button -->
        <div class="flex justify-end -my-1">
          <button class="pressable w-8 h-8 rounded-full surface-2 border border-base grid place-items-center" on:click={swap} aria-label="Zamenjaj">
            <ArrowRightLeft size={14} />
          </button>
        </div>

        <!-- To -->
        <div class="relative">
          <div class="relative surface-2 rounded-xl border border-base">
            <Flag size={18} color="var(--status-disrupt)" class="absolute left-3 top-1/2 -translate-y-1/2" />
            <input bind:value={toQuery}
              on:focus={() => { toFocus = true; if (toPlace) toPlace = null; }}
              on:blur={() => setTimeout(() => toFocus = false, 150)}
              class="w-full h-12 bg-transparent pl-10 pr-3 t-body outline-none"
              placeholder="Do — postaja ali naslov" />
          </div>
          {#if toFocus && !toPlace && (toResults.length > 0 || toAddrResults.length > 0 || showToFavs)}
            <ul class="absolute left-0 right-0 mt-1 surface rounded-xl border border-base shadow-elev max-h-72 overflow-y-auto z-20">
              {#if showToFavs}
                <li class="px-3 pt-2 pb-1 t-footnote text-muted uppercase tracking-wide">Priljubljena</li>
                {#each favList as s}
                  <li><button class="pressable w-full text-left px-3 py-3 t-body flex items-center gap-2 border-b border-base" on:mousedown|preventDefault={() => pickTo(s)}>
                    <Star size={14} fill="var(--status-delay)" color="var(--status-delay)" />
                    <span>{s.name}</span>
                  </button></li>
                {/each}
              {/if}
              {#each toResults as s}
                <li><button class="pressable w-full text-left px-3 py-3 t-body flex items-center gap-2 border-b border-base" on:mousedown|preventDefault={() => pickTo(s)}>
                  <Flag size={14} color="var(--status-disrupt)" />
                  <span>{s.name}</span>
                  <span class="ml-auto t-footnote text-muted">postaja</span>
                </button></li>
              {/each}
              {#each toAddrResults as p}
                <li><button class="pressable w-full text-left px-3 py-3 t-body flex items-center gap-2 border-b border-base" on:mousedown|preventDefault={() => pickToAddr(p)}>
                  <Flag size={14} color="var(--text-muted)" />
                  <span class="truncate">{p.name}</span>
                  <span class="ml-auto t-footnote text-muted">naslov</span>
                </button></li>
              {/each}
            </ul>
          {/if}
        </div>

        <!-- Shranjene poti -->
        {#if $savedRoutes.length > 0 && candidates.length === 0}
          <div>
            <div class="t-footnote text-muted uppercase tracking-wide mb-2 px-1">Shranjene poti</div>
            <ul class="space-y-2">
              {#each $savedRoutes as r}
                <li class="surface-2 rounded-xl border border-base overflow-hidden flex items-stretch">
                  <button class="pressable flex-1 text-left px-3 py-2.5 min-w-0"
                          on:click={() => pickSavedRoute(r)}>
                    <div class="flex items-center gap-2 mb-0.5">
                      <RouteIcon size={14} color="var(--accent)" />
                      <div class="t-callout font-semibold truncate">{r.label}</div>
                    </div>
                    <div class="flex items-center gap-1.5 t-footnote text-muted min-w-0">
                      <span class="truncate">{r.from.name}</span>
                      <ArrowRight size={10} />
                      <span class="truncate">{r.to.name}</span>
                    </div>
                  </button>
                  <button class="pressable w-10 grid place-items-center border-l border-base shrink-0"
                          on:click={() => savedRoutes.remove(r.id)}
                          aria-label="Odstrani shranjeno pot">
                    <X size={14} />
                  </button>
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        <!-- Time mode -->
        <div>
          <button class="pressable w-full surface-2 rounded-xl border border-base px-3 h-12 flex items-center gap-2"
                  on:click={() => timeExpanded = !timeExpanded}>
            <Clock size={16} color="var(--accent)" />
            <span class="t-body font-medium">{timeModeLabel}</span>
            <span class="ml-auto t-title3 text-muted transition-transform"
                  style="transform: rotate({timeExpanded ? 180 : 0}deg)">⌄</span>
          </button>
          {#if timeExpanded}
            <div class="surface-2 rounded-xl border border-base mt-2 p-3 space-y-3">
              <div class="grid grid-cols-3 gap-1 surface rounded-lg p-1">
                {#each [{id: 'now' as TimeMode, label: 'Zdaj'}, {id: 'depart' as TimeMode, label: 'Odhod ob'}, {id: 'arrive' as TimeMode, label: 'Prihod do'}] as opt}
                  {@const a = timeMode === opt.id}
                  <button class="pressable h-9 rounded-md t-footnote font-semibold"
                          style="background: {a ? 'var(--accent)' : 'transparent'}; color: {a ? 'white' : 'var(--text)'}"
                          on:click={() => timeMode = opt.id}>{opt.label}</button>
                {/each}
              </div>
              {#if timeMode !== 'now'}
                <label class="flex items-center gap-3">
                  <span class="t-callout">Čas:</span>
                  <input type="time" bind:value={timeStr}
                         class="flex-1 h-11 surface rounded-lg border border-base px-3 t-body tabular-nums outline-none" />
                </label>
              {/if}
            </div>
          {/if}
        </div>

        <button class="pressable w-full h-12 rounded-xl bg-accent text-white t-headline disabled:opacity-60 flex items-center justify-center gap-2"
          disabled={(!fromPlace && !fromQuery.trim()) || (!toPlace && !toQuery.trim()) || running}
          on:click={run}>
          {#if running}
            <div class="w-2 h-2 rounded-full bg-white"></div>
            <div class="w-2 h-2 rounded-full bg-white" style="animation-delay: 0.15s"></div>
            <div class="w-2 h-2 rounded-full bg-white" style="animation-delay: 0.3s"></div>
          {:else}
            Poišči pot
          {/if}
        </button>

        {#if error}
          <div class="t-footnote px-1" style="color: var(--status-disrupt)">{error}</div>
        {/if}

        {#if running && candidates.length === 0}
          <div class="space-y-2 pt-2">
            <Skeleton height="20px" width="40%" />
            <Skeleton height="48px" />
          </div>
        {/if}

        {#if candidates.length > 0}
          <div class="pt-1">
            <div class="t-footnote text-muted uppercase tracking-wide mb-2 px-1">Predlogi poti</div>
            <ul class="space-y-2">
              {#each candidates as p, i}
                <li>
                  <button class="pressable w-full text-left surface-2 rounded-xl border border-base p-3 flex items-start gap-3"
                          on:click={() => choosePlan(p)}>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-baseline gap-2">
                        <div class="t-title3 font-semibold">{fmtDur(p.arrSec - p.depSec)}</div>
                        <div class="t-footnote text-muted">prihod {fmtTime(p.arrSec)}</div>
                      </div>
                      <div class="t-footnote text-muted mb-1.5">
                        {#if p.transfers === 0 && busLegs(p).length === 0}peš
                        {:else if p.transfers === 0}brez prestopanja
                        {:else if p.transfers === 1}1 prestop
                        {:else}{p.transfers} prestopov
                        {/if}
                        {#if p.walkMeters > 0} · {Math.round(p.walkMeters)} m peš{/if}
                      </div>
                      <div class="flex flex-wrap gap-1.5">
                        {#each busLegs(p) as bl}
                          <LineBadge short={bl.route.short} routeId={bl.route.id} size="sm" />
                        {/each}
                      </div>
                    </div>
                    {#if i === 0}
                      <div class="shrink-0 t-footnote rounded-full px-2 py-0.5" style="background: var(--accent); color: white;">priporočeno</div>
                    {/if}
                  </button>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>
    </div>
    <button class="flex-1" on:click={handleClose} aria-label="Zapri"></button>
  </div>
{/if}
