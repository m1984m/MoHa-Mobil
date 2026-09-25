<script lang="ts">
  import { page } from '../motion';
  import { ArrowLeft, RefreshCw, KeyRound, TriangleAlert, Table2, ChartColumn, Volume2 } from 'lucide-svelte';
  import { focusTrap } from '../focusTrap';
  import type { GTFS } from '../gtfs';
  import ChartTime from '../ui/viz/ChartTime.svelte';
  import ChartBars from '../ui/viz/ChartBars.svelte';
  import { pridobi, beriKljuc, shraniKljuc, vsota, NapacenKljuc, type Statistika, type Vrstica } from '../stats';

  // Skriti zaslon za razvijalca: odpre se po desetih dotikih na ime v
  // Nastavitvah. Vsebuje samo seštevke — nobenega podatka o posamezniku.
  //
  // Oblike so izbrane po nalogi podatka, ne po okusu: časovnice so črta oziroma
  // stolpci (sprememba skozi čas), primerjave so vodoravni stolpci (velikost),
  // posamezne številke so ploščice (ena vrednost), postajališča pa karta (prostor).
  // Nikjer ni dveh meril na eni osi in nikjer ni barve kot edinega nosilca pomena.
  export let open = false;
  export let gtfs: GTFS | null = null;
  export let onClose: () => void;

  let dni = 7;
  let podatki: Statistika | null = null;
  let nalagam = false;
  let napaka = '';
  let rabiKljuc = false;
  let vnos = '';
  let stevilke = false;          // pogled s surovimi številkami (dostopna različica grafov)

  // Karta vleče MapLibre (~800 kB), zato se naloži šele, ko so podatki tu.
  let StopMapComp: typeof import('../ui/viz/StopMap.svelte').default | null = null;

  const IZBIRE = [1, 7, 30];

  async function nalozi() {
    if (nalagam) return;
    nalagam = true;
    napaka = '';
    try {
      podatki = await pridobi(dni);
      rabiKljuc = false;
      if (!StopMapComp && podatki.postaje?.length) {
        import('../ui/viz/StopMap.svelte').then(m => { StopMapComp = m.default; }).catch(() => {});
      }
    } catch (e) {
      podatki = null;
      if (e instanceof NapacenKljuc) {
        rabiKljuc = true;
        napaka = e.message === 'Ključ ni pravi.' ? 'Ključ ni pravi. Poskusi znova.' : '';
      } else {
        napaka = e instanceof Error ? e.message : String(e);
      }
    } finally {
      nalagam = false;
    }
  }

  function shrani() {
    const v = vnos.trim();
    if (!v) return;
    shraniKljuc(v);
    vnos = '';
    nalozi();
  }

  function pozabi() {
    shraniKljuc('');
    podatki = null;
    rabiKljuc = true;
  }

  $: if (open && !podatki && !nalagam && !rabiKljuc && !napaka) nalozi();
  $: if (!open) { podatki = null; napaka = ''; }

  function izbraniDnevi(d: number) {
    dni = d;
    podatki = null;
    nalozi();
  }

  const stevilo = (n: number | string) => Number(n ?? 0).toLocaleString('sl-SI');

  function datum(v: string): string {
    const d = new Date(String(v).replace(' ', 'T'));
    return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('sl-SI', { day: 'numeric', month: 'short' });
  }

  // ── izpeljane vrednosti ────────────────────────────────────────────────────
  $: zagoniDnevi = (podatki?.zagoniDnevi ?? []).map(v => ({ dan: String(v.dan), n: Number(v.n) || 0 }));
  $: zaledjeDnevi = (podatki?.zaledjeDnevi ?? []).map(v => ({
    dan: String(v.dan), n: Number(v.n) || 0, slabo: Number(v.napak) || 0,
  }));
  $: odziv = (podatki?.zaledjeDnevi ?? []).map(v => ({ dan: String(v.dan), n: Math.round(Number(v.ms_p50) || 0) }));

  $: vsehZagonov = podatki ? vsota(podatki.zagoni) : 0;
  $: namescenih = podatki ? vsota(podatki.zagoni.filter(z => z.nacin === 'namescena')) : 0;
  $: klicevZaledja = podatki ? vsota(podatki.zaledje) : 0;
  $: napakZaledja = podatki
    ? vsota(podatki.zaledje.filter(v => v.izid === 'napaka' || v.izid === 'nedosegljiv')) : 0;
  $: medianaMs = odziv.length ? Math.round(odziv.reduce((a, b) => a + b.n, 0) / odziv.length) : 0;

  $: razlicice = (podatki?.zagoni ?? []).map(z => ({
    oznaka: `${z.razlicica} · ${z.nacin === 'namescena' ? 'nameščena' : 'brskalnik'}`,
    n: Number(z.n) || 0,
  }));
  $: zavihki = (podatki?.zavihki ?? []).map(z => ({ oznaka: String(z.zavihek), n: Number(z.n) || 0 }));
  $: postajeZaKarto = (podatki?.postaje ?? []).map(p => ({ postaja: String(p.postaja), n: Number(p.n) || 0 }));
  // ── glas Petra (Azure Speech F0): 500.000 znakov na mesec ─────────────────
  const KVOTA_GLASU = 500_000;
  $: glasZnakov = Number(podatki?.glasMesec?.[0]?.znakov) || 0;
  $: glasBranjMesec = Number(podatki?.glasMesec?.[0]?.n) || 0;
  $: glasDelez = glasZnakov / KVOTA_GLASU;
  // Ocena do konca meseca: dosedanja poraba, razpotegnjena na cel mesec. Prve ure
  // meseca je premalo podatkov, zato takrat ocene ni.
  $: glasOcena = (() => {
    const d = new Date();
    const pretekloDni = d.getUTCDate() - 1 + (d.getUTCHours() * 60 + d.getUTCMinutes()) / 1440;
    const dniVMesecu = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    return pretekloDni >= 0.25 ? Math.round(glasZnakov / pretekloDni * dniVMesecu) : null;
  })();
  // Barva nosi resnost (z ikono in napisom, nikoli sama): navadno, opozorilo, ko
  // ocena preseže kvoto, rdeča, ko je kvota porabljena.
  $: glasStanje = glasDelez >= 1 ? 'porabljena' : glasOcena != null && glasOcena > KVOTA_GLASU ? 'ocena' : 'v redu';
  $: glasBarva = glasStanje === 'porabljena' ? 'var(--status-disrupt)'
    : glasStanje === 'ocena' ? 'var(--status-delay)' : 'var(--viz-1)';
  $: glasDnevi = (podatki?.glasDnevi ?? []).map(v => ({ dan: String(v.dan), n: Number(v.znakov) || 0 }));
  const odstotek = (x: number) => (x * 100).toLocaleString('sl-SI', { maximumFractionDigits: x < 0.1 ? 1 : 0 });

  $: dejanja = [
    ...(podatki?.filter ?? []).map(v => ({ oznaka: 'filter · ' + v.smer, n: Number(v.n) || 0 })),
    ...(podatki?.namestitev ?? []).map(v => ({ oznaka: 'namestitev · ' + v.korak, n: Number(v.n) || 0 })),
    ...(podatki?.omrezje ?? []).map(v => ({
      oznaka: 'omrežje · ' + v.stanje, n: Number(v.n) || 0, poudarek: v.stanje === 'offline',
    })),
  ];
</script>

{#if open}
  <div in:page out:page={{ out: true }} class="mm-tap fixed inset-0 z-50 surface flex flex-col" style="padding-top: env(safe-area-inset-top);"
       use:focusTrap>
    <header class="shrink-0 px-2 pt-2 pb-2 flex items-center gap-1">
      <button class="pressable w-11 h-11 rounded-full grid place-items-center shrink-0"
              on:click={onClose} aria-label="Nazaj">
        <ArrowLeft size={20} />
      </button>
      <h1 class="t-title2 flex-1 min-w-0 truncate">Statistika</h1>
      {#if podatki}
        <button class="pressable w-11 h-11 rounded-full surface-2 grid place-items-center shrink-0"
                on:click={() => stevilke = !stevilke}
                aria-pressed={stevilke}
                aria-label={stevilke ? 'Pokaži grafe' : 'Pokaži številke'}>
          {#if stevilke}<ChartColumn size={18} />{:else}<Table2 size={18} />{/if}
        </button>
      {/if}
      <button class="pressable w-11 h-11 rounded-full surface-2 grid place-items-center shrink-0"
              on:click={nalozi} disabled={nalagam} aria-label="Osveži">
        <RefreshCw size={18} class={nalagam ? 'animate-spin' : ''} />
      </button>
    </header>

    <div class="flex-1 overflow-y-auto scrollbox" style="padding-bottom: calc(env(safe-area-inset-bottom) + 2rem);">
      <div class="px-4 max-w-screen-sm mx-auto space-y-5">

        {#if rabiKljuc}
          <div class="surface-2 rounded-2xl border border-base p-4 space-y-3">
            <div class="flex items-center gap-2">
              <KeyRound size={18} color="var(--text-muted)" />
              <div class="t-headline">Vpiši ključ</div>
            </div>
            <p class="t-footnote text-muted">
              Ključ je shranjen v <code>worker/secrets/analytics.json</code> pod <code>statKey</code>.
              Vpišeš ga enkrat na napravo.
            </p>
            {#if napaka}<p class="t-footnote" style="color: var(--status-disrupt)">{napaka}</p>{/if}
            <input class="w-full h-12 px-3 rounded-xl surface border border-base t-body"
                   type="password" autocomplete="off" autocapitalize="off" spellcheck="false"
                   placeholder="ključ" bind:value={vnos}
                   on:keydown={(e) => { if (e.key === 'Enter') shrani(); }} />
            <button class="pressable w-full h-12 rounded-xl t-subhead font-semibold"
                    style="background: var(--accent); color: #ffffff;"
                    on:click={shrani}>Shrani in poglej</button>
          </div>

        {:else if napaka}
          <div class="surface-2 rounded-2xl border border-base p-4 flex items-start gap-3">
            <TriangleAlert size={18} color="var(--status-delay)" />
            <div class="min-w-0">
              <div class="t-subhead font-semibold">Statistike ni bilo mogoče dobiti</div>
              <div class="t-footnote text-muted mt-1 break-words">{napaka}</div>
            </div>
          </div>

        {:else if !podatki}
          <p class="t-footnote text-muted pt-2">Nalagam …</p>
        {/if}

        {#if podatki}
          <!-- obdobje -->
          <div class="flex gap-2" role="group" aria-label="Obdobje">
            {#each IZBIRE as d}
              {@const a = dni === d}
              <button class="pressable flex-1 min-h-[44px] rounded-xl t-subhead font-semibold border"
                      style="background: {a ? 'var(--accent)' : 'var(--surface-2)'}; color: {a ? '#fff' : 'var(--text)'}; border-color: {a ? 'var(--accent)' : 'var(--border)'};"
                      aria-pressed={a}
                      on:click={() => izbraniDnevi(d)}>
                {d === 1 ? 'danes' : d + ' dni'}
              </button>
            {/each}
          </div>

          <!-- ploščice: ena vrednost na ploščico, brez grafa -->
          <div class="grid grid-cols-2 gap-3">
            <!-- Kvota glasu: razmerje proti meji → merilnik (sled je svetlejši korak iste barve). -->
            <div class="surface-2 rounded-2xl border border-base p-3 col-span-2">
              <div class="t-footnote text-muted flex items-center gap-1.5"><Volume2 size={14} /> Glas Petra ta mesec (Azure F0)</div>
              <div class="flex items-baseline gap-2 flex-wrap">
                <div class="mm-hero">{stevilo(glasZnakov)}</div>
                <div class="t-subhead text-muted">od {stevilo(KVOTA_GLASU)} znakov · {odstotek(glasDelez)} %</div>
              </div>
              <div class="mm-meter mt-2" role="meter" aria-valuemin="0" aria-valuemax={KVOTA_GLASU} aria-valuenow={glasZnakov}
                   aria-label="Poraba kvote glasu" style="--m: {glasBarva}">
                <div class="mm-meter-fill" style="width: {Math.min(100, glasDelez * 100)}%"></div>
              </div>
              <div class="t-footnote text-muted mt-1.5">
                {stevilo(glasBranjMesec)} klicev{#if glasOcena != null}&nbsp;· ocena do konca meseca {stevilo(glasOcena)} znakov ({odstotek(glasOcena / KVOTA_GLASU)} %){/if}
              </div>
              {#if glasStanje !== 'v redu'}
                <div class="t-footnote font-semibold mt-1 flex items-center gap-1.5" style="color: {glasBarva}">
                  <TriangleAlert size={14} />
                  {glasStanje === 'porabljena'
                    ? 'Kvota je porabljena — do 1. v mesecu bere glas telefona.'
                    : 'Po tej porabi bo kvota pred koncem meseca porabljena; nato bere glas telefona.'}
                </div>
              {/if}
            </div>
            <div class="surface-2 rounded-2xl border border-base p-3">
              <div class="t-footnote text-muted">Zagonov</div>
              <div class="mm-hero">{stevilo(vsehZagonov)}</div>
              <div class="t-footnote text-muted">nameščenih {stevilo(namescenih)}</div>
            </div>
            <div class="surface-2 rounded-2xl border border-base p-3">
              <div class="t-footnote text-muted">Klicev zaledja</div>
              <div class="mm-hero">{stevilo(klicevZaledja)}</div>
              <div class="t-footnote" style="color: {napakZaledja > 0 ? 'var(--status-disrupt)' : 'var(--text-muted)'}">
                {napakZaledja > 0 ? stevilo(napakZaledja) + ' napak' : 'brez napak'}
              </div>
            </div>
          </div>

          {#if !stevilke}
            <!-- ── grafi ─────────────────────────────────────────────────── -->
            <section class="surface-2 rounded-2xl border border-base p-3">
              <ChartTime tocke={zagoniDnevi} naslov="Zagoni po dnevih" enota="zagonov" vrsta="ploskev" />
            </section>

            <section class="surface-2 rounded-2xl border border-base p-3 space-y-4">
              <ChartTime tocke={zaledjeDnevi} naslov="Klici zaledja po dnevih" enota="klicev" vrsta="stolpci" />
              <p class="t-footnote text-muted">
                Rdeči del stolpca so neuspeli klici. Prav ta številka bi septembra pokazala,
                da posrednik ne odgovarja.
              </p>
              <ChartTime tocke={odziv} naslov="Odzivni čas (mediana)" enota="ms" vrsta="ploskev" povzetek="povprecje" />
            </section>

            <section class="surface-2 rounded-2xl border border-base p-3">
              <ChartTime tocke={glasDnevi} naslov="Znaki za glas po dnevih" enota="znakov" vrsta="stolpci" />
            </section>

            {#if StopMapComp && podatki.postaje?.length}
              <section class="surface-2 rounded-2xl border border-base p-3">
                <svelte:component this={StopMapComp} postaje={postajeZaKarto} {gtfs} />
              </section>
            {/if}

            <section class="surface-2 rounded-2xl border border-base p-3">
              <ChartBars vrstice={zavihki} naslov="Zavihki" enota="preklopov" />
            </section>

            <section class="surface-2 rounded-2xl border border-base p-3">
              <ChartBars vrstice={razlicice} naslov="Katera gradnja teče" enota="zagonov" />
            </section>

            {#if dejanja.length}
              <section class="surface-2 rounded-2xl border border-base p-3">
                <ChartBars vrstice={dejanja} naslov="Dejanja" enota="dogodkov" />
              </section>
            {/if}

          {:else}
            <!-- ── številke: ista vsebina brez barv, za bralnik zaslona in izvoz ── -->
            <section>
              <h2 class="t-footnote text-muted uppercase tracking-wide mb-2">Zagoni</h2>
              <ul class="surface rounded-2xl border border-base overflow-hidden">
                {#each podatki.zagoni as z, i}
                  <li class="px-4 py-2.5 flex items-center gap-3 {i > 0 ? 'border-t border-base' : ''}">
                    <div class="flex-1 min-w-0">
                      <div class="t-subhead font-medium truncate">
                        {z.nacin === 'namescena' ? 'Nameščena' : 'V brskalniku'} · {z.razlicica}
                      </div>
                      <div class="t-footnote text-muted truncate">
                        tema {z.tema}{z.starejsi === 'da' ? ' · za starejše' : ''}
                      </div>
                    </div>
                    <div class="t-subhead font-bold tabular-nums">{stevilo(z.n)}</div>
                  </li>
                {:else}
                  <li class="px-4 py-3 t-footnote text-muted">Ni podatkov.</li>
                {/each}
              </ul>
            </section>

            <section>
              <h2 class="t-footnote text-muted uppercase tracking-wide mb-2">Zavihki in dejanja</h2>
              <ul class="surface rounded-2xl border border-base overflow-hidden">
                {#each [...zavihki, ...dejanja] as v, i}
                  <li class="px-4 py-2.5 flex items-center gap-3 {i > 0 ? 'border-t border-base' : ''}">
                    <div class="flex-1 t-subhead truncate">{v.oznaka}</div>
                    <div class="t-subhead font-bold tabular-nums">{stevilo(v.n)}</div>
                  </li>
                {:else}
                  <li class="px-4 py-3 t-footnote text-muted">Ni podatkov.</li>
                {/each}
              </ul>
            </section>

            <section>
              <h2 class="t-footnote text-muted uppercase tracking-wide mb-2">Zaledje po dnevih</h2>
              <ul class="surface rounded-2xl border border-base overflow-hidden">
                {#each podatki.zaledje as v, i}
                  {@const slabo = v.izid === 'napaka' || v.izid === 'nedosegljiv'}
                  <li class="px-4 py-2.5 flex items-center gap-3 {i > 0 ? 'border-t border-base' : ''}">
                    <div class="flex-1 min-w-0">
                      <div class="t-subhead font-medium truncate">
                        {datum(String(v.dan))} · {v.storitev}
                        <span style="color: {slabo ? 'var(--status-disrupt)' : 'var(--status-ontime)'}">{v.izid}</span>
                      </div>
                      <div class="t-footnote text-muted">mediana {stevilo(v.ms_p50)} ms</div>
                    </div>
                    <div class="t-subhead font-bold tabular-nums">{stevilo(v.n)}</div>
                  </li>
                {:else}
                  <li class="px-4 py-3 t-footnote text-muted">Ni podatkov.</li>
                {/each}
              </ul>
            </section>

            <section>
              <h2 class="t-footnote text-muted uppercase tracking-wide mb-2">Glas po dnevih</h2>
              <ul class="surface rounded-2xl border border-base overflow-hidden">
                {#each podatki.glasDnevi ?? [] as v, i}
                  <li class="px-4 py-2.5 flex items-center gap-3 {i > 0 ? 'border-t border-base' : ''}">
                    <div class="flex-1 min-w-0">
                      <div class="t-subhead font-medium truncate">{datum(String(v.dan))} · {stevilo(v.n)} klicev</div>
                      <div class="t-footnote text-muted">iz predpomnilnika {stevilo(v.izPredpomnilnika)} · napak {stevilo(v.napak)}</div>
                    </div>
                    <div class="t-subhead font-bold tabular-nums">{stevilo(v.znakov)}</div>
                  </li>
                {:else}
                  <li class="px-4 py-3 t-footnote text-muted">Ni podatkov.</li>
                {/each}
              </ul>
            </section>

            {#if podatki.postaje?.length}
              <section>
                <h2 class="t-footnote text-muted uppercase tracking-wide mb-2">Postajališča (id · pogledi)</h2>
                <ul class="surface rounded-2xl border border-base overflow-hidden">
                  {#each podatki.postaje.slice(0, 15) as v, i}
                    <li class="px-4 py-2.5 flex items-center gap-3 {i > 0 ? 'border-t border-base' : ''}">
                      <div class="flex-1 t-subhead truncate">
                        {gtfs?.stops.find(s => s.id === Number(v.postaja))?.name ?? ('id ' + v.postaja)}
                      </div>
                      <div class="t-subhead font-bold tabular-nums">{stevilo(v.n)}</div>
                    </li>
                  {/each}
                </ul>
              </section>
            {/if}
          {/if}

          <p class="t-footnote text-muted leading-relaxed">
            Povprečna mediana odziva {stevilo(medianaMs)} ms.
            Osveženo {new Date(podatki.ob).toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' })}{podatki.izPredpomnilnika ? ' (iz predpomnilnika Workerja)' : ''}.
            Hramba je tri mesece. Samo seštevki — nobenega podatka o posamezniku.
          </p>
          <button class="pressable w-full h-11 rounded-xl t-subhead surface-2 border border-base"
                  on:click={pozabi}>Pozabi ključ na tej napravi</button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  /* Vodilna številka: velika in v sans, kot pri ploščici s KPI. */
  .mm-hero {
    font-size: calc(30px * var(--ui-scale));
    line-height: 1.1;
    font-weight: 700;
    letter-spacing: -0.5px;
    margin: 2px 0;
  }
  /* Merilnik kvote: polnilo nosi resnost (--m), sled je svetlejši korak iste barve. */
  .mm-meter {
    height: 10px; border-radius: 999px; overflow: hidden;
    background: color-mix(in oklab, var(--m) 18%, var(--surface));
  }
  .mm-meter-fill { height: 100%; border-radius: 999px; background: var(--m); }
</style>
