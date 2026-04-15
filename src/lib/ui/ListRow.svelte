<script lang="ts">
  export let href: string | null = null;
  export let onclick: (() => void) | null = null;
  export let first = false;
  export let last = false;
  export let chevron = true;
  const roundTop = first ? 'rounded-t-2xl' : '';
  const roundBot = last ? 'rounded-b-2xl' : '';
  const border = last ? '' : 'border-b border-base';
</script>

{#if onclick || href}
  <button class="pressable w-full min-h-[56px] px-4 flex items-center gap-3 text-left surface {roundTop} {roundBot} {border} active:surface-2"
    on:click={() => { if (onclick) onclick(); }}>
    <div class="flex-1 min-w-0"><slot /></div>
    {#if chevron}<slot name="end"><span class="text-muted">›</span></slot>{:else}<slot name="end" />{/if}
  </button>
{:else}
  <div class="min-h-[56px] px-4 flex items-center gap-3 surface {roundTop} {roundBot} {border}">
    <div class="flex-1 min-w-0"><slot /></div>
    <slot name="end" />
  </div>
{/if}
