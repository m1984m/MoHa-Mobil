<script context="module" lang="ts">
  import type { Plan } from '../planner';
  // 'geo': brez lokacije ne vemo, od kod — pot od središča mesta bi bila napačna.
  export type SimpleRouteState = {
    status: 'loading' | 'ok' | 'none' | 'geo';
    title: string;
    // Lokacija je bila zavrnjena — brskalnik ne vpraša znova, zato povemo, kje se vklopi.
    denied?: boolean;
    toName: string;
    plan?: Plan;
  };
</script>

<script lang="ts">
  import { page } from '../motion';
  import { ArrowLeft, Map as MapIcon, RotateCw, Search, MapPin } from 'lucide-svelte';
  import { focusTrap } from '../focusTrap';
  import { t } from '../i18n';
  import PlanSteps from '../ui/PlanSteps.svelte';

  // Pot po korakih čez cel zaslon, brez karte in brez lista, ki bi ga bilo treba
  // vleči. Karta je na gumb.
  export let state: SimpleRouteState | null;
  export let onClose: () => void;
  // Skrit, a odprt (karta je čez njega) — brez animacije zapiranja in odpiranja.
  export let hidden = false;
  export let onShowMap: () => void;
  export let onRetry: () => void;
  export let onOpenPlanner: () => void;
  export let onRequestLocation: () => void;
</script>

{#if state}
  <div in:page out:page={{ out: true }} class="fixed inset-0 z-[65] flex flex-col surface" style:display={hidden ? 'none' : null}
       style="padding-top: env(safe-area-inset-top);"
       role="dialog" aria-modal="true" aria-label={state.title} tabindex="-1" use:focusTrap>
    <div class="px-4 pt-3 pb-2 max-w-screen-sm mx-auto w-full">
      <button type="button" class="pressable mm-sr-btn" style="padding-left: 14px" on:click={onClose}>
        <ArrowLeft size={26} strokeWidth={2.25} /> {$t('Nazaj')}
      </button>
    </div>

    <div class="flex-1 overflow-y-auto scrollbox">
      <div class="px-4 max-w-screen-sm mx-auto space-y-4"
           style="padding-bottom: calc(env(safe-area-inset-bottom) + 2rem);">
        <div>
          <h1 class="t-title1">{state.title}</h1>
          {#if state.toName && state.toName !== state.title}
            <div class="t-callout text-muted mt-1">{state.toName}</div>
          {/if}
        </div>

        <!-- Menjava stanja (iščem → pot / ni poti) se prebere bralniku zaslona. -->
        <div class="space-y-4" aria-live="polite">
        {#if state.status === 'loading'}
          <div class="surface-2 rounded-2xl p-5 flex items-center gap-3 t-body">
            <span class="w-3 h-3 rounded-full animate-pulse" style="background: var(--accent)"></span>
            {$t('Iščem pot…')}
          </div>
        {:else if state.status === 'geo'}
          <div class="surface-2 rounded-2xl p-5 space-y-4">
            <p class="t-body">{$t('Za pot potrebujem tvojo lokacijo — sicer ne vem, od kod greš.')}</p>
            {#if state.denied}
              <p class="t-callout" style="color: var(--status-delay)">{$t('Lokacija je zavrnjena. Vklopi jo v nastavitvah telefona ali brskalnika za to stran in poskusi znova.')}</p>
            {/if}
            <button type="button" class="pressable mm-sr-btn mm-sr-accent w-full" on:click={onRequestLocation}>
              <MapPin size={26} /> {$t('Dovoli lokacijo')}
            </button>
          </div>
        {:else if state.status === 'none'}
          <div class="surface-2 rounded-2xl p-5 space-y-2">
            <p class="t-headline">{$t('Zdaj ni poti z avtobusom.')}</p>
            <p class="t-callout text-muted">{$t('Morda danes noben avtobus ne vozi več ali pa je cilj predaleč od postajališč.')}</p>
          </div>
          <button type="button" class="pressable mm-sr-btn w-full" on:click={onRetry}>
            <RotateCw size={24} /> {$t('Poskusi znova')}
          </button>
          <button type="button" class="pressable mm-sr-btn w-full" on:click={onOpenPlanner}>
            <Search size={24} /> {$t('Odpri načrtovalnik poti')}
          </button>
        {:else if state.plan}
          <div class="surface rounded-2xl border border-base shadow-card px-3 py-4">
            <PlanSteps legs={state.plan.legs} ciljIme={state.toName} />
          </div>
          <button type="button" class="pressable mm-sr-btn w-full" on:click={onShowMap}>
            <MapIcon size={26} strokeWidth={2} color="var(--accent)" /> {$t('Pokaži na karti')}
          </button>
          <button type="button" class="pressable mm-sr-btn w-full" on:click={onRetry}>
            <RotateCw size={24} /> {$t('Poišči znova')}
          </button>
        {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .mm-sr-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 10px;
    min-height: 64px; padding: 0 20px; border-radius: 18px;
    background: var(--surface-2); border: 2px solid var(--border); color: var(--text);
    font-weight: 600; font-size: calc(16px * var(--ui-scale)); touch-action: manipulation;
  }
  .mm-sr-accent { background: var(--accent); border-color: var(--accent); color: #ffffff; }
</style>
