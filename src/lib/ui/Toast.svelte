<script lang="ts">
  import { fly } from 'svelte/transition';
  import { toast } from '../toast';

  function undo() {
    const t = $toast;
    if (!t?.undo) return;
    t.undo();
    toast.dismiss();
  }
</script>

{#if $toast}
  <!-- Nad TabBar-om; pointer-events samo na gumbu Razveljavi, da toast ne prestreza tapov po karti. -->
  {#key $toast.id}
    <div class="fixed left-1/2 -translate-x-1/2 z-[60] px-4 max-w-[calc(100vw-1.5rem)] pointer-events-none"
         style="bottom: calc(env(safe-area-inset-bottom) + 6.5rem)"
         transition:fly={{ y: 16, duration: 200 }}>
      <div class="surface rounded-full border border-base shadow-elev pl-4 {$toast.undo ? 'pr-1.5' : 'pr-4'} h-11 flex items-center gap-3">
        <span class="t-footnote font-medium truncate">{$toast.msg}</span>
        {#if $toast.undo}
          <button type="button"
                  class="pressable pointer-events-auto shrink-0 h-8 px-3 rounded-full t-footnote font-semibold"
                  style="background: var(--accent); color: #ffffff; touch-action: manipulation;"
                  on:click={undo}>Razveljavi</button>
        {/if}
      </div>
    </div>
  {/key}
{/if}
