<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { GTFS } from '../../gtfs';

  // Karta najbolj gledanih postajališč. Velikost kroga nosi število pogledov
  // (ploščina je sorazmerna s številom — polmer raste s korenom, sicer bi večje
  // vrednosti optično pretiravale), barva pa je ista zaporedna lestvica kot pri
  // stolpcih. Bel obroč okoli kroga loči prekrivajoče se točke.
  //
  // Podatek je seštevek klicev prihodov po postajališču za izbrano obdobje;
  // ni vezan na napravo ali sejo.
  export let postaje: { postaja: string; n: number }[] = [];
  export let gtfs: GTFS | null = null;

  let vsebnik: HTMLDivElement;
  let karta: any = null;
  let napaka = '';
  let izbrana: { ime: string; n: number } | null = null;

  const VOYAGER = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';
  const DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

  $: tocke = (() => {
    if (!gtfs) return [];
    const poId = new Map(gtfs.stops.map(s => [s.id, s]));
    return postaje
      .map(p => ({ stop: poId.get(Number(p.postaja)), n: Number(p.n) || 0 }))
      .filter(x => x.stop)
      .map(x => ({ ime: x.stop!.name, lat: x.stop!.lat, lon: x.stop!.lon, n: x.n }));
  })();
  $: najvec = Math.max(1, ...tocke.map(t => t.n));
  $: neznanih = postaje.length - tocke.length;

  function geojson() {
    return {
      type: 'FeatureCollection',
      features: tocke.map(t => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [t.lon, t.lat] },
        properties: { ime: t.ime, n: t.n },
      })),
    };
  }

  function barva(): any[] {
    // Zaporedna lestvica enega odtenka; koraki so isti kot pri stolpcih.
    const s = (ime: string) => getComputedStyle(document.documentElement).getPropertyValue(ime).trim() || '#2a78d6';
    return ['interpolate', ['linear'], ['get', 'n'],
      1, s('--viz-s2'),
      Math.max(2, najvec * 0.35), s('--viz-s3'),
      Math.max(3, najvec * 0.7), s('--viz-s4'),
      najvec, s('--viz-s5')];
  }

  async function zgradi() {
    if (!vsebnik || tocke.length === 0) return;
    try {
      const mod = await import('maplibre-gl');
      const maplibregl = mod.default ?? mod;
      const temna = document.documentElement.classList.contains('dark');
      karta = new maplibregl.Map({
        container: vsebnik,
        style: temna ? DARK : VOYAGER,
        center: [tocke[0].lon, tocke[0].lat],
        zoom: 12,
        attributionControl: { compact: true },
        // Statistika ni orodje za raziskovanje karte — vrtenje in nagib ne rabita biti.
        pitchWithRotate: false,
        dragRotate: false,
      });
      karta.on('load', () => {
        karta.addSource('postaje', { type: 'geojson', data: geojson() });
        karta.addLayer({
          id: 'postaje-krogi',
          type: 'circle',
          source: 'postaje',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['sqrt', ['get', 'n']], 1, 6, Math.sqrt(najvec), 22],
            'circle-color': barva(),
            'circle-opacity': 0.9,
            'circle-stroke-width': 2,
            'circle-stroke-color': temna ? '#1C1C1E' : '#FFFFFF',
          },
        });
        const b = new maplibregl.LngLatBounds();
        for (const t of tocke) b.extend([t.lon, t.lat]);
        karta.fitBounds(b, { padding: 36, maxZoom: 14, duration: 0 });
      });
      karta.on('click', 'postaje-krogi', (e: any) => {
        const f = e.features?.[0];
        if (f) izbrana = { ime: f.properties.ime, n: Number(f.properties.n) };
      });
      karta.on('mouseenter', 'postaje-krogi', () => { karta.getCanvas().style.cursor = 'pointer'; });
      karta.on('mouseleave', 'postaje-krogi', () => { karta.getCanvas().style.cursor = ''; });
    } catch (e) {
      napaka = 'Karte ni bilo mogoče naložiti.';
    }
  }

  onMount(zgradi);
  onDestroy(() => { try { karta?.remove(); } catch {} });

  const stevilo = (n: number) => Number(n).toLocaleString('sl-SI');
</script>

<figure class="mm-viz">
  <figcaption>
    <span class="t-subhead font-semibold">Najbolj gledana postajališča</span>
    <span class="t-footnote text-muted">{tocke.length} postajališč</span>
  </figcaption>

  {#if tocke.length === 0}
    <p class="t-footnote text-muted py-3">
      Za to obdobje ni podatkov o postajališčih.
      {#if !gtfs}Vozni redi še niso naloženi.{/if}
    </p>
  {:else}
    <div class="mm-karta" bind:this={vsebnik}></div>
    {#if napaka}
      <p class="t-footnote py-2" style="color: var(--status-delay)">{napaka}</p>
    {/if}
    <div class="mm-legenda t-footnote text-muted">
      <span class="mm-pika mm-pika-s"></span> manj
      <span class="mm-pika mm-pika-l"></span> več pogledov
      {#if neznanih > 0}· {neznanih} neznanih id-jev{/if}
    </div>
    {#if izbrana}
      <p class="t-footnote mt-1"><b>{izbrana.ime}</b> · {stevilo(izbrana.n)} pogledov prihodov</p>
    {:else}
      <p class="t-footnote text-muted mt-1">Dotakni se kroga za ime postajališča.</p>
    {/if}
  {/if}
</figure>

<style>
  .mm-viz { margin: 0; }
  .mm-viz figcaption { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.4rem; }
  .mm-karta {
    height: calc(220px * var(--ui-scale));
    border-radius: 14px; overflow: hidden;
    border: 1px solid var(--border);
  }
  .mm-legenda { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
  .mm-pika { display: inline-block; border-radius: 999px; background: var(--viz-s4); border: 2px solid var(--surface); }
  .mm-pika-s { width: 8px; height: 8px; background: var(--viz-s2); }
  .mm-pika-l { width: 16px; height: 16px; background: var(--viz-s5); margin-left: 6px; }
</style>
