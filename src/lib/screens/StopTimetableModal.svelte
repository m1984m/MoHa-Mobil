<script lang="ts">
  import { X } from 'lucide-svelte';
  import LineBadge from '../ui/LineBadge.svelte';
  import { allDeparturesForStop, dayKindToDate, type GTFS, type Stop, type DayKind } from '../gtfs';

  export let open = false;
  export let gtfs: GTFS | null;
  export let stop: Stop | null;
  export let onClose: () => void;

  let day: DayKind = detectToday();

  function detectToday(): DayKind {
    const d = new Date().getDay();
    return d === 0 ? 'sunday' : d === 6 ? 'saturday' : 'weekday';
  }

  const days: { id: DayKind; label: string }[] = [
    { id: 'weekday', label: 'Delavnik' },
    { id: 'saturday', label: 'Sobota' },
    { id: 'sunday', label: 'Nedelja' },
  ];

  $: deps = gtfs && stop ? allDeparturesForStop(gtfs, stop.id, dayKindToDate(day)) : [];

  // Group by hour
  $: grouped = (() => {
    const m = new Map<number, { route: any; trip: any; depSec: number }[]>();
    for (const d of deps) {
      const h = Math.floor(d.depSec / 3600) % 24;
      if (!m.has(h)) m.set(h, []);
      m.get(h)!.push(d);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  })();

  function fmtMin(sec: number): string {
    return String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  }
</script>

{#if open && stop}
  <div class="fixed inset-0 z-50 flex flex-col"
       style="background: rgba(0,0,0,0.45); backdrop-filter: blur(6px);"
       on:click|self={onClose}
       role="dialog"
       aria-modal="true">
    <div class="surface w-full sm:max-w-lg mx-auto mt-auto rounded-t-3xl sm:rounded-3xl sm:my-8 shadow-float flex flex-col overflow-hidden"
         style="max-height: calc(100dvh - 2rem);">
      <div class="flex items-center gap-3 px-5 pt-4 pb-2 shrink-0">
        <div class="min-w-0 flex-1">
          <div class="t-footnote text-muted uppercase tracking-wide">Vozni red</div>
          <div class="t-title2 truncate">{stop.name}</div>
        </div>
        <button class="pressable w-9 h-9 rounded-full surface-2 grid place-items-center"
                on:click={onClose} aria-label="Zapri">
          <X size={18} />
        </button>
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
        {#if deps.length === 0}
          <div class="t-body text-muted text-center py-8">Ni odhodov za izbran dan.</div>
        {:else}
          <ul class="space-y-2">
            {#each grouped as [h, list]}
              <li class="flex gap-3 items-start">
                <div class="w-12 shrink-0 t-title3 font-bold tabular-nums pt-1">{String(h).padStart(2, '0')}</div>
                <div class="flex-1 flex flex-wrap gap-1.5">
                  {#each list as d}
                    <div class="inline-flex items-center gap-1.5 surface-2 rounded-lg pl-1 pr-2 py-1">
                      <LineBadge short={d.route.short} routeId={d.route.id} size="sm" />
                      <span class="t-footnote tabular-nums font-semibold">:{fmtMin(d.depSec)}</span>
                    </div>
                  {/each}
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  </div>
{/if}
