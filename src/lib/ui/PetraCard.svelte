<script lang="ts">
  import { onDestroy } from 'svelte';
  import { focusTrap } from '../focusTrap';
  import { pushBack, type BackRelease } from '../backstack';
  import { t } from '../i18n';
  import { markIntro } from '../onboarding';
  import PetraIntro from './PetraIntro.svelte';

  // Novost po posodobitvi: obstoječi uporabnik enkrat vidi kartico s Petro.
  // Novi jo dobijo v vodiču (WelcomeModal), ki jo ob koncu označi kot videno.
  let done = false;
  function close() {
    if (done) return;
    done = true;
    markIntro('petra');
  }
  // Sistemski nazaj kartico zapre (ne aplikacije).
  const back: BackRelease = pushBack(close);
  onDestroy(() => back());
</script>

<svelte:window on:keydown={(e) => { if (e.key === 'Escape') close(); }} />

<div class="fixed inset-0 z-[90] flex flex-col surface"
     style="padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom);"
     role="dialog" aria-modal="true" aria-label={$t('Spoznaj Petro')} tabindex="-1"
     use:focusTrap>
  <div class="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center gap-3 px-6">
    <div class="t-footnote font-semibold uppercase tracking-wide" style="color: var(--accent)">{$t('Novo')}</div>
    <PetraIntro />
  </div>
  <div class="px-5 pb-5 pt-2">
    <button type="button"
            class="pressable w-full max-w-sm mx-auto block min-h-[52px] rounded-2xl t-headline font-semibold"
            style="background: var(--accent); color: #ffffff;"
            on:click={close}>{$t('V redu')}</button>
  </div>
</div>
