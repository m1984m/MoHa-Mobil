<script lang="ts">
  import { Search, MapPin } from 'lucide-svelte';
  import LineBadge from '../ui/LineBadge.svelte';
  import LineTimetableModal from './LineTimetableModal.svelte';
  import StopTimetableModal from './StopTimetableModal.svelte';
  import type { GTFS, Route, Stop } from '../gtfs';

  export let gtfs: GTFS | null;

  type Mode = 'lines' | 'stops';
  let mode: Mode = 'lines';
  let query = '';

  let lineOpen = false;
  let lineRoute: Route | null = null;
  let stopOpen = false;
  let selectedStop: Stop | null = null;

  $: routes = gtfs
    ? [...gtfs.routes].sort((a, b) => a.short.localeCompare(b.short, 'sl', { numeric: true }))
    : [];

  $: filteredRoutes = query.trim()
    ? routes.filter(r =>
        r.short.toLowerCase().includes(query.trim().toLowerCase()) ||
        r.long.toLowerCase().includes(query.trim().toLowerCase()))
    : routes;

  $: stops = gtfs
    ? query.trim()
      ? gtfs.stops
          .filter(s => s.name.toLowerCase().includes(query.trim().toLowerCase()))
          .slice(0, 40)
      : []
    : [];

  function openLine(r: Route) { lineRoute = r; lineOpen = true; }
  function openStop(s: Stop) { selectedStop = s; stopOpen = true; }
</script>

<div class="absolute inset-0 overflow-y-auto" style="padding-top: env(safe-area-inset-top);">
  <div class="max-w-screen-sm mx-auto px-4 pt-4 pb-28">
    <h1 class="t-title1 font-bold mb-1">Vozni redi</h1>
    <p class="t-footnote text-muted mb-4">Izberi linijo ali poišči postajo za vozni red.</p>

    <div class="surface-2 rounded-xl p-1 flex gap-1 mb-4">
      {#each [{id: 'lines' as Mode, label: 'Linije'}, {id: 'stops' as Mode, label: 'Postaje'}] as t}
        {@const a = mode === t.id}
        <button class="pressable flex-1 h-10 rounded-lg t-subhead font-semibold"
                style="background: {a ? 'var(--accent)' : 'transparent'}; color: {a ? 'white' : 'var(--text)'}"
                on:click={() => { mode = t.id; query = ''; }}>{t.label}</button>
      {/each}
    </div>

    <div class="relative surface-2 rounded-xl border border-base mb-4">
      <Search size={18} color="var(--text-muted)" class="absolute left-3 top-1/2 -translate-y-1/2" />
      <input bind:value={query}
             class="w-full h-12 bg-transparent pl-10 pr-3 t-body outline-none"
             placeholder={mode === 'lines' ? 'Poišči linijo (npr. P16)…' : 'Poišči postajo…'} />
    </div>

    {#if mode === 'lines'}
      {#if filteredRoutes.length === 0}
        <div class="t-body text-muted text-center py-12">Ni zadetkov.</div>
      {:else}
        <div class="grid grid-cols-3 sm:grid-cols-4 gap-3">
          {#each filteredRoutes as r}
            <button class="pressable surface rounded-2xl border border-base shadow-card p-3 flex flex-col items-center gap-2"
                    on:click={() => openLine(r)}>
              <LineBadge short={r.short} routeId={r.id} size="lg" />
              <div class="t-footnote text-muted text-center line-clamp-2">{r.long || '—'}</div>
            </button>
          {/each}
        </div>
      {/if}
    {:else}
      {#if !query.trim()}
        <div class="t-body text-muted text-center py-12">Vnesi ime postaje za iskanje voznega reda.</div>
      {:else if stops.length === 0}
        <div class="t-body text-muted text-center py-12">Ni zadetkov.</div>
      {:else}
        <ul class="surface rounded-2xl border border-base overflow-hidden shadow-card">
          {#each stops as s, i}
            <li>
              <button class="pressable w-full text-left px-4 py-3 flex items-center gap-3 {i > 0 ? 'border-t border-base' : ''}"
                      on:click={() => openStop(s)}>
                <MapPin size={18} color="var(--accent)" />
                <div class="flex-1 min-w-0">
                  <div class="t-body font-medium truncate">{s.name}</div>
                  {#if s.code}<div class="t-footnote text-muted">{s.code}</div>{/if}
                </div>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </div>
</div>

<LineTimetableModal open={lineOpen} {gtfs} route={lineRoute} onClose={() => lineOpen = false} />
<StopTimetableModal open={stopOpen} {gtfs} stop={selectedStop} onClose={() => stopOpen = false} />
