<script context="module" lang="ts">
  // Tip mora biti v module scope, da ga lahko uvozijo zasloni (instance script
  // ne izvaža tipov iz .svelte datoteke).
  export type BoardRow = {
    routeId: number;
    routeShort: string;
    headsign: string;
    minutesFromNow: number;
    depSec: number;
  };
</script>

<script lang="ts">
  import { Bus, Star, MoonStar } from 'lucide-svelte';
  import LineBadge from './LineBadge.svelte';
  import DepartureTime from './DepartureTime.svelte';
  import { compactLists } from '../settings';
  import { nextServiceDeparture, type GTFS, type Stop } from '../gtfs';
  import { fmtClock, fmtDayOffset } from '../time';

  // Skupna kartica postaje z odhodi. Prej sta bila na Domu dva identična bloka
  // (bližnje + priljubljene) — vsak popravek je bilo treba narediti dvakrat.
  //
  // Struktura je namenoma header-gumb + gumb na vsaki vrstici, NE en velik <button>
  // čez celo kartico: bralnik zaslona je prej prebral ime postaje in vse tri odhode
  // kot eno samo, nerazumljivo oznako gumba.

  export let gtfs: GTFS | null = null;
  export let stop: Stop;
  export let rows: BoardRow[] = [];
  export let distanceM: number | null = null;
  export let starred = false;
  // Smer, ki loči dve postajališči z istim imenom (par čez cesto).
  export let directionHint: string = '';
  export let onSelect: (s: Stop) => void;

  // Izračuna se samo, kadar danes ni več odhodov — takrat je "Danes ni več odhodov"
  // slepa ulica brez podatka, kdaj gre naslednji.
  $: nextDay = (rows.length === 0 && gtfs) ? nextServiceDeparture(gtfs, stop.id) : null;

  $: rowPad = $compactLists ? 'py-1.5' : 'py-2.5';
  $: rowText = $compactLists ? 't-subhead' : 't-callout';
</script>

<div class="surface rounded-2xl border border-base shadow-card overflow-hidden">
  <button type="button"
          class="pressable w-full text-left px-4 pt-3 pb-2 flex items-center justify-between gap-3"
          style="touch-action: manipulation;"
          on:click={() => onSelect(stop)}>
    <div class="min-w-0 flex items-center gap-2">
      {#if starred}
        <Star size={16} fill="var(--status-delay)" color="var(--status-delay)" />
      {/if}
      <div class="min-w-0">
        <div class="t-title3 font-semibold truncate">{stop.name}</div>
        <div class="t-footnote text-muted truncate">
          {#if distanceM != null}{Math.round(distanceM)} m stran{/if}
          {#if distanceM != null && (directionHint || stop.code)}&nbsp;·&nbsp;{/if}
          {#if directionHint}smer {directionHint}{:else if stop.code}{stop.code}{/if}
        </div>
      </div>
    </div>
    <Bus size={22} strokeWidth={1.75} color="var(--text-muted)" />
  </button>

  {#if rows.length === 0}
    <div class="px-4 pb-3 pt-1 border-t border-base">
      {#if nextDay}
        <div class="flex items-center gap-2">
          <MoonStar size={15} color="var(--text-muted)" />
          <div class="t-footnote text-muted">
            Danes ni več odhodov · prvi {fmtDayOffset(nextDay.dayOffset, nextDay.weekday)} ob
            <span class="font-semibold tabular-nums" style="color: var(--text)">{fmtClock(nextDay.depSec)}</span>
          </div>
          <div class="ml-auto shrink-0">
            <LineBadge short={nextDay.route.short} routeId={nextDay.route.id} size="sm" />
          </div>
        </div>
      {:else}
        <div class="t-footnote text-muted">Danes ni več odhodov</div>
      {/if}
    </div>
  {:else}
    <ul>
      {#each rows as r}
        <li class="border-t border-base">
          <button type="button"
                  class="pressable w-full text-left px-4 {rowPad} flex items-center gap-3"
                  style="touch-action: manipulation;"
                  on:click={() => onSelect(stop)}
                  aria-label="{r.routeShort} proti {r.headsign}">
            <LineBadge short={r.routeShort} routeId={r.routeId} size={$compactLists ? 'sm' : 'md'} />
            <div class="flex-1 min-w-0">
              <div class="{rowText} font-medium truncate">{r.headsign}</div>
            </div>
            <DepartureTime minutesFromNow={r.minutesFromNow} depSec={r.depSec} size={$compactLists ? 'sm' : 'md'} />
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
