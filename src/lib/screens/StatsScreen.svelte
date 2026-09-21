<script lang="ts">
  import { ArrowLeft, RefreshCw, KeyRound, TriangleAlert } from 'lucide-svelte';
  import { focusTrap } from '../focusTrap';
  import { pridobi, beriKljuc, shraniKljuc, vsota, NapacenKljuc, type Statistika, type Vrstica } from '../stats';

  // Skriti zaslon za razvijalca: odpre se po desetih dotikih na ime v
  // Nastavitvah. Vsebuje samo seštevke — nobenega podatka o posamezniku.
  export let open = false;
  export let onClose: () => void;

  let dni = 7;
  let podatki: Statistika | null = null;
  let nalagam = false;
  let napaka = '';
  let rabiKljuc = false;
  let vnos = '';

  const IZBIRE = [1, 7, 30];

  async function nalozi() {
    if (nalagam) return;
    nalagam = true;
    napaka = '';
    try {
      podatki = await pridobi(dni);
      rabiKljuc = false;
    } catch (e) {
      podatki = null;
      if (e instanceof NapacenKljuc) {
        rabiKljuc = true;
        napaka = beriKljuc() ? '' : (e.message === 'Ključ ni pravi.' ? 'Ključ ni pravi. Poskusi znova.' : '');
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

  // Ob odprtju naloži; ob zaprtju pozabi podatke, da ne visijo v pomnilniku.
  $: if (open && !podatki && !nalagam && !rabiKljuc && !napaka) nalozi();
  $: if (!open) { podatki = null; napaka = ''; }

  function izbraniDnevi(d: number) {
    dni = d;
    podatki = null;
    nalozi();
  }

  function stevilo(v: Vrstica, polje = 'n'): string {
    return Number(v[polje] ?? 0).toLocaleString('sl-SI');
  }

  function datum(v: string): string {
    const d = new Date(String(v).replace(' ', 'T'));
    return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('sl-SI', { day: 'numeric', month: 'short' });
  }

  $: namescenih = podatki ? vsota(podatki.zagoni.filter(z => z.nacin === 'namescena')) : 0;
  $: vsehZagonov = podatki ? vsota(podatki.zagoni) : 0;
  $: klicevZaledja = podatki ? vsota(podatki.zaledje) : 0;
  $: napakZaledja = podatki
    ? vsota(podatki.zaledje.filter(v => v.izid === 'napaka' || v.izid === 'nedosegljiv'))
    : 0;
</script>

{#if open}
  <div class="mm-tap fixed inset-0 z-50 surface flex flex-col" style="padding-top: env(safe-area-inset-top);"
       use:focusTrap>
    <header class="shrink-0 px-2 pt-2 pb-2 flex items-center gap-1">
      <button class="pressable w-11 h-11 rounded-full grid place-items-center shrink-0"
              on:click={onClose} aria-label="Nazaj">
        <ArrowLeft size={20} />
      </button>
      <h1 class="t-title2 flex-1 min-w-0 truncate">Statistika</h1>
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
          <div class="flex gap-2">
            {#each IZBIRE as d}
              {@const a = dni === d}
              <button class="pressable flex-1 min-h-[44px] rounded-xl t-subhead font-semibold border"
                      style="background: {a ? 'var(--accent)' : 'var(--surface-2)'}; color: {a ? '#fff' : 'var(--text)'}; border-color: {a ? 'var(--accent)' : 'var(--border)'};"
                      on:click={() => izbraniDnevi(d)}>
                {d === 1 ? 'danes' : d + ' dni'}
              </button>
            {/each}
          </div>

          <!-- povzetek -->
          <div class="grid grid-cols-2 gap-3">
            <div class="surface-2 rounded-2xl border border-base p-3">
              <div class="t-footnote text-muted">Zagonov</div>
              <div class="t-title1">{vsehZagonov.toLocaleString('sl-SI')}</div>
              <div class="t-footnote text-muted">od tega nameščenih {namescenih.toLocaleString('sl-SI')}</div>
            </div>
            <div class="surface-2 rounded-2xl border border-base p-3">
              <div class="t-footnote text-muted">Klicev zaledja</div>
              <div class="t-title1">{klicevZaledja.toLocaleString('sl-SI')}</div>
              <div class="t-footnote" style="color: {napakZaledja > 0 ? 'var(--status-disrupt)' : 'var(--text-muted)'}">
                {napakZaledja > 0 ? napakZaledja.toLocaleString('sl-SI') + ' napak' : 'brez napak'}
              </div>
            </div>
          </div>

          <!-- zagoni -->
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
                  <div class="t-subhead font-bold tabular-nums">{stevilo(z)}</div>
                </li>
              {:else}
                <li class="px-4 py-3 t-footnote text-muted">Ni podatkov.</li>
              {/each}
            </ul>
          </section>

          <!-- zavihki + filter -->
          <section>
            <h2 class="t-footnote text-muted uppercase tracking-wide mb-2">Zavihki</h2>
            <ul class="surface rounded-2xl border border-base overflow-hidden">
              {#each podatki.zavihki as z, i}
                <li class="px-4 py-2.5 flex items-center gap-3 {i > 0 ? 'border-t border-base' : ''}">
                  <div class="flex-1 t-subhead truncate">{z.zavihek}</div>
                  <div class="t-subhead font-bold tabular-nums">{stevilo(z)}</div>
                </li>
              {:else}
                <li class="px-4 py-3 t-footnote text-muted">Ni podatkov.</li>
              {/each}
            </ul>
          </section>

          <section>
            <h2 class="t-footnote text-muted uppercase tracking-wide mb-2">Filter smeri in namestitev</h2>
            <ul class="surface rounded-2xl border border-base overflow-hidden">
              {#each [...podatki.filter.map(v => ({ k: 'filter · ' + v.smer, n: v.n })), ...podatki.namestitev.map(v => ({ k: 'namestitev · ' + v.korak, n: v.n })), ...podatki.omrezje.map(v => ({ k: 'omrežje · ' + v.stanje, n: v.n }))] as v, i}
                <li class="px-4 py-2.5 flex items-center gap-3 {i > 0 ? 'border-t border-base' : ''}">
                  <div class="flex-1 t-subhead truncate">{v.k}</div>
                  <div class="t-subhead font-bold tabular-nums">{Number(v.n).toLocaleString('sl-SI')}</div>
                </li>
              {:else}
                <li class="px-4 py-3 t-footnote text-muted">Ni podatkov.</li>
              {/each}
            </ul>
          </section>

          <!-- zaledje -->
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
                    <div class="t-footnote text-muted">mediana {Number(v.ms_p50 ?? 0).toLocaleString('sl-SI')} ms</div>
                  </div>
                  <div class="t-subhead font-bold tabular-nums">{stevilo(v)}</div>
                </li>
              {:else}
                <li class="px-4 py-3 t-footnote text-muted">Ni podatkov.</li>
              {/each}
            </ul>
          </section>

          <p class="t-footnote text-muted leading-relaxed">
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
