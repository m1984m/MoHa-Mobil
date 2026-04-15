<script lang="ts">
  import { Search, X, Star } from 'lucide-svelte';
  import type { GTFS, Stop } from '../gtfs';
  import Screen from '../ui/Screen.svelte';
  import EmptyState from '../ui/EmptyState.svelte';
  import { favStops } from '../favorites';

  export let gtfs: GTFS | null;
  export let onStopSelect: (s: Stop) => void;

  let query = '';
  let inputEl: HTMLInputElement;

  $: results = gtfs && query.trim()
    ? gtfs.stops
        .filter(s => s.name.toLowerCase().includes(query.trim().toLowerCase()))
        .slice(0, 30)
    : [];

  $: favStopObjs = gtfs ? gtfs.stops.filter(s => $favStops.has(s.id)) : [];
</script>

<Screen title="Iskanje">
  <div class="px-4 space-y-4 max-w-screen-sm mx-auto">
    <!-- Search field -->
    <div class="relative">
      <Search size={18} color="var(--text-muted)" strokeWidth={2}
              class="absolute left-3 top-1/2 -translate-y-1/2" />
      <input bind:this={inputEl} bind:value={query}
             type="search" autocomplete="off"
             placeholder="Poišči postajo ali linijo"
             class="w-full h-12 rounded-xl surface-2 border border-base pl-10 pr-10 t-body outline-none focus:border-accent" />
      {#if query}
        <button class="pressable absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full surface-3 grid place-items-center"
                on:click={() => { query = ''; inputEl?.focus(); }} aria-label="Počisti">
          <X size={16} />
        </button>
      {/if}
    </div>

    {#if !query && favStopObjs.length > 0}
      <div>
        <div class="t-footnote text-muted uppercase tracking-wide mb-2 flex items-center gap-1.5">
          <Star size={13} fill="var(--status-delay)" color="var(--status-delay)" />
          Priljubljena
        </div>
        <ul class="surface rounded-2xl border border-base overflow-hidden shadow-card">
          {#each favStopObjs as s, i}
            <button class="pressable w-full min-h-[56px] px-4 flex items-center gap-3 text-left {i < favStopObjs.length - 1 ? 'border-b border-base' : ''}"
                    on:click={() => onStopSelect(s)}>
              <div class="flex-1 min-w-0">
                <div class="t-body font-medium truncate">{s.name}</div>
                {#if s.code}<div class="t-footnote text-muted">{s.code}</div>{/if}
              </div>
              <span class="text-muted">›</span>
            </button>
          {/each}
        </ul>
      </div>
    {/if}

    {#if query && results.length === 0}
      <EmptyState icon={Search} title="Brez zadetkov" body="Poskusi z drugo besedo ali preveri črkovanje." />
    {:else if results.length > 0}
      <div>
        <div class="t-footnote text-muted uppercase tracking-wide mb-2">Zadetki</div>
        <ul class="surface rounded-2xl border border-base overflow-hidden shadow-card">
          {#each results as s, i}
            <button class="pressable w-full min-h-[56px] px-4 flex items-center gap-3 text-left {i < results.length - 1 ? 'border-b border-base' : ''}"
                    on:click={() => onStopSelect(s)}>
              <div class="flex-1 min-w-0">
                <div class="t-body font-medium truncate">{s.name}</div>
                {#if s.code}<div class="t-footnote text-muted">{s.code}</div>{/if}
              </div>
              <span class="text-muted">›</span>
            </button>
          {/each}
        </ul>
      </div>
    {:else if !query && favStopObjs.length === 0}
      <EmptyState icon={Search} title="Poišči postajo" body="Vpiši ime ulice ali postajališča za začetek." />
    {/if}
  </div>
</Screen>
