<script lang="ts">
  import { Sparkles, X } from 'lucide-svelte';
  import { fly } from 'svelte/transition';
  import { updateAvailable } from '../update';
  import { APP_VERSION, RELEASE_NOTES } from '../release';

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
  <div class="fixed left-3 right-3 bottom-[84px] z-50 surface rounded-2xl border border-base shadow-elev p-4"
       transition:fly={{ y: 20, duration: 260 }}>
    <div class="flex items-start gap-3">
      <div class="shrink-0 w-9 h-9 rounded-full grid place-items-center bg-accent">
        <Sparkles size={18} color="#ffffff" />
      </div>
      <div class="flex-1 min-w-0">
        <div class="t-headline">Nova različica {APP_VERSION}</div>
        <div class="t-footnote text-muted">Kaj je novega:</div>
        <ul class="t-footnote list-disc pl-5 mt-1 space-y-0.5">
          {#each RELEASE_NOTES as n}
            <li>{n}</li>
          {/each}
        </ul>
        <div class="mt-3 flex gap-2">
          <button class="pressable flex-1 rounded-xl h-10 bg-accent t-subhead font-semibold"
                  on:click={refresh}>Osveži zdaj</button>
          <button class="pressable rounded-xl h-10 px-4 surface-2 t-subhead"
                  on:click={dismiss}>Kasneje</button>
        </div>
      </div>
      <button class="pressable w-8 h-8 grid place-items-center -mr-1 -mt-1"
              on:click={dismiss} aria-label="Zapri">
        <X size={18} color="var(--text-muted)" />
      </button>
    </div>
  </div>
{/if}
