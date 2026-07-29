<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { MapPinned, CloudOff } from 'lucide-svelte';
  import { nearestStops, upcomingDepartures, loadMeta, feedCoversDate, type GTFS, type Stop } from '../gtfs';
  import type { Weather } from '../weather';
  import Screen from '../ui/Screen.svelte';
  import LiveDot from '../ui/LiveDot.svelte';
  import Skeleton from '../ui/Skeleton.svelte';
  import EmptyState from '../ui/EmptyState.svelte';
  import StopBoard, { type BoardRow } from '../ui/StopBoard.svelte';
  import { favStops } from '../favorites';
  import { homeShowNearby, homeShowFavs, nearbyRadiusM } from '../settings';
  import { fetchArrivalsForStopPoint, type StopArrival } from '../realtime';
  import { fmtMonthYearGenitive } from '../time';

  export let gtfs: GTFS | null;
  export let origin: { lat: number; lon: number };
  export let hasGeo: boolean;
  export let weather: Weather | null;
  export let onStopSelect: (s: Stop) => void;
  export let onOpenPlanner: () => void;
  export let onRequestLocation: () => Promise<void>;
  export let onOpenWeather: () => void = () => {};

  let tick = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let liveByStop: Record<number, StopArrival[]> = {};
  // Cas zadnjega uspesnega fetcha per postaja — stari zivi prihodi ob izpadu
  // OBA ne smejo vecno prekrivati svezih GTFS podatkov.
  let liveAt: Record<number, number> = {};
  let lastFetchedKey = '';

  // Datum veljavnosti voznih redov iz meta.json (prej hardkodiran string,
  // ki je ob vsaki osvezitvi GTFS zastarel).
  let feedLabel = '';
  $: feedExpired = gtfs ? !feedCoversDate(gtfs) : false;

  onMount(async () => {
    timer = setInterval(() => { tick++; refreshLive(); }, 30_000);
    const m = await loadMeta();
    if (m?.built) {
      const d = new Date(m.built);
      // Rodilnik ("julija"), ne Intl imenovalnik ("julij") — glej lib/time.ts.
      if (!isNaN(d.getTime())) feedLabel = `Velja od ${fmtMonthYearGenitive(d)}`;
    }
  });
  onDestroy(() => { if (timer) clearInterval(timer); });

  $: nearStops = gtfs
    ? nearestStops(gtfs.stops, origin, 20).filter(s => s.d <= $nearbyRadiusM).slice(0, 8)
    : [];
  $: favStopList = gtfs ? gtfs.stops.filter(s => $favStops.has(s.id)) : [];

  // Set stopId-jev, ki so trenutno na zaslonu. Ob spremembi (premik uporabnika, nova
  // priljubljena postaja) sproži svež fetch — poleg rednega 30 s poll-a.
  $: stopIdsKey = Array.from(new Set([...nearStops.map(s => s.id), ...favStopList.map(s => s.id)]))
    .sort((a, b) => a - b).join(',');
  $: if (gtfs && stopIdsKey && stopIdsKey !== lastFetchedKey) {
    lastFetchedKey = stopIdsKey;
    refreshLive();
  }

  // routeId lookup po route_short_name — za pravilno barvo LineBadge iz OBA LineCode.
  $: routeIdByShort = gtfs
    ? new Map(gtfs.routes.map(r => [r.short.toLowerCase(), r.id]))
    : new Map<string, number>();

  async function refreshLive() {
    if (!gtfs) return;
    if (document.hidden) return; // app v ozadju — ne trosi proxy kvote
    const ids = Array.from(new Set([...nearStops.map(s => s.id), ...favStopList.map(s => s.id)]));
    if (ids.length === 0) return;
    const results = await Promise.allSettled(
      ids.map(async id => [id, await fetchArrivalsForStopPoint(id)] as const)
    );
    const next: Record<number, StopArrival[]> = { ...liveByStop };
    for (const r of results) {
      if (r.status === 'fulfilled') {
        next[r.value[0]] = r.value[1];
        liveAt[r.value[0]] = Date.now();
      }
    }
    liveByStop = next;
  }

  function liveRows(arr: StopArrival[]): BoardRow[] {
    return arr.slice(0, 3).map(a => {
      const [hh, mm] = (a.arrivalTime || '0:0').split(':').map(Number);
      return {
        routeId: routeIdByShort.get(a.lineCode.toLowerCase()) ?? a.lineId,
        routeShort: a.lineCode,
        headsign: a.headsign,
        minutesFromNow: a.etaMin,
        depSec: (hh || 0) * 3600 + (mm || 0) * 60,
      };
    });
  }

  function gtfsRows(stopId: number): BoardRow[] {
    if (!gtfs) return [];
    return upcomingDepartures(gtfs, stopId, new Date(), 3).map(d => ({
      routeId: d.route.id,
      routeShort: d.route.short,
      headsign: d.trip.headsign,
      minutesFromNow: d.minutesFromNow,
      depSec: d.depSec,
    }));
  }

  function rowsFor(stopId: number): BoardRow[] {
    const live = liveByStop[stopId];
    // Zivi podatki veljajo 2 min od zadnjega uspesnega fetcha; starejsi
    // padejo nazaj na GTFS (etaMin iz starega fetcha je ze zlagan).
    const fresh = Date.now() - (liveAt[stopId] ?? 0) < 120_000;
    return (live && live.length > 0 && fresh) ? liveRows(live) : gtfsRows(stopId);
  }

  // Ali je za katero od prikazanih postaj na voljo živ podatek — od tega je odvisno,
  // ali pika ob naslovu utripa zeleno ("V živo") ali miruje ("Po voznem redu").
  function anyLive(list: { id: number }[], _live: typeof liveByStop, _tick: number): boolean {
    return list.some(s => (liveByStop[s.id]?.length ?? 0) > 0 && Date.now() - (liveAt[s.id] ?? 0) < 120_000);
  }

  // Eksplicitni parametri namesto comma-operator trika — TS-cisto, odvisnosti jasne.
  function makeBoards<T extends Stop>(g: GTFS | null, list: T[], _live: typeof liveByStop, _tick: number) {
    if (!g) return [];
    // Postajališči z istim imenom sta par čez cesto — brez namiga o smeri ju
    // uporabnik ne razlikuje (na Domu sta prej dvakrat pisala "UKC - Pobreška").
    const nameCount = new Map<string, number>();
    for (const s of list) nameCount.set(s.name, (nameCount.get(s.name) ?? 0) + 1);
    return list.map(s => {
      const rows = rowsFor(s.id);
      return {
        stop: s as Stop,
        rows,
        directionHint: (nameCount.get(s.name) ?? 0) > 1 ? (rows[0]?.headsign ?? '') : '',
      };
    });
  }
  $: boards = makeBoards(gtfs, nearStops, liveByStop, tick);
  $: favBoards = makeBoards(gtfs, favStopList, liveByStop, tick);
  $: nearLive = anyLive(nearStops, liveByStop, tick);
  $: favLive = anyLive(favStopList, liveByStop, tick);

  async function refresh() {
    await onRequestLocation();
    tick++;
    refreshLive();
  }
</script>

<Screen title="Dom" onRefresh={refresh}>
  <div class="px-4 pb-6 space-y-4 max-w-screen-sm mx-auto">
    <!-- Greeting / context strip -->
    <div class="flex items-start justify-between">
      <div class="min-w-0">
        <div class="t-subhead text-muted">
          {#if hasGeo}Blizu tebe{:else}Središče Maribora{/if}
        </div>
        {#if feedExpired}
          <div class="t-footnote mt-0.5" style="color: var(--status-delay)">Vozni redi so zastareli — preveri posodobitev</div>
        {:else if feedLabel}
          <div class="t-footnote text-muted mt-0.5">{feedLabel}</div>
        {/if}
      </div>
      {#if weather}
        <button class="pressable t-subhead flex items-center gap-1.5 rounded-full px-2.5 py-1 -mr-1 surface-2 border border-base shrink-0"
                on:click={onOpenWeather} aria-label="Podrobno vreme">
          <span>{weather.emoji}</span>
          <span class="font-semibold">{weather.tempC}°</span>
          <span class="text-muted">{weather.label}</span>
        </button>
      {/if}
    </div>

    <!-- Quick action: plan a route -->
    <button class="pressable w-full rounded-2xl p-4 text-left shadow-card flex items-center gap-3"
            style="background: linear-gradient(135deg, var(--accent), var(--accent-pressed)); color: white;"
            on:click={onOpenPlanner}>
      <div class="w-11 h-11 rounded-xl grid place-items-center" style="background: rgba(255,255,255,0.18)">
        <MapPinned size={22} strokeWidth={2} />
      </div>
      <div class="flex-1 min-w-0">
        <div class="t-headline">Kam greš?</div>
        <div class="t-footnote" style="opacity: 0.85">Načrtuj pot z avtobusom ali peš</div>
      </div>
    </button>

    <!-- Nearby boards (toggable v nastavitvah) -->
    {#if $homeShowNearby}
    {#if !gtfs}
      {#each Array(3) as _}
        <div class="surface rounded-2xl border border-base p-4 space-y-3">
          <Skeleton height="20px" width="60%" />
          <Skeleton height="40px" />
          <Skeleton height="40px" />
        </div>
      {/each}
    {:else if !hasGeo}
      <EmptyState icon={MapPinned} title="Dovoli lokacijo" body="Omogoči dostop do lokacije, da vidiš odhode iz najbližjih postajališč.">
        <button class="pressable h-11 px-5 rounded-xl t-subhead font-semibold"
                style="background: var(--accent); color: #ffffff;"
                on:click={refresh}>Omogoči lokacijo</button>
      </EmptyState>
    {:else if boards.length === 0}
      <EmptyState icon={CloudOff} title="Ni postajališč v bližini" body="Premakni se bližje središču mesta." />
    {:else}
      <div class="flex items-center justify-between pt-1">
        <h2 class="t-footnote text-muted uppercase tracking-wide">Najbližja postajališča</h2>
        <LiveDot live={nearLive} label={nearLive ? 'V živo' : 'Po voznem redu'} />
      </div>

      {#each boards as b (b.stop.id)}
        <StopBoard {gtfs} stop={b.stop} rows={b.rows} directionHint={b.directionHint}
                   distanceM={(b.stop as any).d} onSelect={onStopSelect} />
      {/each}
    {/if}
    {/if}

    {#if $homeShowFavs && favBoards.length > 0}
      <div class="flex items-center justify-between pt-2">
        <h2 class="t-footnote text-muted uppercase tracking-wide">Priljubljena postajališča</h2>
        <LiveDot live={favLive} label={favLive ? 'V živo' : 'Po voznem redu'} />
      </div>
      {#each favBoards as b (b.stop.id)}
        <StopBoard {gtfs} stop={b.stop} rows={b.rows} directionHint={b.directionHint}
                   starred onSelect={onStopSelect} />
      {/each}
    {/if}
  </div>
</Screen>
