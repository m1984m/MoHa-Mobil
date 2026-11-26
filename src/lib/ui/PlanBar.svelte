<script lang="ts">
  import type { Plan } from '../planner';
  import { planSegments } from '../fare';
  import { routeColor, routeTextColor } from '../gtfs';

  // Trak odsekov poti (po zgledu tilaa): širina odseka je sorazmerna s trajanjem.
  // Hoja je siva črtkana, čakanje svetlo, vožnja v barvi linije z oznako, če je dovolj
  // prostora. Samo za oko — vsebino nosi besedilo kartice, zato aria-hidden.
  export let plan: Plan;

  $: segs = planSegments(plan);
  $: total = Math.max(1, segs.reduce((a, s) => a + s.sec, 0));
  // Najmanj 4 % širine, da je kratka hoja do postajališča še vidna.
  $: widths = (() => {
    const raw = segs.map(s => Math.max(4, (s.sec / total) * 100));
    const sum = raw.reduce((a, b) => a + b, 0);
    return raw.map(w => (w / sum) * 100);
  })();
</script>

{#if segs.length}
<div class="mm-pb" aria-hidden="true">
  {#each segs as s, i}
    {#if s.kind === 'bus'}
      <span class="mm-pb-seg mm-pb-bus" style="flex-basis: {widths[i]}%; background: {routeColor(s.routeId)}; color: {routeTextColor(s.routeId)}">
        {#if widths[i] >= 14}{s.short}{/if}
      </span>
    {:else}
      <span class="mm-pb-seg mm-pb-{s.kind}" style="flex-basis: {widths[i]}%"></span>
    {/if}
  {/each}
</div>
{/if}

<style>
  /* Predpona mm-pb-: skupni CSS (glej reference_css_class_collision). */
  .mm-pb { display: flex; gap: 2px; height: 18px; align-items: center; margin-top: 8px; }
  .mm-pb-seg { min-width: 0; flex-grow: 0; flex-shrink: 1; height: 100%; border-radius: 5px; }
  .mm-pb-bus {
    display: flex; align-items: center; justify-content: center; overflow: hidden;
    font-size: 11px; font-weight: 700; line-height: 1; white-space: nowrap;
  }
  .mm-pb-walk {
    height: 4px; border-radius: 2px;
    background: repeating-linear-gradient(90deg, var(--text-muted) 0 4px, transparent 4px 7px);
  }
  .mm-pb-wait { height: 4px; border-radius: 2px; background: var(--surface-3); }
</style>
