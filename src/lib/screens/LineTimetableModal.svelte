<script lang="ts">
  import { X, ArrowRightLeft } from 'lucide-svelte';
  import LineBadge from '../ui/LineBadge.svelte';
  import { allTripsForRouteDirection, dayKindToDate, type GTFS, type Route, type Trip, type DayKind } from '../gtfs';

  export let open = false;
  export let gtfs: GTFS | null;
  export let route: Route | null;
  export let initialDir: number = 0;
  export let onClose: () => void;

  let day: DayKind = detectToday();
  let dir: number = initialDir;

  $: if (open) dir = initialDir;

  function detectToday(): DayKind {
    const d = new Date().getDay();
    return d === 0 ? 'sunday' : d === 6 ? 'saturday' : 'weekday';
  }

  const days: { id: DayKind; label: string }[] = [
    { id: 'weekday', label: 'Delavnik' },
    { id: 'saturday', label: 'Sobota' },
    { id: 'sunday', label: 'Nedelja' },
  ];

  $: trips = gtfs && route ? allTripsForRouteDirection(gtfs, route.id, dir, dayKindToDate(day)) : [];
  // Unique terminal names per direction (headsign of first trip in that direction)
  $: dirHeadsigns = gtfs && route ? (() => {
    const out = new Map<number, string>();
    for (const t of gtfs.trips) {
      if (t.route !== route.id) continue;
      if (!out.has(t.dir)) out.set(t.dir, t.headsign);
    }
    return out;
  })() : new Map<number, string>();

  $: dirOptions = [...dirHeadsigns.entries()].sort((a, b) => a[0] - b[0]);

  function fmtTime(sec: number): string {
    const h = Math.floor(sec / 3600) % 24;
    const m = Math.floor((sec % 3600) / 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function swapDir() {
    const others = dirOptions.filter(([d]) => d !== dir);
    if (others.length > 0) dir = others[0][0];
  }
</script>

{#if open && route}
  <div class="fixed inset-0 z-50 flex flex-col"
       style="background: rgba(0,0,0,0.45); backdrop-filter: blur(6px);"
       on:click|self={onClose}
       role="dialog"
       aria-modal="true">
    <div class="surface w-full sm:max-w-lg mx-auto mt-auto rounded-t-3xl sm:rounded-3xl sm:my-8 shadow-float flex flex-col overflow-hidden"
         style="max-height: calc(100dvh - 2rem);">
      <div class="flex items-center gap-3 px-5 pt-4 pb-2 shrink-0">
        <LineBadge short={route.short} routeId={route.id} size="lg" />
        <div class="min-w-0 flex-1">
          <div class="t-footnote text-muted uppercase tracking-wide">Linija</div>
          <div class="t-title3 truncate">{route.long || route.short}</div>
        </div>
        <button class="pressable w-9 h-9 rounded-full surface-2 grid place-items-center"
                on:click={onClose} aria-label="Zapri">
          <X size={18} />
        </button>
      </div>

      <div class="px-5 pb-2 shrink-0 flex items-center gap-2">
        <div class="flex-1 min-w-0 surface-2 rounded-xl px-3 py-2">
          <div class="t-footnote text-muted">Smer</div>
          <div class="t-body font-semibold truncate">{dirHeadsigns.get(dir) || '—'}</div>
        </div>
        {#if dirOptions.length > 1}
          <button class="pressable w-10 h-10 rounded-full surface-2 grid place-items-center"
                  on:click={swapDir} aria-label="Zamenjaj smer">
            <ArrowRightLeft size={16} />
          </button>
        {/if}
      </div>

      <div class="px-5 pb-3 shrink-0">
        <div class="surface-2 rounded-xl p-1 flex gap-1">
          {#each days as d}
            {@const a = day === d.id}
            <button class="pressable flex-1 h-9 rounded-lg t-subhead"
                    style="background: {a ? 'var(--accent)' : 'transparent'}; color: {a ? 'white' : 'var(--text)'}"
                    on:click={() => day = d.id}>{d.label}</button>
          {/each}
        </div>
      </div>

      <div class="flex-1 overflow-y-auto px-5 pb-5">
        {#if trips.length === 0}
          <div class="t-body text-muted text-center py-8">Ta dan ni voženj v izbrani smeri.</div>
        {:else}
          <div class="t-footnote text-muted mb-2">{trips.length} voženj</div>
          <ul class="surface rounded-2xl border border-base overflow-hidden">
            {#each trips as t, i}
              {@const first = t.stops[0]}
              {@const last = t.stops[t.stops.length - 1]}
              {@const durSec = (last?.[1] ?? 0) - (first?.[2] ?? 0)}
              <li class="px-4 py-3 flex items-center gap-3 {i > 0 ? 'border-t border-base' : ''}">
                <div class="tabular-nums font-bold w-12">{fmtTime(first?.[2] ?? 0)}</div>
                <div class="t-footnote text-muted">→</div>
                <div class="tabular-nums font-bold w-12">{fmtTime(last?.[1] ?? 0)}</div>
                <div class="ml-auto t-footnote text-muted">{Math.round(durSec / 60)}′ · {t.stops.length} post.</div>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  </div>
{/if}
