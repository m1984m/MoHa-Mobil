<script lang="ts">
  import { departureDisplay } from '../settings';

  export let minutesFromNow: number;
  export let depSec: number;
  export let size: 'sm' | 'md' = 'md';

  function fmtClock(sec: number): string {
    const h = Math.floor(sec / 3600) % 24;
    const m = Math.floor((sec % 3600) / 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  $: numCls = size === 'sm' ? 't-subhead font-bold' : 't-title2 font-bold';
  $: nowCls = size === 'sm' ? 't-subhead font-bold' : 't-title3 font-bold';
  $: clockCls = size === 'sm' ? 't-footnote font-semibold tabular-nums' : 't-subhead font-semibold tabular-nums';
</script>

<div class="text-right leading-none">
  {#if $departureDisplay === 'clock'}
    <span class={clockCls}>{fmtClock(depSec)}</span>
  {:else if $departureDisplay === 'both'}
    <div class="flex flex-col items-end gap-0.5">
      {#if minutesFromNow <= 0}
        <span class={nowCls} style="color: var(--status-ontime)">zdaj</span>
      {:else}
        <span>
          <span class={numCls}>{minutesFromNow}</span>
          <span class="t-footnote text-muted ml-0.5">min</span>
        </span>
      {/if}
      <span class="t-footnote text-muted tabular-nums">{fmtClock(depSec)}</span>
    </div>
  {:else}
    {#if minutesFromNow <= 0}
      <span class={nowCls} style="color: var(--status-ontime)">zdaj</span>
    {:else}
      <span class={numCls}>{minutesFromNow}</span>
      <span class="t-footnote text-muted ml-0.5">min</span>
    {/if}
  {/if}
</div>
