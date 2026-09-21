<script lang="ts">
  // Časovnica: ena serija čez dneve, kot ploskev s črto ali kot stolpci.
  // Dve seriji na isti osi namenoma nista mogoči — dve različni merili na enem
  // grafu sta najpogostejša napaka pri grafih. Kjer je poleg glavne vrednosti
  // pomembna še napaka, se ta izriše kot obarvan del istega stolpca (ista enota,
  // ista os), nikoli kot druga os.
  export let tocke: { dan: string; n: number; slabo?: number }[] = [];
  export let naslov = '';
  export let enota = '';
  export let vrsta: 'ploskev' | 'stolpci' = 'ploskev';
  export let barva = 'var(--viz-1)';

  const W = 320, H = 96, L = 4, R = 4, T = 8, B = 18;   // viewBox; SVG se razteza

  $: vrednosti = tocke.map(t => Number(t.n) || 0);
  $: najvec = Math.max(1, ...vrednosti);
  $: skupaj = vrednosti.reduce((a, b) => a + b, 0);
  $: slabihSkupaj = tocke.reduce((a, t) => a + (Number(t.slabo) || 0), 0);

  // Vodoravne pomožne črte: tri je dovolj, več jih le zamaže sliko.
  $: mreza = [0, 0.5, 1].map(f => ({ y: T + (1 - f) * (H - T - B), v: Math.round(najvec * f) }));

  function x(i: number): number {
    if (tocke.length <= 1) return L + (W - L - R) / 2;
    return L + (i / (tocke.length - 1)) * (W - L - R);
  }
  function y(v: number): number {
    return T + (1 - v / najvec) * (H - T - B);
  }

  $: crta = tocke.map((t, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(Number(t.n) || 0).toFixed(1)}`).join(' ');
  $: ploskev = tocke.length
    ? `${crta} L${x(tocke.length - 1).toFixed(1)},${H - B} L${x(0).toFixed(1)},${H - B} Z`
    : '';
  $: sirinaStolpca = tocke.length ? Math.max(3, Math.min(22, (W - L - R) / Math.max(1, tocke.length) - 3)) : 0;

  let izbran: number | null = null;
  let vsebnik: HTMLDivElement;

  function najblizji(e: PointerEvent) {
    if (!vsebnik || tocke.length === 0) return;
    const r = vsebnik.getBoundingClientRect();
    const rel = (e.clientX - r.left) / r.width;           // 0..1 po širini
    const px = L + rel * (W - L - R);
    let naj = 0, d = Infinity;
    for (let i = 0; i < tocke.length; i++) {
      const dd = Math.abs(x(i) - px);
      if (dd < d) { d = dd; naj = i; }
    }
    izbran = naj;
  }

  function datum(v: string): string {
    const d = new Date(String(v).replace(' ', 'T'));
    return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('sl-SI', { day: 'numeric', month: 'short' });
  }
  const stevilo = (n: number) => Number(n).toLocaleString('sl-SI');
</script>

<figure class="mm-viz">
  <figcaption>
    <span class="t-subhead font-semibold">{naslov}</span>
    <span class="t-footnote text-muted">
      skupaj {stevilo(skupaj)}{enota ? ' ' + enota : ''}{slabihSkupaj > 0 ? ' · ' + stevilo(slabihSkupaj) + ' napak' : ''}
    </span>
  </figcaption>

  {#if tocke.length === 0}
    <p class="t-footnote text-muted py-3">Za to obdobje ni podatkov.</p>
  {:else}
    <div class="mm-viz-plot" bind:this={vsebnik}
         role="img" aria-label="{naslov}: {stevilo(skupaj)} {enota} v {tocke.length} dneh"
         on:pointermove={najblizji}
         on:pointerdown={najblizji}
         on:pointerleave={() => izbran = null}>
      <svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" width="100%" height="100%">
        {#each mreza as m}
          <line x1={L} x2={W - R} y1={m.y} y2={m.y} stroke="var(--viz-grid)" stroke-width="1" vector-effect="non-scaling-stroke" />
        {/each}

        {#if vrsta === 'ploskev'}
          <path d={ploskev} fill={barva} opacity="0.14" />
          <path d={crta} fill="none" stroke={barva} stroke-width="2" vector-effect="non-scaling-stroke"
                stroke-linejoin="round" stroke-linecap="round" />
          {#each tocke as t, i}
            {#if tocke.length <= 14}
              <circle cx={x(i)} cy={y(Number(t.n) || 0)} r="3" fill={barva} stroke="var(--surface)" stroke-width="2"
                      vector-effect="non-scaling-stroke" />
            {/if}
          {/each}
        {:else}
          {#each tocke as t, i}
            {@const v = Number(t.n) || 0}
            {@const s = Number(t.slabo) || 0}
            {@const vrh = y(v)}
            <!-- 4 px zaobljen konec podatka, pritrjen na osnovnico -->
            <rect x={x(i) - sirinaStolpca / 2} y={vrh} width={sirinaStolpca} height={Math.max(1, H - B - vrh)}
                  rx="3" fill={barva} opacity={izbran === i ? 1 : 0.85} />
            {#if s > 0}
              <rect x={x(i) - sirinaStolpca / 2} y={y(s)} width={sirinaStolpca} height={Math.max(1, H - B - y(s))}
                    rx="3" fill="var(--viz-bad)" stroke="var(--surface)" stroke-width="2" vector-effect="non-scaling-stroke" />
            {/if}
          {/each}
        {/if}

        {#if izbran !== null}
          <line x1={x(izbran)} x2={x(izbran)} y1={T} y2={H - B}
                stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke" />
        {/if}
      </svg>

      <!-- Oznake osi: samo prvi in zadnji dan, da se ne prekrivata. -->
      <div class="mm-viz-os t-footnote text-muted">
        <span>{datum(tocke[0].dan)}</span>
        {#if tocke.length > 1}<span>{datum(tocke[tocke.length - 1].dan)}</span>{/if}
      </div>

      {#if izbran !== null}
        <div class="mm-viz-oblacek t-footnote"
             style="left: {(x(izbran) / W) * 100}%;">
          <b>{datum(tocke[izbran].dan)}</b>
          {stevilo(Number(tocke[izbran].n) || 0)}{enota ? ' ' + enota : ''}
          {#if Number(tocke[izbran].slabo) > 0}
            <span style="color: var(--viz-bad)">· {stevilo(Number(tocke[izbran].slabo))} napak</span>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</figure>

<style>
  .mm-viz { margin: 0; }
  .mm-viz figcaption { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.4rem; }
  .mm-viz-plot { position: relative; height: calc(96px * var(--ui-scale)); touch-action: pan-y; }
  .mm-viz-plot svg { display: block; }
  .mm-viz-os { position: absolute; left: 0; right: 0; bottom: 0; display: flex; justify-content: space-between; pointer-events: none; }
  .mm-viz-oblacek {
    position: absolute; top: -2px; transform: translateX(-50%);
    background: var(--surface); color: var(--text);
    border: 1px solid var(--border); border-radius: 8px;
    padding: 2px 8px; white-space: nowrap; pointer-events: none;
    box-shadow: var(--shadow-1); max-width: 90%;
  }
</style>
