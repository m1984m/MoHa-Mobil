<script lang="ts">
  import { departureDisplay } from '../settings';
  import { fmtClock, fmtDeparture } from '../time';

  export let minutesFromNow: number;
  export let depSec: number;
  export let size: 'sm' | 'md' = 'md';

  // Vse pretvorbe so v lib/time.ts — prej je ta komponenta izpisovala surove
  // minute in ponoči kazala "296 min" namesto "05:10".
  $: lbl = fmtDeparture(minutesFromNow, depSec);
  // "2 h 15" / "05:10" sta širša od dvomestne minute → manjša stopnja pisave,
  // da se v ozki vrstici seznama ne prelomita.
  $: wide = !lbl.now && lbl.unit === null;

  $: numCls = size === 'sm'
    ? 't-subhead font-bold'
    : wide ? 't-title3 font-bold tabular-nums' : 't-title2 font-bold';
  $: nowCls = size === 'sm' ? 't-subhead font-bold' : 't-title3 font-bold';
  $: clockCls = size === 'sm' ? 't-footnote font-semibold tabular-nums' : 't-subhead font-semibold tabular-nums';
  // V načinu "oboje" je pripis ure odveč, kadar je glavna vrednost že ura.
  $: showClockLine = lbl.value !== fmtClock(depSec);
</script>

<div class="text-right leading-none">
  {#if $departureDisplay === 'clock'}
    <span class={clockCls}>{fmtClock(depSec)}</span>
  {:else if $departureDisplay === 'both'}
    <div class="flex flex-col items-end gap-0.5">
      {#if lbl.now}
        <span class={nowCls} style="color: var(--status-ontime)">{lbl.value}</span>
      {:else}
        <span>
          <span class={numCls}>{lbl.value}</span>
          {#if lbl.unit}<span class="t-footnote text-muted ml-0.5">{lbl.unit}</span>{/if}
        </span>
      {/if}
      {#if showClockLine}
        <span class="t-footnote text-muted tabular-nums">{fmtClock(depSec)}</span>
      {/if}
    </div>
  {:else}
    {#if lbl.now}
      <span class={nowCls} style="color: var(--status-ontime)">{lbl.value}</span>
    {:else}
      <span class={numCls}>{lbl.value}</span>
      {#if lbl.unit}<span class="t-footnote text-muted ml-0.5">{lbl.unit}</span>{/if}
    {/if}
  {/if}
</div>
