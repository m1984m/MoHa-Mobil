<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Footprints, MapPin, Clock3, TriangleAlert } from 'lucide-svelte';
  import LineBadge from './LineBadge.svelte';
  import { fmtClock, fmtDuration } from '../time';
  import { t, plural } from '../i18n';
  import { splitHeadsign } from '../gtfs';
  import type { PlanLeg } from '../planner';

  // Pot po korakih kot časovnica, ne kot seznam vrstic.
  //
  // Prej je kartica naštela "Hoja · 350 m", "→ <cel opis linije>", "5×" in čas
  // ob strani. Trije podatki, ki jih potnik v resnici potrebuje — kdaj mora
  // oditi, na kateri postaji vstopi in kje izstopi — so bili razmetani med
  // ostalo. Zdaj ima vsak korak uro na levi, vozlišče na hrbtenici in stavek,
  // ki se prebere kot navodilo. Čakanje med prestopi je svoja vrstica, ker je
  // prav to tisto, kar potnik hoče vedeti vnaprej.
  export let legs: PlanLeg[] = [];
  export let ciljIme = '';

  // Ura teče, da "Kreni čez 4 min" ne obtiči. 15 s je dovolj gosto za minute.
  let zdaj = Date.now();
  let ura: ReturnType<typeof setInterval> | null = null;
  onMount(() => { ura = setInterval(() => { zdaj = Date.now(); }, 15_000); });
  onDestroy(() => { if (ura) clearInterval(ura); });

  $: prviOdhod = (() => {
    const bus = legs.find(l => l.kind === 'bus');
    if (bus && bus.kind === 'bus') return bus.depSec;
    return null;
  })();

  // Kdaj mora potnik oditi od doma: odhod prvega busa minus hoja do postaje.
  $: krenitiSec = (() => {
    if (prviOdhod == null) return null;
    const prva = legs[0];
    const hoja = prva && prva.kind === 'walk' ? prva.sec : 0;
    return prviOdhod - hoja;
  })();

  $: sekundDoOdhoda = (() => {
    if (krenitiSec == null) return null;
    const d = new Date(zdaj);
    const zdajSec = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
    return krenitiSec - zdajSec;
  })();
  $: minutDoOdhoda = sekundDoOdhoda == null ? null : Math.round(sekundDoOdhoda / 60);

  $: prihodSec = (() => {
    for (let i = legs.length - 1; i >= 0; i--) {
      const l = legs[i];
      if (l.kind === 'bus') {
        // za zadnjim busom je lahko še hoja
        const potem = legs.slice(i + 1).reduce((a, x) => a + (x.kind === 'walk' ? x.sec : 0), 0);
        return l.arrSec + potem;
      }
    }
    return null;
  })();

  // Čas, ob katerem se posamezen korak začne. Hoja pred prvim busom se računa
  // nazaj od njegovega odhoda; vse za busom pa naprej od prihoda.
  function zacetki(l: PlanLeg[]): (number | null)[] {
    const out: (number | null)[] = new Array(l.length).fill(null);
    let zadnjiBus = -1;
    for (let i = 0; i < l.length; i++) {
      const x = l[i];
      if (x.kind === 'bus') { out[i] = x.depSec; zadnjiBus = i; }
    }
    // pred prvim busom nazaj
    const prvi = l.findIndex(x => x.kind === 'bus');
    if (prvi > 0) {
      let t = (l[prvi] as any).depSec as number;
      for (let i = prvi - 1; i >= 0; i--) {
        const x = l[i];
        if (x.kind === 'walk') { t -= x.sec; out[i] = t; }
      }
    }
    // za zadnjim busom naprej
    if (zadnjiBus >= 0) {
      let t = (l[zadnjiBus] as any).arrSec as number;
      for (let i = zadnjiBus + 1; i < l.length; i++) {
        const x = l[i];
        if (x.kind === 'walk') { out[i] = t; t += x.sec; }
      }
    }
    return out;
  }
  $: casi = zacetki(legs);

  // Čakanje pred korakom i: razlika med koncem prejšnjega in začetkom tega.
  function cakanje(i: number): number {
    if (i === 0) return 0;
    const prej = legs[i - 1], zdajL = legs[i];
    if (zdajL.kind !== 'bus') return 0;
    const konecPrej = prej.kind === 'bus' ? prej.arrSec : (casi[i - 1] ?? 0) + prej.sec;
    return Math.max(0, zdajL.depSec - konecPrej);
  }

  const min = (sec: number) => Math.max(1, Math.round(sec / 60));

  // Vmesne postaje v opisu linije brez tistih, ki sta že izpisani kot vstop in
  // izstop — "prek Kamnica" pri vstopu na Kamnici ne pove nicesar.
  function vmesne(via: string, vstop: string, izstop: string): string {
    const n = (x: string) => x.trim().toLowerCase().replace(/\s+/g, ' ');
    return via.split(',').map(x => x.trim()).filter(Boolean)
      .filter(x => n(x) !== n(vstop) && n(x) !== n(izstop))
      .join(', ');
  }
</script>

<div class="mm-koraki">
  <!-- Vodilo: kdaj oditi. To je edini podatek, ki ga potnik pogleda prvi. -->
  {#if krenitiSec != null}
    <div class="mm-kreni"
         class:mm-kreni-zdaj={sekundDoOdhoda !== null && sekundDoOdhoda <= 120 && sekundDoOdhoda >= -90}
         class:mm-kreni-mimo={sekundDoOdhoda !== null && sekundDoOdhoda < -90}>
      {#if sekundDoOdhoda !== null && sekundDoOdhoda < -90}
        <TriangleAlert size={16} class="shrink-0" />
        <span><b>{$t('Ta odhod je mimo.')}</b> {$t('Poišči novega.')}</span>
      {:else if sekundDoOdhoda !== null && sekundDoOdhoda <= 60}
        <Footprints size={16} class="shrink-0" />
        <span><b>{$t('Kreni zdaj')}</b> · {$t('bus ob {time}', { time: fmtClock(prviOdhod ?? 0) })}</span>
      {:else}
        <Footprints size={16} class="shrink-0" />
        <span>
          <b>{$t('Kreni ob {time}', { time: fmtClock(krenitiSec) })}</b>
          {#if minutDoOdhoda !== null && minutDoOdhoda <= 90}· {$t('čez {n} min', { n: minutDoOdhoda })}{/if}
          {#if prihodSec != null}· {$t('na cilju ob {time}', { time: fmtClock(prihodSec) })}{/if}
        </span>
      {/if}
    </div>
  {/if}

  <ol class="mm-os">
    {#each legs as leg, i}
      {@const cak = cakanje(i)}
      {#if cak >= 60}
        <li class="mm-cakanje">
          <span class="mm-cakanje-znak"><Clock3 size={13} /></span>
          <span class="t-footnote text-muted">{$t('Čakanje {n} min', { n: min(cak) })}</span>
        </li>
      {/if}

      <!-- Hoja pod 30 m ni korak: potnik je že na postaji. Vrstica "Hoja 1 min -
           0 m" je samo šum. Čas se kljub temu upošteva, ker se racuna iz odhoda. -->
      {#if !(leg.kind === 'walk' && leg.meters < 30)}
      <li class="mm-korak">
        <span class="mm-ura t-footnote tabular-nums">{casi[i] != null ? fmtClock(casi[i]) : ''}</span>

        {#if leg.kind === 'walk'}
          <span class="mm-vozlisce mm-vozlisce-hoja"><Footprints size={15} /></span>
          <div class="mm-vsebina">
            <div class="t-callout font-medium">
              {$t('Hoja {n} min', { n: min(leg.sec) })}
              <span class="text-muted">· {Math.round(leg.meters)} m</span>
            </div>
            <div class="t-footnote text-muted">
              {#if leg.toStop && leg.fromStop}
                {leg.fromStop.name} → {leg.toStop.name}
              {:else if leg.toStop}
                {$t('do postaje {stop}', { stop: leg.toStop.name })}
              {:else if leg.fromStop}
                {$t('od postaje {stop} do cilja', { stop: leg.fromStop.name })}
              {:else}
                {$t('do cilja')}
              {/if}
            </div>
          </div>
        {:else}
          {@const cilj = splitHeadsign(leg.headsign)}
          {@const prek = vmesne(cilj.via, leg.from.name, leg.to.name)}
          <span class="mm-vozlisce mm-vozlisce-bus"><LineBadge short={leg.route.short} routeId={leg.route.id} size="sm" /></span>
          <div class="mm-vsebina">
            <div class="t-callout font-medium">
              {$t('Vstopi na {stop}', { stop: leg.from.name })}
            </div>
            <div class="t-footnote text-muted">
              {$t('Linija {line} proti {dest}', { line: leg.route.short, dest: cilj.dest })}
              {#if prek}<span class="mm-prek">· {$t('prek {via}', { via: prek })}</span>{/if}
            </div>
            <div class="mm-izstop t-footnote">
              <span class="mm-izstop-ura tabular-nums">{fmtClock(leg.arrSec)}</span>
              {$t('Izstopi na')} <b>{leg.to.name}</b>
              <span class="text-muted">
                · {leg.stopCount} {plural(leg.stopCount, ['postaja', 'postaji', 'postaje', 'postaj'], ['stop', 'stops'])}
                · {fmtDuration((leg.arrSec - leg.depSec) / 60)}
              </span>
            </div>
          </div>
        {/if}
      </li>
      {/if}
    {/each}

    {#if prihodSec != null}
      <li class="mm-korak mm-korak-konec">
        <span class="mm-ura t-footnote tabular-nums">{fmtClock(prihodSec)}</span>
        <span class="mm-vozlisce mm-vozlisce-cilj"><MapPin size={15} /></span>
        <div class="mm-vsebina">
          <div class="t-callout font-medium">{$t('Prihod na cilj')}</div>
          {#if ciljIme}<div class="t-footnote text-muted truncate">{ciljIme}</div>{/if}
        </div>
      </li>
    {/if}
  </ol>
</div>

<style>
  .mm-koraki { --os-levo: calc(52px * var(--ui-scale)); }

  .mm-kreni {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 12px; margin-bottom: 10px;
    border-radius: 14px;
    background: var(--surface-2); border: 1px solid var(--border);
    font-size: calc(15px * var(--ui-scale)); line-height: 1.35;
  }
  .mm-kreni-zdaj { border-color: var(--status-ontime); color: var(--status-ontime); }
  .mm-kreni-mimo { border-color: var(--status-disrupt); color: var(--status-disrupt); }

  .mm-os { list-style: none; margin: 0; padding: 0; position: relative; }

  /* Hrbtenica: ena navpičnica skozi vsa vozlišča. Riše se kot ozadje, da se ne
     lomi med elementi seznama. */
  .mm-os::before {
    content: '';
    position: absolute;
    left: calc(var(--os-levo) + 14px * var(--ui-scale));
    top: 12px; bottom: 16px;
    width: 2px;
    background: var(--border);
    border-radius: 1px;
  }

  .mm-korak { position: relative; display: flex; align-items: flex-start; gap: 10px; padding: 8px 0; }
  .mm-ura { flex: 0 0 var(--os-levo); text-align: right; color: var(--text); font-weight: 600; padding-top: 3px; }
  .mm-vozlisce {
    position: relative; z-index: 1; flex: none;
    width: calc(30px * var(--ui-scale)); height: calc(30px * var(--ui-scale));
    border-radius: 999px; display: grid; place-items: center;
    background: var(--surface); border: 2px solid var(--border);
    color: var(--text-muted);
  }
  .mm-vozlisce-bus { border-color: transparent; background: transparent; width: auto; padding: 0 2px; }
  .mm-vozlisce-cilj { border-color: var(--accent); color: var(--accent); }
  .mm-vsebina { flex: 1; min-width: 0; padding-top: 2px; }

  .mm-prek { display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }

  /* Izstop je del istega koraka: potnik bere "vstopi tu → izstopi tam". */
  .mm-izstop {
    margin-top: 6px; padding: 6px 8px;
    background: var(--surface-2); border-radius: 10px;
    display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px;
  }
  .mm-izstop-ura { font-weight: 700; color: var(--text); }

  .mm-cakanje { display: flex; align-items: center; gap: 8px; padding: 2px 0 2px calc(var(--os-levo) + 6px); }
  .mm-cakanje-znak {
    position: relative; z-index: 1;
    width: calc(18px * var(--ui-scale)); height: calc(18px * var(--ui-scale));
    border-radius: 999px; display: grid; place-items: center;
    background: var(--surface); color: var(--text-muted);
  }
</style>
