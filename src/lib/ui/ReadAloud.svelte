<script lang="ts">
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { Volume2, Square } from 'lucide-svelte';
  import { canSpeak, speakingOwner, speak, stopSpeaking } from '../speech';
  import { t } from '../i18n';

  // Gumb "Preberi na glas", isti na vseh oknih.
  //
  // Besedilo se sestavi šele ob dotiku, ker se odhodi medtem osvežujejo. Med
  // branjem je "Ustavi branje" samo ta gumb, ne vsi v aplikaciji. Ko se okno zapre
  // (gumb izgine) ali se vsebina zamenja (`resetKey`, npr. druga postaja v istem
  // listu), se njegovo branje ustavi — sicer bi bral o postaji, ki je ni več.
  export let text: () => string;
  // 'icon': okrogel 44 px kot ostale akcije v glavi okna; 'big': 64 px z napisom
  // za preprost pogled.
  export let variant: 'icon' | 'big' = 'icon';
  export let resetKey: unknown = null;
  // Samo 'big': čez celo širino, kot sosednji gumbi.
  export let wide = false;
  // Kaj bere, za bralnik zaslona, kadar je na zaslonu več gumbov (Dom ima dva).
  export let label = '';
  // Samo 'big': napis namesto "Preberi na glas" (npr. "Poslušaj Petro").
  export let caption = '';

  const me = {};
  $: mine = $speakingOwner === me;

  function toggle() {
    if (mine) { stopSpeaking(); return; }
    const s = text().trim();
    if (s) speak(s, me);
  }

  let prevKey = resetKey;
  $: if (resetKey !== prevKey) {
    prevKey = resetKey;
    if (get(speakingOwner) === me) stopSpeaking();
  }

  onDestroy(() => { if (get(speakingOwner) === me) stopSpeaking(); });
</script>

{#if $canSpeak}
  {#if variant === 'big'}
    <button type="button" class="pressable mm-ra-big" class:mm-ra-wide={wide} on:click={toggle}>
      {#if mine}<Square size={22} strokeWidth={2.25} /> {$t('Ustavi branje')}
      {:else}<Volume2 size={24} strokeWidth={2} /> {caption || $t('Preberi na glas')}{/if}
    </button>
  {:else}
    <button type="button" class="pressable w-11 h-11 rounded-full grid place-items-center shrink-0 mm-ra-icon"
            class:mm-ra-on={mine}
            on:click={toggle}
            aria-label={(mine ? $t('Ustavi branje') : $t('Preberi na glas')) + (label ? ': ' + label : '')}>
      {#if mine}<Square size={16} strokeWidth={2.25} />{:else}<Volume2 size={18} />{/if}
    </button>
  {/if}
{/if}

<style>
  /* Predpona mm-ra-: skupni CSS (glej reference_css_class_collision). */
  .mm-ra-icon { background: var(--surface-2); color: var(--text); touch-action: manipulation; }
  .mm-ra-on { background: var(--accent); color: #ffffff; }
  /* Kot sekundarni gumbi preprostega pogleda: ≥ 64 px, vedno z napisom. */
  .mm-ra-big {
    display: inline-flex; align-items: center; justify-content: center; gap: 10px;
    min-height: 64px; padding: 0 20px; border-radius: 18px;
    background: var(--surface-2); border: 2px solid var(--border); color: var(--accent);
    font-weight: 600; font-size: calc(16px * var(--ui-scale)); touch-action: manipulation;
  }
  .mm-ra-wide { width: 100%; }
  /* Ikona se ne krči, ko se napis prelomi v dve vrstici. */
  .mm-ra-big :global(svg) { flex-shrink: 0; }
</style>
