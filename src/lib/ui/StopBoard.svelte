<script context="module" lang="ts">
  // Tip mora biti v module scope, da ga lahko uvozijo zasloni (instance script
  // ne izvaža tipov iz .svelte datoteke).
  export type BoardRow = {
    routeId: number;
    routeShort: string;
    headsign: string;
    minutesFromNow: number;
    depSec: number;
    // Ime končne postaje, kadar ga poznamo (odhod iz voznega reda). Uporabi ga
    // način za starejše, ki cel opis linije ne pokaže — glej splitHeadsign.
    destination?: string;
    // Zamuda iz živega vira. `delayKnown` loči "vemo, da vozi točno" (0) od
    // "zamude ne poznamo" (undefined) — brez tega bi vsak odhod po voznem redu
    // izgledal kot točen.
    delayMin?: number;
    delayKnown?: boolean;
  };
</script>

<script lang="ts">
  import { Bus, Star, MoonStar } from 'lucide-svelte';
  import LineBadge from './LineBadge.svelte';
  import DepartureTime from './DepartureTime.svelte';
  import { compactLists, seniorMode } from '../settings';
  import { nextServiceDeparture, splitHeadsign, type GTFS, type Stop } from '../gtfs';
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
  // V načinu za starejše so vrstice ločene ploskve z razmikom med njimi —
  // sosednji tarči brez praznine zgreši vsak tresoč prst (WCAG 2.5.8).
  $: badgeSize = ($seniorMode ? 'lg' : ($compactLists ? 'sm' : 'md')) as 'sm' | 'md' | 'lg';
</script>

<div class="surface rounded-2xl border border-base shadow-card overflow-hidden">
  <button type="button"
          class="pressable w-full text-left px-4 pt-3 pb-2 flex items-center justify-between gap-3"
          style="touch-action: manipulation;"
          on:click={() => onSelect(stop)}>
    <div class="min-w-0 flex items-center gap-2">
      {#if starred}
        <Star size={$seniorMode ? 21 : 16} fill="var(--status-delay)" color="var(--status-delay)" />
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
    <Bus size={$seniorMode ? 28 : 22} strokeWidth={1.75} color="var(--text-muted)" />
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
    <ul class="mm-board" class:mm-board-roomy={$seniorMode}>
      {#each rows as r}
        {@const split = $seniorMode ? splitHeadsign(r.headsign, r.destination) : null}
        <li class={$seniorMode ? '' : 'border-t border-base'}>
          <button type="button"
                  class="pressable w-full text-left px-4 {rowPad} flex items-center gap-3"
                  style="touch-action: manipulation; min-height: var(--row-min);"
                  on:click={() => onSelect(stop)}
                  aria-label="{r.routeShort} proti {r.headsign}">
            <LineBadge short={r.routeShort} routeId={r.routeId} size={badgeSize} />
            <div class="flex-1 min-w-0">
              {#if split}
                <div class="{rowText} font-semibold">{split.dest}</div>
                {#if split.via}
                  <div class="t-footnote text-muted truncate mt-0.5">prek {split.via}</div>
                {/if}
              {:else}
                <div class="{rowText} font-medium truncate">{r.headsign}</div>
              {/if}
            </div>
            <div class="flex flex-col items-end gap-0.5 shrink-0">
              <DepartureTime minutesFromNow={r.minutesFromNow} depSec={r.depSec} size={$compactLists ? 'sm' : 'md'} />
              {#if r.delayKnown && Math.abs(r.delayMin ?? 0) >= 1}
                {@const d = r.delayMin ?? 0}
                {@const barva = Math.abs(d) > 5 ? 'var(--status-disrupt)' : Math.abs(d) >= 3 ? 'var(--status-delay)' : 'var(--status-ontime)'}
                <span class="px-1.5 rounded-full t-footnote font-semibold leading-tight"
                      style="background: color-mix(in oklab, {barva} 16%, transparent); color: {barva}">
                  {d > 0 ? '+' : ''}{d} min
                </span>
              {:else if r.delayKnown}
                <span class="t-footnote" style="color: var(--status-ontime)">točno</span>
              {/if}
            </div>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  /* Razmik med tarčami namesto skupne črte. Vklopi ga --row-gap, ki ga postavi
     način za starejše; v privzetem načinu je 0 in postavitev ostane, kot je bila. */
  .mm-board-roomy {
    display: flex;
    flex-direction: column;
    gap: var(--row-gap);
    padding: var(--row-gap);
    border-top: 1px solid var(--border);
  }
  .mm-board-roomy li {
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
  }
</style>
