<script lang="ts">
  import { onDestroy } from 'svelte';
  import { loadIjpp, ijppDeparturesNear, hasIjppNear, type IjppDeparture } from '../ijpp';
  import { splitHeadsign, textOnColor } from '../gtfs';
  import { nowMb } from '../clock';
  import { t } from '../i18n';
  import { compactLists } from '../settings';
  import DepartureTime from './DepartureTime.svelte';

  // Medkrajevni odhodi (IJPP) ob izbranem Marpromovem postajališču — ločen razdelek z
  // oznako in barvo prevoznika, samo vozni red (brez podatkov v živo).
  export let stop: { lat: number; lon: number } | null;

  let data: Awaited<ReturnType<typeof loadIjpp>> = null;
  let tick = 0;
  const timer = setInterval(() => tick++, 30_000);
  onDestroy(() => clearInterval(timer));

  $: if (stop && !data) loadIjpp().then(j => { data = j; });
  $: near = !!(data && stop && hasIjppNear(data, stop));
  let rows: IjppDeparture[] = [];
  $: rows = (tick, data && stop && near ? ijppDeparturesNear(data, stop, nowMb()) : []);
</script>

{#if near}
  <section class="mt-4" aria-labelledby="ijpp-h">
    <h3 id="ijpp-h" class="t-footnote font-semibold uppercase tracking-wide text-muted px-1 mb-1.5">{$t('Medkrajevni odhodi')}</h3>
    {#if rows.length === 0}
      <div class="surface-2 rounded-2xl p-4 t-callout text-muted">{$t('Danes ni več medkrajevnih odhodov.')}</div>
    {:else}
      <ul class="surface rounded-2xl border border-base overflow-hidden" style="border-left: 4px solid #8E6CCB">
        {#each rows as d, i}
          {@const cilj = splitHeadsign(d.headsign)}
          <li class="px-4 {$compactLists ? 'py-1.5' : 'py-3'} flex items-center gap-3 {i > 0 ? 'border-t border-base' : ''}">
            <span class="inline-flex items-center justify-center rounded-lg font-bold h-7 min-w-[2rem] px-2 text-[12px] shrink-0"
                  style="background-color: {d.color}; color: {textOnColor(d.color)}">
              {d.rail ? $t('Vlak') : d.agency}
            </span>
            <div class="flex-1 min-w-0">
              <div class="t-callout font-medium truncate">{cilj.dest}</div>
              {#if !$compactLists}
                <div class="t-footnote text-muted truncate">{d.rail ? 'SŽ' : d.line} · {d.stopName}</div>
              {/if}
            </div>
            <div class="shrink-0">
              <DepartureTime minutesFromNow={d.minutesFromNow} depSec={d.depSec} size={$compactLists ? 'sm' : 'md'} />
            </div>
          </li>
        {/each}
      </ul>
    {/if}
    <p class="t-footnote text-muted px-1 mt-1.5">{$t('Medkrajevni prevozniki, vozni red brez podatkov v živo.')}</p>
  </section>
{/if}
