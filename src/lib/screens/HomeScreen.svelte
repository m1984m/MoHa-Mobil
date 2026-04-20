<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { MapPinned, Bus, CloudOff, Star } from 'lucide-svelte';
  import { nearestStops, upcomingDepartures, loadMeta, type GTFS, type Stop, type GtfsMeta } from '../gtfs';
  import type { Weather } from '../weather';
  import Screen from '../ui/Screen.svelte';
  import LineBadge from '../ui/LineBadge.svelte';
  import LiveDot from '../ui/LiveDot.svelte';
  import Skeleton from '../ui/Skeleton.svelte';
  import EmptyState from '../ui/EmptyState.svelte';
  import DepartureTime from '../ui/DepartureTime.svelte';
  import { favStops } from '../favorites';
  import { homeShowNearby, homeShowFavs, nearbyRadiusM, compactLists } from '../settings';

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
  let gtfsMeta: GtfsMeta | null = null;

  const GTFS_DATE_FMT = new Intl.DateTimeFormat('sl-SI', { day: 'numeric', month: 'numeric', year: 'numeric' });
  $: gtfsDateLabel = gtfsMeta ? GTFS_DATE_FMT.format(new Date(gtfsMeta.built)) : '';

  onMount(async () => {
    timer = setInterval(() => tick++, 30_000);
    gtfsMeta = await loadMeta();
  });
  onDestroy(() => { if (timer) clearInterval(timer); });

  $: nearStops = gtfs
    ? nearestStops(gtfs.stops, origin, 20).filter(s => s.d <= $nearbyRadiusM).slice(0, 8)
    : [];
  $: boards = (tick, gtfs)
    ? nearStops.map(s => ({
        stop: s,
        deps: upcomingDepartures(gtfs!, s.id, new Date(), 3),
      }))
    : [];
  $: favBoards = (tick, gtfs)
    ? gtfs.stops
        .filter(s => $favStops.has(s.id))
        .map(s => ({ stop: s, deps: upcomingDepartures(gtfs!, s.id, new Date(), 3) }))
    : [];

  async function refresh() {
    await onRequestLocation();
    tick++;
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
        {#if gtfsMeta}
          <div class="t-footnote text-muted mt-0.5">Vozni red velja od: {gtfsDateLabel}</div>
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
          {#if b.deps.length === 0}
            <div class="px-4 pb-3 t-footnote text-muted">Danes ni več odhodov</div>
          {:else}
            <ul>
              {#each b.deps as d}
                <li class="px-4 {$compactLists ? 'py-1.5' : 'py-2.5'} flex items-center gap-3 border-t border-base">
                  <LineBadge short={d.route.short} routeId={d.route.id} size={$compactLists ? 'sm' : 'md'} />
                  <div class="flex-1 min-w-0">
                    <div class="{$compactLists ? 't-subhead' : 't-callout'} font-medium truncate">{d.trip.headsign}</div>
                  </div>
                  <DepartureTime minutesFromNow={d.minutesFromNow} depSec={d.depSec} size={$compactLists ? 'sm' : 'md'} />
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
          {#if b.deps.length === 0}
            <div class="px-4 pb-3 t-footnote text-muted">Danes ni več odhodov</div>
          {:else}
            <ul>
              {#each b.deps as d}
                <li class="px-4 {$compactLists ? 'py-1.5' : 'py-2.5'} flex items-center gap-3 border-t border-base">
                  <LineBadge short={d.route.short} routeId={d.route.id} size={$compactLists ? 'sm' : 'md'} />
                  <div class="flex-1 min-w-0">
                    <div class="{$compactLists ? 't-subhead' : 't-callout'} font-medium truncate">{d.trip.headsign}</div>
                  </div>
                  <DepartureTime minutesFromNow={d.minutesFromNow} depSec={d.depSec} size={$compactLists ? 'sm' : 'md'} />
                </li>
              {/each}
            </ul>
          {/if}
        </button>
      {/each}
    {/if}
  </div>
</Screen>
