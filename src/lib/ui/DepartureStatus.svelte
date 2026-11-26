<script lang="ts">
  import { t } from '../i18n';
  import { fmtClock } from '../time';
  import { largeUI } from '../simple';

  // Enotna oznaka stanja odhoda za vse sezname odhodov (Dom, Priljubljene, list
  // postajališča, list avtobusa, Preprost pogled). Prej so bile tri različne —
  // »točno« ali nič na Domu, »v živo« / »po redu« v 10 px na listu, »ocena« / »GPS«
  // pri avtobusu — in »po redu« se je bralo kot »v redu« (evalvacija 04.10.2026).
  //
  // Pisava je t-footnote, zato raste z --ui-scale (Večje besedilo).
  // Kontrast: barva napisa je statusna barva, potemnjena (svetla tema) oziroma
  // posvetljena (temna) proti --text za petino; čip ima neprosojno ozadje iz
  // --surface. Prosojni odtenek je na sivih podlagah (list avtobusa) padel na
  // 3,1–4,3 : 1 (pregled kode 05.10.2026).
  //
  // 0.31: čas iz živega vira ima znak signala (kot Slomet), da se v seznamu z mešanimi
  // vrsticami vidi, kateri čas je v živo; ob zamudi je pred čipom prečrtan čas po
  // voznem redu (kot tilaa).
  export let live = false;
  export let delayKnown = false;
  export let delayMin: number | null | undefined = null;
  /** Čas po voznem redu (sekunde od polnoči); ob zamudi se pokaže prečrtan. */
  export let schedSec: number | null | undefined = null;

  $: d = delayMin ?? 0;
  $: kind = !live ? 'sched' : delayKnown && Math.abs(d) >= 1 ? 'delay' : delayKnown ? 'ontime' : 'live';
  $: base = kind === 'delay'
    ? (Math.abs(d) > 5 ? 'var(--status-disrupt)' : Math.abs(d) >= 3 ? 'var(--status-delay)' : 'var(--status-ontime)')
    : kind === 'sched' ? 'var(--text-muted)' : 'var(--status-ontime)';
  $: showSched = kind === 'delay' && d >= 1 && schedSec != null && Number.isFinite(schedSec);
</script>

{#if kind === 'sched'}
  <span class="mm-dstat t-footnote" style="color: {base}">{$t('vozni red')}</span>
{:else}
  <!-- Večje besedilo / preprost pogled: prečrtana ura nad čipom, sicer pri 320 px stisne
       ime cilja v stolpec po eno besedo. -->
  <span class="mm-dstat-row" class:mm-dstat-stack={$largeUI}>
    {#if showSched}
      <!-- Bralnik zaslona: »po voznem redu 08:37« namesto samo prečrtane ure. -->
      <span class="sr-only">{$t('po voznem redu')}</span>
      <s class="t-footnote text-muted tabular-nums mm-dstat-sched">{fmtClock(schedSec ?? 0)}</s>
    {/if}
    <span class="mm-dstat mm-dstat-chip t-footnote" style="--mm-dstat-c: {base}">
      <svg class="mm-dstat-sig" viewBox="0 0 12 12" aria-hidden="true">
        <circle cx="2.5" cy="9.5" r="1.4" fill="currentColor" />
        <path d="M2 5.2a4.8 4.8 0 0 1 4.8 4.8M2 1.6a8.4 8.4 0 0 1 8.4 8.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
      </svg>
      {#if kind === 'delay'}{d > 0 ? '+' : ''}{d} min
      {:else}{kind === 'ontime' ? $t('točno') : $t('v živo')}{/if}
    </span>
  </span>
{/if}

<style>
  .mm-dstat { font-weight: 600; white-space: nowrap; }
  .mm-dstat-row { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
  .mm-dstat-stack { flex-direction: column; align-items: flex-end; gap: 1px; }
  .mm-dstat-sched { text-decoration-thickness: 1.5px; }
  .mm-dstat-chip {
    display: inline-flex; align-items: center; gap: 3px;
    padding: 0 6px;
    border-radius: 999px;
    color: color-mix(in oklab, var(--mm-dstat-c) 80%, var(--text));
    background: color-mix(in oklab, var(--mm-dstat-c) 10%, var(--surface));
  }
  .mm-dstat-sig { width: 0.8em; height: 0.8em; flex: none; }
</style>
