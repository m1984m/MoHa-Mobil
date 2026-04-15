<script lang="ts">
  import { Star, Trash2, Route as RouteIcon, ArrowRight, X } from 'lucide-svelte';
  import type { GTFS, Stop } from '../gtfs';
  import { upcomingDepartures } from '../gtfs';
  import Screen from '../ui/Screen.svelte';
  import EmptyState from '../ui/EmptyState.svelte';
  import LineBadge from '../ui/LineBadge.svelte';
  import { favStops } from '../favorites';
  import { savedRoutes, type SavedRoute } from '../savedRoutes';
  import { onMount, onDestroy } from 'svelte';

  export let gtfs: GTFS | null;
  export let onStopSelect: (s: Stop) => void;
  export let onRunSavedRoute: (r: SavedRoute) => void = () => {};

  let tick = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  onMount(() => { timer = setInterval(() => tick++, 30_000); });
  onDestroy(() => { if (timer) clearInterval(timer); });

  $: favList = gtfs ? gtfs.stops.filter(s => $favStops.has(s.id)) : [];
  $: boards = (tick, gtfs)
    ? favList.map(s => ({ stop: s, deps: upcomingDepartures(gtfs!, s.id, new Date(), 2) }))
    : [];

  function clearAll() {
    if (confirm('Počisti vse priljubljene postaje?')) favStops.clear();
  }
</script>

<Screen title="Priljubljene">
  <div class="px-4 max-w-screen-sm mx-auto space-y-3">
    {#if $savedRoutes.length > 0}
      <div class="t-footnote text-muted uppercase tracking-wide mt-1">Shranjene poti</div>
      {#each $savedRoutes as r}
        <div class="surface rounded-2xl border border-base shadow-card flex items-stretch overflow-hidden">
          <button class="pressable flex-1 text-left px-4 py-3"
                  on:click={() => onRunSavedRoute(r)}>
            <div class="flex items-center gap-2 mb-1">
              <RouteIcon size={16} color="var(--accent)" />
              <div class="t-title3 font-semibold flex-1 truncate">{r.label}</div>
            </div>
            <div class="flex items-center gap-1.5 t-footnote text-muted">
              <span class="truncate">{r.from.name}</span>
              <ArrowRight size={12} />
              <span class="truncate">{r.to.name}</span>
            </div>
          </button>
          <button class="pressable w-12 grid place-items-center border-l border-base shrink-0"
                  on:click={() => savedRoutes.remove(r.id)} aria-label="Odstrani">
            <X size={16} />
          </button>
        </div>
      {/each}
      <div class="t-footnote text-muted uppercase tracking-wide pt-2">Postajališča</div>
    {/if}

    {#if favList.length === 0 && $savedRoutes.length === 0}
      <EmptyState icon={Star} title="Še ni priljubljenih" body="Dodaj postajo s pritiskom na zvezdico ali shrani pot iz načrtovalca." />
    {:else if favList.length > 0}
      <div class="flex items-center justify-between">
        <div class="t-footnote text-muted">{favList.length} {favList.length === 1 ? 'postaja' : favList.length < 5 ? 'postaje' : 'postaj'}</div>
        <button class="pressable t-footnote text-muted flex items-center gap-1" on:click={clearAll}>
          <Trash2 size={14} /> Počisti
        </button>
      </div>
      {#each boards as b}
        <div class="surface rounded-2xl border border-base shadow-card flex items-stretch overflow-hidden">
          <button class="pressable flex-1 text-left min-w-0"
                  on:click={() => onStopSelect(b.stop)}>
            <div class="px-4 pt-3 pb-2 flex items-center gap-2">
              <Star size={16} fill="var(--status-delay)" color="var(--status-delay)" />
              <div class="t-title3 font-semibold flex-1 truncate">{b.stop.name}</div>
            </div>
            {#if b.deps.length === 0}
              <div class="px-4 pb-3 t-footnote text-muted">Danes ni več odhodov</div>
            {:else}
              <ul>
                {#each b.deps as d}
                  <li class="px-4 py-2.5 flex items-center gap-3 border-t border-base">
                    <LineBadge short={d.route.short} routeId={d.route.id} size="md" />
                    <div class="flex-1 min-w-0 t-callout truncate">{d.trip.headsign}</div>
                    <div class="text-right leading-none">
                      {#if d.minutesFromNow <= 0}
                        <span class="t-title3 font-bold" style="color: var(--status-ontime)">zdaj</span>
                      {:else}
                        <span class="t-title2 font-bold">{d.minutesFromNow}</span>
                        <span class="t-footnote text-muted ml-0.5">min</span>
                      {/if}
                    </div>
                  </li>
                {/each}
              </ul>
            {/if}
          </button>
          <button class="pressable w-12 grid place-items-center border-l border-base shrink-0"
                  on:click={() => favStops.toggle(b.stop.id)}
                  aria-label="Odstrani iz priljubljenih">
            <X size={16} />
          </button>
        </div>
      {/each}
    {/if}
  </div>
</Screen>
