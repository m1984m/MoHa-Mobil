<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { MapPinned, Bus, CloudOff, Star } from 'lucide-svelte';
  import { nearestStops, upcomingDepartures, type GTFS, type Stop } from '../gtfs';
  import type { Weather } from '../weather';
  import Screen from '../ui/Screen.svelte';
  import LineBadge from '../ui/LineBadge.svelte';
  import LiveDot from '../ui/LiveDot.svelte';
  import Skeleton from '../ui/Skeleton.svelte';
  import EmptyState from '../ui/EmptyState.svelte';
  import DepartureTime from '../ui/DepartureTime.svelte';
  import { favStops } from '../favorites';
  import { homeShowNearby, homeShowFavs, nearbyRadiusM, compactLists } from '../settings';
  import { fetchArrivalsForStopPoint, type StopArrival } from '../realtime';

  export let gtfs: GTFS | null;
  export let origin: { lat: number; lon: number };
  export let hasGeo: boolean;
  export let weather: Weather | null;
  export let onStopSelect: (s: Stop) => void;
  export let onOpenPlanner: () => void;
  export let onRequestLocation: () => Promise<void>;
  export let onOpenWeather: () => void = () => {};

  type Row = {
    routeId: number;
    routeShort: string;
    headsign: string;
    minutesFromNow: number;
    depSec: number;
  };

  let tick = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let liveByStop: Record<number, StopArrival[]> = {};
  let lastFetchedKey = '';

  onMount(() => {
    timer = setInterval(() => { tick++; refreshLive(); }, 30_000);
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
    const ids = Array.from(new Set([...nearStops.map(s => s.id), ...favStopList.map(s => s.id)]));
    if (ids.length === 0) return;
    const results = await Promise.allSettled(
      ids.map(async id => [id, await fetchArrivalsForStopPoint(id)] as const)
    );
    const next: Record<number, StopArrival[]> = { ...liveByStop };
    for (const r of results) {
      if (r.status === 'fulfilled') next[r.value[0]] = r.value[1];
    }
    liveByStop = next;
  }

  function liveRows(arr: StopArrival[]): Row[] {
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

  function gtfsRows(stopId: number): Row[] {
    if (!gtfs) return [];
    return upcomingDepartures(gtfs, stopId, new Date(), 3).map(d => ({
      routeId: d.route.id,
      routeShort: d.route.short,
      headsign: d.trip.headsign,
      minutesFromNow: d.minutesFromNow,
      depSec: d.depSec,
    }));
  }

  function rowsFor(stopId: number): Row[] {
    const live = liveByStop[stopId];
    return (live && live.length > 0) ? liveRows(live) : gtfsRows(stopId);
  }

  $: boards = (tick, gtfs, liveByStop, nearStops)
    ? nearStops.map(s => ({ stop: s, rows: rowsFor(s.id) }))
    : [];
  $: favBoards = (tick, gtfs, liveByStop, favStopList)
    ? favStopList.map(s => ({ stop: s, rows: rowsFor(s.id) }))
    : [];

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
        <div class="t-footnote text-muted mt-0.5">Velja od februar 2026</div>
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
        <div class="t-footnote text-muted uppercase tracking-wide">Najbližja postajališča</div>
        <LiveDot />
      </div>

      {#each boards as b}
        <button class="pressable w-full text-left surface rounded-2xl border border-base shadow-card overflow-hidden"
                on:click={() => onStopSelect(b.stop)}>
          <div class="px-4 pt-3 pb-2 flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="t-title3 font-semibold truncate">{b.stop.name}</div>
              <div class="t-footnote text-muted">
                {Math.round((b.stop as any).d)} m stran{#if b.stop.code} · {b.stop.code}{/if}
              </div>
            </div>
            <Bus size={22} strokeWidth={1.75} color="var(--text-muted)" />
          </div>
          {#if b.rows.length === 0}
            <div class="px-4 pb-3 t-footnote text-muted">Danes ni več odhodov</div>
          {:else}
            <ul>
              {#each b.rows as r}
                <li class="px-4 {$compactLists ? 'py-1.5' : 'py-2.5'} flex items-center gap-3 border-t border-base">
                  <LineBadge short={r.routeShort} routeId={r.routeId} size={$compactLists ? 'sm' : 'md'} />
                  <div class="flex-1 min-w-0">
                    <div class="{$compactLists ? 't-subhead' : 't-callout'} font-medium truncate">{r.headsign}</div>
                  </div>
                  <DepartureTime minutesFromNow={r.minutesFromNow} depSec={r.depSec} size={$compactLists ? 'sm' : 'md'} />
                </li>
              {/each}
            </ul>
          {/if}
        </button>
      {/each}
    {/if}
    {/if}

    {#if $homeShowFavs && favBoards.length > 0}
      <div class="flex items-center justify-between pt-2">
        <div class="t-footnote text-muted uppercase tracking-wide">Priljubljena postajališča</div>
        <LiveDot />
      </div>
      {#each favBoards as b}
        <button class="pressable w-full text-left surface rounded-2xl border border-base shadow-card overflow-hidden"
                on:click={() => onStopSelect(b.stop)}>
          <div class="px-4 pt-3 pb-2 flex items-center justify-between gap-3">
            <div class="min-w-0 flex items-center gap-2">
              <Star size={16} fill="var(--status-delay)" color="var(--status-delay)" />
              <div class="min-w-0">
                <div class="t-title3 font-semibold truncate">{b.stop.name}</div>
                {#if b.stop.code}<div class="t-footnote text-muted">{b.stop.code}</div>{/if}
              </div>
            </div>
            <Bus size={22} strokeWidth={1.75} color="var(--text-muted)" />
          </div>
          {#if b.rows.length === 0}
            <div class="px-4 pb-3 t-footnote text-muted">Danes ni več odhodov</div>
          {:else}
            <ul>
              {#each b.rows as r}
                <li class="px-4 {$compactLists ? 'py-1.5' : 'py-2.5'} flex items-center gap-3 border-t border-base">
                  <LineBadge short={r.routeShort} routeId={r.routeId} size={$compactLists ? 'sm' : 'md'} />
                  <div class="flex-1 min-w-0">
                    <div class="{$compactLists ? 't-subhead' : 't-callout'} font-medium truncate">{r.headsign}</div>
                  </div>
                  <DepartureTime minutesFromNow={r.minutesFromNow} depSec={r.depSec} size={$compactLists ? 'sm' : 'md'} />
                </li>
              {/each}
            </ul>
          {/if}
        </button>
      {/each}
    {/if}
  </div>
</Screen>
