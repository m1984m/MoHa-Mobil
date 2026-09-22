<script lang="ts">
  import { Lightbulb, X } from 'lucide-svelte';
  import { slide } from 'svelte/transition';
  import { t } from '../i18n';
  import { dismissHint, hintVisible, type HintId } from '../onboarding';

  // Kratek namig v toku vsebine (ne lebdeč oblaček nad elementom): ne prekrije
  // ničesar, ne rabi merjenja položaja in deluje enako v načinu za starejše.
  // Pokaže se enkrat; zapre ga dotik na ×.
  export let id: HintId;
  export let text: string;
</script>

{#if $hintVisible(id)}
  <div class="mm-hint flex items-start gap-3 rounded-2xl px-4 py-3" role="note" transition:slide={{ duration: 180 }}>
    <Lightbulb size={20} class="shrink-0 mt-0.5" color="var(--accent)" />
    <div class="t-footnote flex-1 min-w-0" style="color: var(--text-secondary)">{text}</div>
    <button type="button" class="pressable mm-hint-x shrink-0 -my-2 -mr-2 grid place-items-center rounded-full"
            aria-label={$t('Zapri namig')} on:click={() => dismissHint(id)}>
      <X size={18} color="var(--text-muted)" />
    </button>
  </div>
{/if}

<style>
  .mm-hint { background: color-mix(in oklab, var(--accent) 9%, var(--surface)); }
  .mm-hint-x { width: 44px; height: 44px; background: none; border: 0; touch-action: manipulation; }
</style>
