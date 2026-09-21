<script lang="ts">
  // Primerjava velikosti: vodoravni stolpci, urejeni od največjega.
  // Vodoravno namenoma — oznake so besede različnih dolžin ("Vozni redi",
  // "settings"), ki bi se pri navpičnih stolpcih morale vrteti ali krajšati.
  // Barva je zaporedna lestvica enega odtenka (več = temneje), ne kategorialna:
  // kategorije tu nimajo identitete, pomembna je velikost.
  export let vrstice: { oznaka: string; n: number; poudarek?: boolean }[] = [];
  export let naslov = '';
  export let enota = '';

  const STOPNJE = ['var(--viz-s2)', 'var(--viz-s3)', 'var(--viz-s4)', 'var(--viz-s5)'];

  $: urejene = [...vrstice].sort((a, b) => (Number(b.n) || 0) - (Number(a.n) || 0));
  $: najvec = Math.max(1, ...urejene.map(v => Number(v.n) || 0));
  $: skupaj = urejene.reduce((a, v) => a + (Number(v.n) || 0), 0);

  function stopnja(n: number): string {
    const d = (Number(n) || 0) / najvec;             // 0..1
    const i = Math.min(STOPNJE.length - 1, Math.floor(d * STOPNJE.length));
    return STOPNJE[i];
  }
  const stevilo = (n: number) => Number(n).toLocaleString('sl-SI');
</script>

<figure class="mm-viz">
  <figcaption>
    <span class="t-subhead font-semibold">{naslov}</span>
    <span class="t-footnote text-muted">skupaj {stevilo(skupaj)}{enota ? ' ' + enota : ''}</span>
  </figcaption>

  {#if urejene.length === 0}
    <p class="t-footnote text-muted py-3">Za to obdobje ni podatkov.</p>
  {:else}
    <ul class="mm-bars">
      {#each urejene as v}
        {@const delez = (Number(v.n) || 0) / najvec}
        <li>
          <div class="mm-bar-vrstica">
            <span class="t-footnote mm-bar-oznaka" title={v.oznaka}>{v.oznaka}</span>
            <span class="mm-bar-tir">
              <!-- Zaobljen konec podatka; začetek je pritrjen na osnovnico. -->
              <span class="mm-bar-polnilo"
                    style="width: {Math.max(2, delez * 100)}%; background: {v.poudarek ? 'var(--viz-bad)' : stopnja(v.n)};"></span>
            </span>
            <span class="t-footnote mm-bar-stevilo tabular-nums">{stevilo(v.n)}</span>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</figure>

<style>
  .mm-viz { margin: 0; }
  .mm-viz figcaption { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.4rem; }
  .mm-bars { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .mm-bar-vrstica { display: flex; align-items: center; gap: 8px; }
  .mm-bar-oznaka {
    flex: 0 0 38%; min-width: 0; color: var(--text);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .mm-bar-tir {
    flex: 1; min-width: 0; height: calc(14px * var(--ui-scale));
    background: var(--surface-2); border-radius: 999px; overflow: hidden;
  }
  .mm-bar-polnilo { display: block; height: 100%; border-radius: 999px; }
  .mm-bar-stevilo { flex: 0 0 auto; color: var(--text); font-weight: 600; }
</style>
