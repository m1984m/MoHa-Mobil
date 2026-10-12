<script lang="ts">
  import { Sparkles, X } from 'lucide-svelte';
  import { fly } from 'svelte/transition';
  import { updateAvailable } from '../update';
  import { t } from '../i18n';

  // Različica, ki čaka (vpraša se čakajoči SW). Prej je obvestilo kazalo različico in
  // novosti paketa, ki že teče — torej stare (pregled 12.10.2026). Novosti nove različice
  // so po osvežitvi v Nastavitvah → O aplikaciji.
  let nextVersion = '';
  let askedFor: ServiceWorker | null = null;
  $: if ($updateAvailable && $updateAvailable !== askedFor) {
    askedFor = $updateAvailable;
    nextVersion = '';
    try {
      const ch = new MessageChannel();
      ch.port1.onmessage = (ev) => { nextVersion = String(ev.data ?? '').split('-')[0]; };
      $updateAvailable.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
    } catch { /* stari SW brez GET_VERSION — naslov brez številke */ }
  }

  function refresh() {
    const w = $updateAvailable;
    if (!w) return;
    // Novi SW aktivira skipWaiting → controllerchange v main.ts naredi reload.
    w.postMessage({ type: 'SKIP_WAITING' });
  }

  function dismiss() {
    updateAvailable.set(null);
  }
</script>

{#if $updateAvailable}
  <!-- safe-area-inset-bottom: na iPhonih z notch-em je TabBar višji za home indicator,
       fiksnih 84px je toast polagalo čezenj. -->
  <div class="fixed left-3 right-3 z-50 surface rounded-2xl border border-base shadow-elev p-4"
       style="bottom: calc(var(--tabbar-space) + 1rem)"
       transition:fly={{ y: 20, duration: 260 }}>
    <div class="flex items-start gap-3">
      <div class="shrink-0 w-9 h-9 rounded-full grid place-items-center bg-accent">
        <Sparkles size={18} color="#ffffff" />
      </div>
      <div class="flex-1 min-w-0">
        <div class="t-headline">{nextVersion ? $t('Nova različica {version}', { version: nextVersion }) : $t('Na voljo je nova različica')}</div>
        <div class="t-footnote text-muted">{$t('Novosti po osvežitvi najdeš v Nastavitvah pod O aplikaciji.')}</div>
        <div class="mt-3 flex gap-2">
          <button class="pressable flex-1 rounded-xl h-10 bg-accent t-subhead font-semibold"
                  on:click={refresh}>{$t('Osveži zdaj')}</button>
          <button class="pressable rounded-xl h-10 px-4 surface-2 t-subhead"
                  on:click={dismiss}>{$t('Kasneje')}</button>
        </div>
      </div>
      <button class="pressable w-8 h-8 grid place-items-center -mr-1 -mt-1"
              on:click={dismiss} aria-label={$t('Zapri')}>
        <X size={18} color="var(--text-muted)" />
      </button>
    </div>
  </div>
{/if}
