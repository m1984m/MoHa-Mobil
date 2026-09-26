<script lang="ts">
  import { page } from '../motion';
  import { ArrowLeft, MapPin, Star } from 'lucide-svelte';
  import { type GTFS, type Stop } from '../gtfs';
  import { favStops } from '../favorites';
  import { focusTrap } from '../focusTrap';
  import { t } from '../i18n';
  import { stopHint, searchStops, normName } from '../simpleStops';

  // Preprost pogled: poišči postajališče po imenu in ga dodaj med svoja.
  //
  // Prej je bila edina pot do postajališča, ki ga ni med "Moji avtobusi", dotik
  // pike na karti — za neznano ali oddaljeno postajališče starejši uporabnik
  // tako praktično ni mogel dodati ničesar. Iskanje ne loči šumnikov
  // ("sentiljska" najde "Šentiljska"), ker jih na telefonu marsikdo ne tipka.
  export let gtfs: GTFS | null;
  export let open = false;
  export let onClose: () => void;
  export let onPick: (s: Stop) => void;

  let query = '';
  let inputEl: HTMLInputElement | null = null;
  $: if (!open) query = '';
  // Tipkovnica naj se odpre takoj. `autofocus` ne zadošča: focusTrap fokus
  // prestavi na prvi gumb (Nazaj), če v oknu še ni ničesar fokusiranega.
  $: if (open && inputEl) inputEl.focus();

  $: results = searchStops(gtfs, query);
</script>

<svelte:window on:keydown={(e) => { if (open && e.key === 'Escape') onClose(); }} />

{#if open}
  <div in:page out:page={{ out: true }} class="fixed inset-0 z-[60] flex flex-col surface"
       style="padding-top: env(safe-area-inset-top);"
       role="dialog" aria-modal="true" aria-label={$t('Dodaj postajališče')} tabindex="-1" use:focusTrap>
    <div class="px-4 pt-3 pb-2 max-w-screen-sm mx-auto w-full space-y-3">
      <button type="button" class="pressable mm-sq-back" on:click={onClose}>
        <ArrowLeft size={26} strokeWidth={2.25} /> {$t('Nazaj')}
      </button>
      <h1 class="t-title1">{$t('Dodaj postajališče')}</h1>
      <input bind:value={query} bind:this={inputEl}
             on:keydown={(e) => { if (e.key === 'Enter') inputEl?.blur(); }}
             class="mm-sq-input w-full"
             placeholder={$t('Ime postajališča')}
             aria-label={$t('Ime postajališča')}
             autocomplete="off" enterkeyhint="search" />
    </div>

    <div class="flex-1 overflow-y-auto scrollbox">
      <div class="px-4 max-w-screen-sm mx-auto space-y-3"
           style="padding-bottom: calc(env(safe-area-inset-bottom) + 2rem);">
        {#if normName(query).length < 2}
          <p class="t-body text-muted pt-2">{$t('Vpiši vsaj dve črki imena. Dotik na postajališče ga shrani med tvoja.')}</p>
        {:else if results.length === 0}
          <p class="t-body text-muted pt-2">{$t('Ni zadetkov.')}</p>
        {:else}
          <p class="sr-only" aria-live="polite">{$t('Zadetkov: {n}', { n: results.length })}</p>
          <ul class="space-y-3" aria-label={$t('Zadetki')}>
            {#each results as s (s.id)}
              {@const saved = $favStops.has(s.id)}
              {@const hint = gtfs ? stopHint(gtfs, s.id) : ''}
              <li>
                <button type="button" class="pressable mm-sq-row w-full" on:click={() => onPick(s)}>
                  {#if saved}
                    <Star size={28} strokeWidth={2} fill="var(--status-delay)" color="var(--status-delay)" />
                  {:else}
                    <MapPin size={28} strokeWidth={2} color="var(--accent)" />
                  {/if}
                  <span class="flex-1 min-w-0 text-left">
                    <span class="block t-headline">{s.name}</span>
                    {#if hint}<span class="block t-footnote text-muted">{hint}</span>{/if}
                    {#if saved}<span class="block t-footnote" style="color: var(--status-delay)">{$t('Shranjeno med moje')}</span>{/if}
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  /* Kot SimpleStopScreen: tarče ≥ 64 px, vrstice 88 px. Predpona mm-sq-: skupni CSS. */
  .mm-sq-back {
    display: inline-flex; align-items: center; gap: 10px;
    min-height: 64px; padding: 0 20px 0 14px; border-radius: 18px;
    background: var(--surface-2); border: 2px solid var(--border); color: var(--text);
    font-weight: 600; font-size: calc(16px * var(--ui-scale)); touch-action: manipulation;
  }
  .mm-sq-input {
    min-height: 64px; padding: 0 18px; border-radius: 18px;
    background: var(--surface-2); border: 2px solid var(--border); color: var(--text);
    font-size: calc(18px * var(--ui-scale));
  }
  .mm-sq-input:focus { outline: none; border-color: var(--accent); }
  .mm-sq-row {
    display: flex; align-items: center; gap: 16px;
    min-height: 88px; padding: 14px 18px; border-radius: 20px;
    background: var(--surface); border: 2px solid var(--border); color: var(--text);
    touch-action: manipulation;
  }
</style>
