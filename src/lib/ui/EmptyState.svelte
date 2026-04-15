<script lang="ts">
  import type { ComponentType } from 'svelte';
  export let icon: ComponentType | null = null;
  export let title: string;
  export let body: string = '';
</script>

<div class="flex flex-col items-center justify-center text-center py-12 px-6">
  {#if icon}
    <div class="w-16 h-16 rounded-2xl surface-2 grid place-items-center mb-4" style="color: var(--text-muted)">
      <svelte:component this={icon} size={32} strokeWidth={1.5} />
    </div>
  {/if}
  <div class="t-title3 font-semibold mb-1">{title}</div>
  {#if body}<div class="t-subhead text-muted max-w-xs">{body}</div>{/if}
  <div class="mt-4"><slot /></div>
</div>
