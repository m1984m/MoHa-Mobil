<script lang="ts">
  export let minutes: number | null;
  export let size: 'md' | 'lg' = 'lg';
  $: text = minutes == null ? '–' : minutes <= 0 ? 'zdaj' : `${minutes}`;
  $: unit = minutes == null ? '' : minutes <= 0 ? '' : 'min';
  const cls = size === 'lg' ? 't-largeTitle' : 't-title2';
</script>

<div class="text-right leading-none">
  <span class="{cls} font-bold" style="color: var(--text)">{text}</span>
  {#if unit}<span class="t-footnote text-muted ml-1">{unit}</span>{/if}
</div>
