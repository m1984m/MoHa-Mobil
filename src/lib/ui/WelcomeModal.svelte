<script lang="ts">
  import { Clock, Bus, Route, MapPin } from 'lucide-svelte';
  import { focusTrap } from '../focusTrap';
  import { lang, t, type Lang } from '../i18n';
  import { simpleView } from '../simple';
  import { onboardingDone } from '../onboarding';

  // Pozdrav ob prvem zagonu: tri kartice za tri naloge, zaradi katerih potnik
  // aplikacijo odpre (kdaj pride moj bus → kje je zdaj → kako do cilja).
  // Drsenje je domači scroll-snap — brez knjižnice in z enakim občutkom kot drugod v sistemu.
  export let hasGeo = false;
  export let onRequestLocation: () => Promise<void> | void;

  let trackEl: HTMLDivElement;
  let index = 0;
  const COUNT = 3;
  let locating = false;
  let denied = false;

  function onScroll() {
    if (!trackEl) return;
    index = Math.round(trackEl.scrollLeft / trackEl.clientWidth);
  }

  function goTo(i: number) {
    trackEl?.scrollTo({ left: i * trackEl.clientWidth, behavior: 'smooth' });
  }

  function finish() {
    onboardingDone.set(true);
  }

  async function locate() {
    locating = true;
    try { await onRequestLocation(); } finally { locating = false; }
    // Po zavrnitvi brskalnik ne vpraša znova in klic tiho pade — povej, kje se vklopi.
    denied = !hasGeo;
  }

  function setLang(l: Lang) { lang.set(l); }
</script>

<svelte:window on:keydown={(e) => {
  if (e.key === 'Escape') finish();
  else if (e.key === 'ArrowRight') goTo(Math.min(COUNT - 1, index + 1));
  else if (e.key === 'ArrowLeft') goTo(Math.max(0, index - 1));
}} />

<div class="fixed inset-0 z-[90] flex flex-col surface"
     style="padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom);"
     role="dialog" aria-modal="true" aria-label={$t('Dobrodošli v MoHa Mobil')} tabindex="-1"
     use:focusTrap>

  <div class="flex justify-end px-4 pt-3">
    {#if index < COUNT - 1}
      <button type="button" class="pressable min-h-[44px] px-3 rounded-xl t-callout text-muted"
              on:click={() => finish()}>{$t('Preskoči')}</button>
    {:else}
      <div class="min-h-[44px]"></div>
    {/if}
  </div>

  <div class="mm-wl-track flex-1 min-h-0" bind:this={trackEl} on:scroll={onScroll}>

    <!-- 1: odhodi v živo + jezik in velikost besedila (to mora biti izbrano,
         preden uporabnik prebere karkoli drugega) -->
    <section class="mm-wl-slide" aria-label="1 / 3" inert={index !== 0} aria-hidden={index !== 0}>
      <div class="mm-wl-icon"><Clock size={40} strokeWidth={1.75} /></div>
      <h1 class="t-title1 font-bold text-center">{$t('Kdaj pride moj avtobus?')}</h1>
      <p class="t-body text-muted text-center max-w-sm">
        {$t('Na začetnem zaslonu vidiš odhode s postajališč v tvoji bližini — v živo, z zamudami.')}
      </p>

      <div class="w-full max-w-sm mt-4 space-y-3">
        <div class="mm-wl-seg" role="radiogroup" aria-label="Jezik / Language">
          <button type="button" role="radio" aria-checked={$lang === 'sl'}
                  class:mm-wl-on={$lang === 'sl'} on:click={() => setLang('sl')}>Slovenščina</button>
          <button type="button" role="radio" aria-checked={$lang === 'en'}
                  class:mm-wl-on={$lang === 'en'} on:click={() => setLang('en')}>English</button>
        </div>
        <label class="flex items-center justify-between gap-3 surface-2 rounded-2xl px-4 min-h-[52px]">
          <span class="t-callout">{$t('Preprost pogled z velikim tiskom')}</span>
          <input type="checkbox" class="mm-wl-switch" bind:checked={$simpleView} />
        </label>
      </div>
    </section>

    <!-- 2: karta -->
    <section class="mm-wl-slide" aria-label="2 / 3" inert={index !== 1} aria-hidden={index !== 1}>
      <div class="mm-wl-icon"><Bus size={40} strokeWidth={1.75} /></div>
      <h1 class="t-title1 font-bold text-center">{$t('Kje je avtobus zdaj?')}</h1>
      <p class="t-body text-muted text-center max-w-sm">
        {$t('Na Karti vidiš vse avtobuse v živo. Tapni postajališče za odhode ali avtobus za njegovo pot.')}
      </p>
    </section>

    <!-- 3: planer + lokacija -->
    <section class="mm-wl-slide" aria-label="3 / 3" inert={index !== 2} aria-hidden={index !== 2}>
      <div class="mm-wl-icon"><Route size={40} strokeWidth={1.75} /></div>
      <h1 class="t-title1 font-bold text-center">{$t('Kako pridem do cilja?')}</h1>
      <p class="t-body text-muted text-center max-w-sm">
        {$t('Vpiši cilj in aplikacija poišče pot s prestopi in hojo. Pogoste poti in postajališča shrani med Priljubljene.')}
      </p>
      {#if !hasGeo}
        <button type="button"
                class="pressable mt-4 min-h-[48px] px-5 rounded-xl surface-2 border border-base t-callout font-semibold flex items-center gap-2 disabled:opacity-60"
                disabled={locating} on:click={locate}>
          <MapPin size={18} />
          {locating ? $t('Čakam na dovoljenje…') : $t('Omogoči lokacijo')}
        </button>
        {#if denied}
          <p class="t-footnote text-center max-w-xs mt-2" style="color: var(--status-delay)">
            {$t('Lokacija ni dovoljena. Vklopiš jo v nastavitvah brskalnika ali telefona za to stran.')}
          </p>
        {:else}
          <p class="t-footnote text-muted text-center max-w-xs mt-2">
            {$t('Lokacija ostane na tvojem telefonu — uporabimo jo le za bližnja postajališča.')}
          </p>
        {/if}
      {:else}
        <p class="t-footnote text-center mt-4 flex items-center gap-1.5" style="color: var(--status-ontime)">
          <MapPin size={16} /> {$t('Lokacija je omogočena.')}
        </p>
      {/if}
    </section>
  </div>

  <div class="px-5 pb-5 pt-2 space-y-4">
    <div class="flex justify-center gap-2" aria-hidden="true">
      {#each Array(COUNT) as _, i}
        <span class="mm-wl-dot" class:mm-wl-dot-on={i === index}></span>
      {/each}
    </div>
    <button type="button"
            class="pressable w-full max-w-sm mx-auto block min-h-[52px] rounded-2xl t-headline font-semibold"
            style="background: var(--accent); color: #ffffff;"
            on:click={() => index < COUNT - 1 ? goTo(index + 1) : finish()}>
      {index < COUNT - 1 ? $t('Naprej') : $t('Začni')}
    </button>
  </div>
</div>

<style>
  .mm-wl-track {
    display: flex;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
    overscroll-behavior-x: contain;
  }
  .mm-wl-track::-webkit-scrollbar { display: none; }
  .mm-wl-slide {
    flex: 0 0 100%;
    scroll-snap-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 0 24px;
    overflow-y: auto;
  }
  .mm-wl-icon {
    width: 88px;
    height: 88px;
    border-radius: 26px;
    display: grid;
    place-items: center;
    margin-bottom: 8px;
    color: var(--accent);
    background: color-mix(in oklab, var(--accent) 12%, transparent);
  }
  .mm-wl-seg {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    padding: 4px;
    border-radius: 16px;
    background: var(--surface-2);
  }
  .mm-wl-seg button {
    min-height: 44px;
    border-radius: 12px;
    border: 0;
    background: none;
    color: var(--text);
    font-weight: 500;
    touch-action: manipulation;
  }
  .mm-wl-seg button.mm-wl-on {
    background: var(--surface);
    box-shadow: var(--shadow-1);
    font-weight: 600;
  }
  .mm-wl-switch {
    width: 24px;
    height: 24px;
    accent-color: var(--accent);
  }
  .mm-wl-dot {
    width: 8px;
    height: 8px;
    border-radius: 4px;
    background: var(--border-strong);
    transition: width var(--dur-fast) var(--ease-ios), background var(--dur-fast);
  }
  .mm-wl-dot-on { width: 22px; background: var(--accent); }
</style>
