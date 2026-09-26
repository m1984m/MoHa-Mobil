<script lang="ts">
  import { page } from '../motion';
  import { onDestroy, onMount, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { ArrowLeft, MapPin, Star, BellRing, TriangleAlert, Check, Volume2 } from 'lucide-svelte';
  import { nearestStops, type GTFS, type Stop } from '../gtfs';
  import { favStops } from '../favorites';
  import { alarms, addAlarm, updateAlarm, computeOccurrences } from '../alarms';
  import { pushState, enablePush } from '../push';
  import { pushBack, type BackRelease } from '../backstack';
  import { focusTrap } from '../focusTrap';
  import { fmtClock } from '../time';
  import { t, tr } from '../i18n';
  import { stopHint, searchStops, linesAtStop, departureTimes, sampleDate, type StopLine } from '../simpleStops';
  import LineBadge from '../ui/LineBadge.svelte';
  import ReadAloud from '../ui/ReadAloud.svelte';
  import { speak, stopSpeaking, speakingOwner, canSpeak } from '../speech';
  import { petraGuide } from '../simple';

  // Preprost pogled: opomnik za odhod v šestih korakih, po eno vprašanje na zaslon.
  // Postajališče → avtobus (linija in smer) → dnevi → ura avtobusa → koliko prej →
  // pregled. En avtobus = en opomnik (okno od–do je ena minuta); okna z več
  // avtobusi ostanejo v celotni aplikaciji (Matejeva odločitev 26.09.2026).
  // Izbira z enim odgovorom gre sama naprej, dnevi (več odgovorov) imajo "Naprej".
  export let gtfs: GTFS | null;
  export let origin: { lat: number; lon: number };
  export let hasGeo: boolean;
  export let onClose: () => void;

  type Step = 'stop' | 'line' | 'days' | 'time' | 'lead' | 'summary' | 'done';
  const ORDER: Step[] = ['stop', 'line', 'days', 'time', 'lead', 'summary'];
  let step: Step = 'stop';
  let stop: Stop | null = null;
  let line: StopLine | null = null;
  let days: boolean[] = [false, false, false, false, false, false, false];
  let depSec: number | null = null;
  let lead = 10;
  let query = '';
  let saving = false;
  let dlg: HTMLElement;

  // Menjava koraka: nov korak dobi fokus na vprašanju — sicer fokus pade na <body>
  // (gumb, ki ga je imel, izgine) in bralnik zaslona novega vprašanja ne prebere.
  function go(s: Step) {
    step = s;
    guide(s);
    void tick().then(() => dlg?.querySelector<HTMLElement>('h1')?.focus());
  }

  const LEADS = [5, 10, 15, 20, 30];
  const DAY_NAMES = ['Ponedeljek', 'Torek', 'Sreda', 'Četrtek', 'Petek', 'Sobota', 'Nedelja'];
  const DAY_LOC = ['ponedeljkih', 'torkih', 'sredah', 'četrtkih', 'petkih', 'sobotah', 'nedeljah'];

  // Sistemski nazaj gre en korak nazaj kot gumb "Nazaj" (starejši ga pritisnejo, da
  // popravijo izbiro, ne da bi izgubili vse); na prvem koraku čarovnik zapre.
  let back: BackRelease = pushBack(onSystemBack);
  let alive = true;
  function onSystemBack() {
    // Med shranjevanjem ostane na pregledu (kot gumb Nazaj, ki je takrat onemogočen);
    // sicer bi po koncu shranjevanja skočil s prejšnjega koraka na "shranjeno".
    if (saving) { back = pushBack(onSystemBack); return; }
    const i = ORDER.indexOf(step);
    if (step === 'done' || i <= 0) { onClose(); return; }
    // Najprej nov vnos: pushBack utiša branje, Petra pa naj prebere prejšnji korak.
    back = pushBack(onSystemBack);
    go(ORDER[i - 1]);
  }
  onDestroy(() => {
    alive = false;
    back();
    if (get(speakingOwner) === GUIDE) stopSpeaking();
  });

  function goBack() {
    if (saving) return;
    const i = ORDER.indexOf(step);
    if (step === 'done' || i <= 0) { onClose(); return; }
    go(ORDER[i - 1]);
  }

  // ── 1. postajališče ──
  $: saved = gtfs ? [...$favStops].map(id => gtfs!.stops.find(s => s.id === id)).filter((s): s is Stop => !!s) : [];
  // Izračunana enkrat: ob živi legi bi se vrstice ob vsakem novem položaju premikale
  // pod prstom.
  let near: (Stop & { d: number })[] = [];
  $: if (!near.length && gtfs && hasGeo) {
    near = nearestStops(gtfs.stops, origin, 6).filter(s => s.d <= 600 && !$favStops.has(s.id)).slice(0, 3);
  }
  $: found = searchStops(gtfs, query, 8);
  function pickStop(s: Stop) { stop = s; line = null; depSec = null; go('line'); }

  // ── 2. avtobus ──
  $: lines = gtfs && stop ? linesAtStop(gtfs, stop.id) : [];
  function pickLine(l: StopLine) { line = l; depSec = null; go('days'); }

  // ── 3. dnevi ──
  function preset(p: 'work' | 'all' | 'weekend') {
    days = [0, 1, 2, 3, 4, 5, 6].map(i => p === 'all' || (p === 'work' ? i < 5 : i >= 5));
    depSec = null;
    go('time');
  }
  function toggleDay(i: number) { days = days.map((v, j) => (j === i ? !v : v)); depSec = null; }

  // ── 4. ura avtobusa ── ure, ob katerih vozi VSE izbrane dni. Opomnik je en
  // avtobus ob točni uri; sobotni in nedeljski vozni red se pri skoraj vseh linijah
  // razlikujeta, zato bi ura samo enega dne ob drugih dneh tiho ne zazvonila.
  // Vsak dan v tednu po svojem vzorčnem datumu brez praznika.
  // Funkcija, ne samo reaktivni blok: Petra rabi ure takoj ob menjavi koraka, še
  // preden Svelte osveži $: vrednosti.
  // Dan brez prometa v naslednjih štirih tednih (sampleDate = null) pomeni, da vozni
  // red zanj še ni objavljen, ne da avtobus ne vozi — ure so iz ostalih dni.
  function timeInfo(g: GTFS | null, st: Stop | null, l: StopLine | null, d: boolean[]) {
    const perDay: Set<number>[] = [];
    let missing = 0;
    if (g && st && l) {
      for (const i of [0, 1, 2, 3, 4, 5, 6].filter(i => d[i])) {
        const date = sampleDate(g, i);
        if (date) perDay.push(new Set(departureTimes(g, st.id, l.routeId, l.dir, date)));
        else missing++;
      }
    }
    return {
      times: perDay.length ? [...perDay[0]].filter(s => perDay.every(x => x.has(s))).sort((a, b) => a - b) : [],
      differ: perDay.some(x => x.size !== perDay[0].size || [...x].some(s => !perDay[0].has(s))),
      missing, none: missing > 0 && perDay.length === 0,
    };
  }
  let times: number[] = [];
  let differ = false;
  let missing = 0;
  let none = false;
  $: ({ times, differ, missing, none } = timeInfo(gtfs, stop, line, days));
  function noTimesText(ti: { differ: boolean; none: boolean }): string {
    if (ti.none) return tr('Vozni red za izbrane dni še ni objavljen. Poskusi znova čez nekaj dni.');
    return ti.differ
      ? tr('Ob izbranih dnevih ta avtobus ne vozi ob isti uri. Naredi ločena opomnika, na primer za delavnike in za konec tedna.')
      : tr('Ta avtobus na izbrane dni ne vozi.');
  }
  const PARTS: [string, number, number][] = [
    ['Zjutraj', 0, 9], ['Dopoldne', 9, 12], ['Popoldne', 12, 17], ['Zvečer', 17, 30],
  ];
  function pickTime(s: number) { depSec = s; go('lead'); }

  // ── 5. koliko prej ──
  function pickLead(n: number) { lead = n; go('summary'); }

  // ── 6. pregled ──
  function daysPhrase(d: boolean[]): string {
    const on = d.map((v, i) => (v ? i : -1)).filter(i => i >= 0);
    if (on.length === 7) return tr('vsak dan');
    if (on.length === 5 && on.every(i => i < 5)) return tr('vsak delavnik');
    if (on.length === 2 && on[0] === 5 && on[1] === 6) return tr('ob sobotah in nedeljah');
    const names = on.map(i => tr(DAY_LOC[i]));
    return tr('ob {dni}', { dni: names.length > 1 ? `${names.slice(0, -1).join(', ')} ${tr('in')} ${names[names.length - 1]}` : names[0] });
  }
  function summaryOf(st: Stop | null, l: StopLine | null, dep: number | null, d: boolean[], n: number): string {
    return st && l && dep != null
      ? tr('Opomnim te {kdaj}, {n} minut pred odhodom avtobusa {line}, smer {dest}, ob {ura} s postajališča {stop}.', {
          kdaj: daysPhrase(d), n, line: l.routeShort, ura: fmtClock(dep), stop: st.name, dest: l.dest,
        })
      : '';
  }
  $: summary = summaryOf(stop, line, depSec, days, lead);

  async function save() {
    if (!gtfs || !stop || !line || depSec == null || saving) return;
    saving = true;
    // Okno, ki zajame točno ta odhod tudi, če bi imel sekunde (od = do pri celi minuti).
    const fromMin = Math.floor(depSec / 60), toMin = Math.ceil(depSec / 60);
    const dup = get(alarms).find(a => a.stopId === stop!.id && a.routeId === line!.routeId && a.dir === line!.dir
      && a.fromMin === fromMin && a.toMin === toMin && a.leadMin === lead && a.days.join() === days.join());
    // Isti opomnik že obstaja: izklopljenega vklopi, sicer bi "shranjeno" ne zazvonilo.
    if (dup) {
      if (!dup.enabled) updateAlarm(dup.id, { enabled: true });
    } else {
      addAlarm({
        stopId: stop.id, routeId: line.routeId, dir: line.dir,
        stopName: stop.name, routeShort: line.routeShort, headsign: line.dest,
        days: [...days], fromMin, toMin, leadMin: lead, enabled: true,
      });
    }
    // Dovoljenje za obvestila mora zahtevati dotik (iOS) — ta klic je še v njem.
    if (!get(pushState).subscribed) await enablePush(computeOccurrences(gtfs, get(alarms)));
    saving = false;
    // Čarovnik je bil med čakanjem zaprt (Esc): Petra ne sme govoriti na drugem zaslonu.
    if (!alive) return;
    go('done');
  }

  $: stepNo = ORDER.indexOf(step) + 1;

  // ── Petra vodi ── ob vsakem koraku prebere vprašanje in možnosti, ki so na
  // zaslonu (starejši ne vidijo dobro ali ne vedo, kaj pritisniti). Besedilo se
  // sestavi iz trenutnih izbir, ne iz $: vrednosti — te se osvežijo šele po koraku.
  const GUIDE = {};   // lastnik branja (speakingOwner)
  function list(items: string[]): string {
    return items.length > 1 ? `${items.slice(0, -1).join(', ')} ${tr('in')} ${items[items.length - 1]}` : items[0] ?? '';
  }
  function guideText(s: Step): string {
    const out: string[] = [];
    if (s === 'stop') {
      out.push(tr('S katerega postajališča se pelješ?'), tr('Izberi svoje postajališče ali poišči drugo po imenu.'));
      // Para čez cesto imata isto ime: Petra ga pove enkrat.
      const names = [...new Set([...saved, ...near].map(x => x.name))].slice(0, 4);
      if (names.length) out.push(tr('Na seznamu so: {list}.', { list: list(names) }));
    } else if (s === 'line' && stop && gtfs) {
      const ls = linesAtStop(gtfs, stop.id);
      out.push(tr('Kateri avtobus?'));
      out.push(ls.length
        ? tr('S postajališča {stop} vozijo: {list}.', { stop: stop.name, list: list(ls.slice(0, 8).map(l => tr('{line} smer {dest}', { line: l.routeShort, dest: l.dest }))) })
        : tr('S tega postajališča ne vozi noben avtobus. Pritisni Nazaj in izberi drugo postajališče.'));
    } else if (s === 'days') {
      out.push(tr('Katere dneve?'), tr('Izberi Vsak delavnik, Vsak dan ali Sobota in nedelja. Lahko izbereš tudi posamezne dneve in pritisneš Naprej.'));
    } else if (s === 'time' && line) {
      const ti = timeInfo(gtfs, stop, line, days);
      out.push(tr('Ob kateri uri odpelje tvoj avtobus?'), tr('Avtobus {line}, smer {dest}.', { line: line.routeShort, dest: line.dest }));
      if (ti.times.length) {
        if (ti.missing) out.push(tr('Za nekatere izbrane dni vozni red še ni objavljen. Prikazane ure so iz ostalih dni.'));
        if (ti.differ) out.push(tr('Ob izbranih dnevih vozi ob različnih urah. Prikazane so ure, ob katerih vozi vse izbrane dneve. Za druge ure naredi še en opomnik.'));
        out.push(tr('Prvi odpelje ob {first}, zadnji ob {last}. Izberi uro.', { first: fmtClock(ti.times[0]), last: fmtClock(ti.times[ti.times.length - 1]) }));
      } else {
        out.push(noTimesText(ti));
      }
    } else if (s === 'lead') {
      out.push(tr('Koliko prej naj te opomnim?'), tr('Izberi, koliko minut pred odhodom ti telefon pošlje obvestilo: 5, 10, 15, 20 ali 30 minut.'));
    } else if (s === 'summary') {
      out.push(tr('Preveri opomnik.'), summaryOf(stop, line, depSec, days, lead), tr('Če je vse prav, pritisni Shrani opomnik.'));
    } else if (s === 'done') {
      const ps = get(pushState);
      out.push(tr('Opomnik je shranjen.'));
      out.push(ps.subscribed && !ps.error
        ? tr('Telefon ti bo poslal obvestilo {n} minut pred odhodom.', { n: lead })
        : ps.error ?? tr('Obvestila še niso vklopljena, zato opomnik ne bo zazvonil.'));
      out.push(tr('Pritisni Končano.'));
    }
    return out.filter(Boolean).join(' ');
  }
  function guide(s: Step) {
    if (get(petraGuide)) speak(guideText(s), GUIDE);
  }
  function toggleGuide() {
    petraGuide.update(v => !v);
    // Vklop: Petra takoj prebere trenutni korak (ta dotik odklene zvok).
    if (get(petraGuide)) guide(step);
    else if (get(speakingOwner) === GUIDE) stopSpeaking();
  }
  onMount(() => {
    // Fokus na vprašanje kot ob vsakem koraku (focusTrap ga sicer da gumbu Nazaj).
    dlg?.querySelector<HTMLElement>('h1')?.focus();
    guide(step);
  });
</script>

<svelte:window on:keydown={(e) => { if (e.key === 'Escape' && !saving) onClose(); }} />

<div in:page out:page={{ out: true }} class="fixed inset-0 z-[60] flex flex-col surface"
     style="padding-top: env(safe-area-inset-top);"
     role="dialog" aria-modal="true" aria-label={$t('Nov opomnik')} tabindex="-1" use:focusTrap bind:this={dlg}>
  <!-- Na ozkem zaslonu z večjim besedilom gre "Petra vodi" v svojo vrstico. -->
  <div class="px-4 pt-3 pb-2 max-w-screen-sm mx-auto w-full flex flex-wrap items-center justify-between gap-3">
    <button type="button" class="pressable mm-aw-back" disabled={saving} on:click={goBack}>
      <ArrowLeft size={26} strokeWidth={2.25} /> {$t('Nazaj')}
    </button>
    {#if $canSpeak}
      <button type="button" class="pressable mm-aw-guide" class:mm-aw-on={$petraGuide}
              role="switch" aria-checked={$petraGuide} on:click={toggleGuide}>
        <Volume2 size={24} strokeWidth={2.25} class="shrink-0" />
        <span class="text-left leading-tight">
          <span class="block">{$t('Petra vodi')}</span>
          <!-- Stanje pove aria-checked; v imenu bi se ime stikala menjalo. -->
          <span class="block mm-aw-guide-state" aria-hidden="true">{$petraGuide ? $t('Vklopljeno') : $t('Izklopljeno')}</span>
        </span>
      </button>
    {/if}
  </div>

  <div class="flex-1 overflow-y-auto scrollbox">
    <div class="px-4 max-w-screen-sm mx-auto space-y-4" style="padding-bottom: calc(env(safe-area-inset-bottom) + 2rem);">
      {#if step !== 'done'}
        <div class="t-callout text-muted pt-1">{$t('Korak {n} od {vseh}', { n: stepNo, vseh: ORDER.length })}</div>
      {/if}

      {#if step === 'stop'}
        <h1 class="t-title1" tabindex="-1">{$t('S katerega postajališča se pelješ?')}</h1>
        <p class="t-body text-muted">{$t('Izberi svoje postajališče ali poišči drugo po imenu.')}</p>
        {#each saved as s (s.id)}
          <button type="button" class="pressable mm-aw-row w-full" on:click={() => pickStop(s)}>
            <Star size={28} strokeWidth={2} fill="var(--status-delay)" color="var(--status-delay)" />
            <span class="flex-1 min-w-0 text-left">
              <span class="block t-headline">{s.name}</span>
              {#if gtfs}<span class="block t-footnote text-muted">{stopHint(gtfs, s.id)}</span>{/if}
            </span>
          </button>
        {/each}
        {#each near as s (s.id)}
          <button type="button" class="pressable mm-aw-row w-full" on:click={() => pickStop(s)}>
            <MapPin size={28} strokeWidth={2} color="var(--accent)" />
            <span class="flex-1 min-w-0 text-left">
              <span class="block t-headline">{s.name}</span>
              <span class="block t-footnote text-muted">{$t('{m} m stran', { m: Math.round(s.d / 10) * 10 })}{#if gtfs}&nbsp;· {stopHint(gtfs, s.id)}{/if}</span>
            </span>
          </button>
        {/each}
        <input bind:value={query} class="mm-aw-input w-full"
               placeholder={$t('Poišči drugo postajališče')} aria-label={$t('Poišči drugo postajališče')}
               autocomplete="off" enterkeyhint="search" />
        {#if query.trim().length >= 2 && found.length === 0}
          <p class="t-body text-muted">{$t('Ni zadetkov.')}</p>
        {/if}
        {#each found as s (s.id)}
          <button type="button" class="pressable mm-aw-row w-full" on:click={() => pickStop(s)}>
            <MapPin size={28} strokeWidth={2} color="var(--accent)" />
            <span class="flex-1 min-w-0 text-left">
              <span class="block t-headline">{s.name}</span>
              {#if gtfs}<span class="block t-footnote text-muted">{stopHint(gtfs, s.id)}</span>{/if}
            </span>
          </button>
        {/each}

      {:else if step === 'line' && stop}
        <h1 class="t-title1" tabindex="-1">{$t('Kateri avtobus?')}</h1>
        <p class="t-body text-muted">{$t('Linija in smer s postajališča {stop}.', { stop: stop.name })}</p>
        {#each lines as l (l.routeId + ':' + l.dir)}
          <button type="button" class="pressable mm-aw-row w-full" on:click={() => pickLine(l)}>
            <LineBadge short={l.routeShort} routeId={l.routeId} size="lg" />
            <span class="flex-1 min-w-0 text-left t-headline">→ {l.dest}</span>
          </button>
        {:else}
          <p class="t-body">{$t('S tega postajališča ne vozi noben avtobus.')}</p>
        {/each}

      {:else if step === 'days'}
        <h1 class="t-title1" tabindex="-1">{$t('Katere dneve?')}</h1>
        <p class="t-body text-muted">{$t('Izberi enega od predlogov ali posamezne dneve in pritisni Naprej.')}</p>
        <button type="button" class="pressable mm-aw-row w-full" on:click={() => preset('work')}>
          <span class="flex-1 text-left t-headline">{$t('Vsak delavnik')}</span>
          <span class="t-footnote text-muted">{$t('pon–pet')}</span>
        </button>
        <button type="button" class="pressable mm-aw-row w-full" on:click={() => preset('all')}>
          <span class="flex-1 text-left t-headline">{$t('Vsak dan')}</span>
        </button>
        <button type="button" class="pressable mm-aw-row w-full" on:click={() => preset('weekend')}>
          <span class="flex-1 text-left t-headline">{$t('Sobota in nedelja')}</span>
        </button>
        <div class="t-callout text-muted pt-2">{$t('Ali izberi dneve sam:')}</div>
        <!-- Dva stolpca šele od 420 px: pri povečanem besedilu "Ponedeljek" s kljukico ne gre v pol zaslona. -->
        <div class="grid grid-cols-1 min-[420px]:grid-cols-2 gap-2">
          {#each DAY_NAMES as d, i}
            <button type="button" class="pressable mm-aw-day" class:mm-aw-on={days[i]}
                    aria-pressed={days[i]} on:click={() => toggleDay(i)}>
              {#if days[i]}<Check size={22} strokeWidth={2.5} />{/if} {$t(d)}
            </button>
          {/each}
        </div>
        <button type="button" class="pressable mm-aw-next w-full" disabled={!days.some(Boolean)} on:click={() => go('time')}>
          {$t('Naprej')}
        </button>

      {:else if step === 'time' && line}
        <h1 class="t-title1" tabindex="-1">{$t('Ob kateri uri odpelje tvoj avtobus?')}</h1>
        <p class="t-body text-muted">{$t('Avtobus {line}, smer {dest}.', { line: line.routeShort, dest: line.dest })}</p>
        {#if missing && times.length}
          <p class="t-body">{$t('Za nekatere izbrane dni vozni red še ni objavljen. Prikazane ure so iz ostalih dni.')}</p>
        {/if}
        {#if differ && times.length}
          <p class="t-body">{$t('Ob izbranih dnevih vozi ob različnih urah. Prikazane so ure, ob katerih vozi vse izbrane dneve. Za druge ure naredi še en opomnik.')}</p>
        {/if}
        {#if times.length === 0}
          <p class="t-body">{noTimesText({ differ, none })}</p>
        {/if}
        {#each PARTS as [naziv, od, do_]}
          {@const part = times.filter(s => s / 3600 >= od && s / 3600 < do_)}
          {#if part.length}
            <h2 class="t-headline pt-2">{$t(naziv)}</h2>
            <div class="grid grid-cols-3 gap-2">
              {#each part as s}
                <button type="button" class="pressable mm-aw-time" on:click={() => pickTime(s)}>{fmtClock(s)}</button>
              {/each}
            </div>
          {/if}
        {/each}

      {:else if step === 'lead'}
        <h1 class="t-title1" tabindex="-1">{$t('Koliko prej naj te opomnim?')}</h1>
        <p class="t-body text-muted">{$t('Toliko minut pred odhodom avtobusa ti telefon pošlje obvestilo.')}</p>
        {#each LEADS as n}
          <button type="button" class="pressable mm-aw-row w-full" class:mm-aw-on={lead === n} aria-pressed={lead === n} on:click={() => pickLead(n)}>
            <span class="flex-1 text-left t-headline">{$t('{n} minut prej', { n })}</span>
          </button>
        {/each}

      {:else if step === 'summary'}
        <h1 class="t-title1" tabindex="-1">{$t('Preveri opomnik')}</h1>
        <div class="surface-2 rounded-2xl p-5 t-title3 font-semibold leading-snug">{summary}</div>
        <ReadAloud variant="big" wide text={() => summary} />
        <button type="button" class="pressable mm-aw-next w-full" disabled={saving} on:click={save}>
          <BellRing size={26} /> {saving ? $t('Shranjujem…') : $t('Shrani opomnik')}
        </button>

      {:else if step === 'done'}
        <h1 class="t-title1" tabindex="-1">{$t('Opomnik je shranjen')}</h1>
        <!-- Naročnina brez napake: tudi sinhronizacija s strežnikom je uspela. -->
        {#if $pushState.subscribed && !$pushState.error}
          <div class="surface-2 rounded-2xl p-5 t-body flex items-start gap-3">
            <BellRing size={26} color="var(--status-ontime)" />
            <span>{$t('Telefon ti bo poslal obvestilo {n} minut pred odhodom.', { n: lead })}</span>
          </div>
        {:else}
          <div class="surface-2 rounded-2xl p-5 t-body flex items-start gap-3" style="color: var(--status-delay)">
            <TriangleAlert size={26} class="shrink-0" />
            <span>{$pushState.error ?? $t('Obvestila še niso vklopljena, zato opomnik ne bo zazvonil.')}</span>
          </div>
        {/if}
        <button type="button" class="pressable mm-aw-next w-full" on:click={onClose}>{$t('Končano')}</button>
      {/if}
    </div>
  </div>
</div>

<style>
  /* Kot preprost pogled: glavne tarče 88 px, ostale ≥ 64 px, vse z napisom. Predpona mm-aw-. */
  .mm-aw-back {
    display: inline-flex; align-items: center; gap: 10px;
    min-height: 64px; padding: 0 20px 0 14px; border-radius: 18px;
    background: var(--surface-2); border: 2px solid var(--border); color: var(--text);
    font-weight: 600; font-size: calc(16px * var(--ui-scale)); touch-action: manipulation;
  }
  .mm-aw-guide {
    display: inline-flex; align-items: center; gap: 10px;
    min-height: 64px; padding: 6px 16px 6px 12px; border-radius: 18px;
    background: var(--surface-2); border: 2px solid var(--border); color: var(--text);
    font-weight: 700; font-size: calc(16px * var(--ui-scale)); touch-action: manipulation;
  }
  .mm-aw-guide-state { font-weight: 500; font-size: calc(13px * var(--ui-scale)); color: var(--text-muted); }
  .mm-aw-guide.mm-aw-on .mm-aw-guide-state { color: var(--accent); font-weight: 700; }
  .mm-aw-row {
    display: flex; align-items: center; gap: 16px;
    min-height: 88px; padding: 14px 18px; border-radius: 20px;
    background: var(--surface); border: 2px solid var(--border); color: var(--text);
    touch-action: manipulation;
  }
  .mm-aw-day, .mm-aw-time {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    min-height: 64px; border-radius: 18px;
    background: var(--surface); border: 2px solid var(--border); color: var(--text);
    font-weight: 600; font-size: calc(17px * var(--ui-scale)); touch-action: manipulation;
  }
  .mm-aw-time { font-variant-numeric: tabular-nums; font-size: calc(20px * var(--ui-scale)); }
  .mm-aw-on { border-color: var(--accent); background: color-mix(in oklab, var(--accent) 12%, var(--surface)); }
  .mm-aw-next {
    display: inline-flex; align-items: center; justify-content: center; gap: 10px;
    min-height: 88px; border-radius: 20px;
    background: var(--accent); color: #ffffff; border: 0;
    font-weight: 700; font-size: calc(19px * var(--ui-scale)); touch-action: manipulation;
  }
  .mm-aw-next:disabled { opacity: 0.45; }
  .mm-aw-input {
    min-height: 64px; padding: 0 18px; border-radius: 18px;
    background: var(--surface-2); border: 2px solid var(--border); color: var(--text);
    font-size: calc(18px * var(--ui-scale));
  }
  .mm-aw-input:focus { outline: none; border-color: var(--accent); }
</style>
