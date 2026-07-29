<script lang="ts">
  export let label: string = 'V živo';
  // Utripajoča zelena pika ob besedilu "Po voznem redu" je sporočala nasprotje
  // tega, kar piše. Ko podatki niso živi, je pika statična in nevtralna.
  export let live: boolean = true;

  $: color = live ? 'var(--status-ontime)' : 'var(--text-muted)';
</script>

<div class="inline-flex items-center gap-1.5">
  <span class="relative inline-flex h-2 w-2">
    {#if live}
      <span class="absolute inset-0 rounded-full live-pulse" style="background: {color}"></span>
    {/if}
    <span class="relative inline-flex h-2 w-2 rounded-full" style="background: {color}"></span>
  </span>
  <span class="t-footnote font-medium" style="color: {color}">{label}</span>
</div>
