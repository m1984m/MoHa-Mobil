<script lang="ts">
  import { t } from '../i18n';

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
  export let live = false;
  export let delayKnown = false;
  export let delayMin: number | null | undefined = null;

  $: d = delayMin ?? 0;
  $: kind = !live ? 'sched' : delayKnown && Math.abs(d) >= 1 ? 'delay' : delayKnown ? 'ontime' : 'live';
  $: base = kind === 'delay'
    ? (Math.abs(d) > 5 ? 'var(--status-disrupt)' : Math.abs(d) >= 3 ? 'var(--status-delay)' : 'var(--status-ontime)')
    : kind === 'sched' ? 'var(--text-muted)' : 'var(--status-ontime)';
</script>

{#if kind === 'delay'}
  <span class="mm-dstat mm-dstat-chip t-footnote" style="--mm-dstat-c: {base}">{d > 0 ? '+' : ''}{d} min</span>
{:else if kind === 'sched'}
  <span class="mm-dstat t-footnote" style="color: {base}">{$t('vozni red')}</span>
{:else}
  <span class="mm-dstat mm-dstat-chip t-footnote" style="--mm-dstat-c: {base}">
    {kind === 'ontime' ? $t('točno') : $t('v živo')}
  </span>
{/if}

<style>
  .mm-dstat { font-weight: 600; white-space: nowrap; }
  .mm-dstat-chip {
    padding: 0 6px;
    border-radius: 999px;
    color: color-mix(in oklab, var(--mm-dstat-c) 80%, var(--text));
    background: color-mix(in oklab, var(--mm-dstat-c) 10%, var(--surface));
  }
</style>
