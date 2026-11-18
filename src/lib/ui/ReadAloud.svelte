<script lang="ts">
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { Volume2, Square } from 'lucide-svelte';
  import { canSpeak, speakingOwner, speak, stopSpeaking } from '../speech';
  import { t, lang } from '../i18n';

  // Gumb "Preberi na glas", isti na vseh oknih.
  //
  // V navadnem pogledu je obarvana kapsula z imenom (»Petra«), kot obarvani gumbi v
  // iOS: sama ikona zvočnika ni povedala, da bere Petra, in je bila ob drugih sivih
  // gumbih v glavi skoraj nevidna. V angleščini bere glas telefona, zato tam piše
  // »Listen«. Med branjem je kapsula polna in piše »Ustavi«.
  //
  // Besedilo se sestavi šele ob dotiku, ker se odhodi medtem osvežujejo. Med
  // branjem je "Ustavi branje" samo ta gumb, ne vsi v aplikaciji. Ko se okno zapre
  // (gumb izgine) ali se vsebina zamenja (`resetKey`, npr. druga postaja v istem
  // listu), se njegovo branje ustavi — sicer bi bral o postaji, ki je ni več.
  export let text: () => string;
  // 'icon': kapsula 44 px v glavi okna (ime je zgodovinsko; do 0.30.6 je bila samo
  // okrogla ikona); 'big': 64 px z napisom za preprost pogled.
  export let variant: 'icon' | 'big' = 'icon';
  export let resetKey: unknown = null;
  // Samo 'big': čez celo širino, kot sosednji gumbi.
  export let wide = false;
  // Kaj bere, za bralnik zaslona, kadar je na zaslonu več gumbov (Dom ima dva).
  export let label = '';
  // Samo 'big': napis namesto "Preberi na glas" (npr. "Poslušaj Petro").
  export let caption = '';
  // Samo 'icon': vrstica z več gumbi (list avtobusa, glava Priljubljenih). Pod 400 px
  // ostane obarvan krog brez napisa, sicer kapsula izrine naslov ali prelomi vrstico.
  export let tesno = false;

  const me = {};
  $: mine = $speakingOwner === me;
  // Vidni napis kapsule. Ime bralnika zaslona se začne z njim (WCAG: vidni napis je del imena).
  $: napis = mine ? $t('Ustavi') : $lang === 'en' ? $t('Poslušaj') : 'Petra';

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
    <button type="button" class="pressable shrink-0 mm-ra-pill"
            class:mm-ra-on={mine} class:mm-ra-tesno={tesno}
            on:click={toggle}
            aria-label={(mine ? $t('Ustavi branje') : `${napis}. ${$t('Preberi na glas')}`) + (label ? ': ' + label : '')}>
      {#if mine}<Square size={15} strokeWidth={2.5} />{:else}<Volume2 size={18} strokeWidth={2.25} />{/if}
      <span>{napis}</span>
    </button>
  {/if}
{/if}

<style>
  /* Predpona mm-ra-: skupni CSS (glej reference_css_class_collision). */
  /* Obarvana kapsula (iOS »tinted«): višina 44 px kot okrogli gumbi ob njej, napis
     se ne lomi in ne krči, velikost sledi nastavitvi velikosti besedila. */
  .mm-ra-pill {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    height: 44px; padding: 0 14px; border-radius: 9999px; white-space: nowrap;
    /* --accent-on-tint na 10 % obarvani podlagi: najmanj 4,5:1 v vseh temah (svetla
       4,53–5,04, temna 4,94–7,74); --accent sam je na tej podlagi dosegel le 3,5–4,5. */
    background: color-mix(in oklab, var(--accent) 10%, transparent); color: var(--accent-on-tint);
    font-weight: 600; font-size: calc(15px * var(--ui-scale)); line-height: 1;
    touch-action: manipulation;
  }
  .mm-ra-pill :global(svg) { flex-shrink: 0; }
  /* Najožji telefoni (320 px): v listu postajališča bi se gumb »Zapri« prelomil v
     novo vrstico, zato tam ostane samo obarvan krog z zvočnikom. */
  @media (max-width: 339px) {
    .mm-ra-pill { width: 44px; padding: 0; }
    .mm-ra-pill span { display: none; }
  }
  @media (max-width: 399px) {
    .mm-ra-tesno { width: 44px; padding: 0; }
    .mm-ra-tesno span { display: none; }
  }
  /* --hero-from: v temni temi temnejša rdeča, na kateri ima bel napis 5,25:1 (na --accent 3,55:1). */
  .mm-ra-on { background: var(--hero-from); color: #ffffff; }
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
