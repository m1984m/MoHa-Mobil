<script lang="ts">
  import { onMount, onDestroy, type ComponentType } from 'svelte';
  import { MapPinned, CloudOff, ArrowDownToDot, ArrowUpFromDot } from 'lucide-svelte';
  import {
    nearestStops, upcomingDepartures, loadMeta, feedCoversDate,
    buildCenterIndex, stopServesCenter, matchesCenter, tripDestination,
    type GTFS, type Stop, type CenterDir, type CenterIndex,
  } from '../gtfs';
  import type { Weather } from '../weather';
  import Screen from '../ui/Screen.svelte';
  import LiveDot from '../ui/LiveDot.svelte';
  import Skeleton from '../ui/Skeleton.svelte';
  import EmptyState from '../ui/EmptyState.svelte';
  import StopBoard, { type BoardRow } from '../ui/StopBoard.svelte';
  import { favStops } from '../favorites';
  import { homeShowNearby, homeShowFavs, nearbyRadiusM, seniorMode } from '../settings';
  import { fetchArrivalsForStopPoint, type StopArrival } from '../realtime';
  import { fmtMonthYearGenitive } from '../time';
  import { track } from '../analytics';
  import { t, tr } from '../i18n';
  import Hint from '../ui/Hint.svelte';

  export let gtfs: GTFS | null;
  export let origin: { lat: number; lon: number };
  export let hasGeo: boolean;
  export let weather: Weather | null;
  export let onStopSelect: (s: Stop) => void;
  export let onOpenPlanner: () => void;
  export let onRequestLocation: () => Promise<void>;
  export let onOpenWeather: () => void = () => {};

  let tick = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let liveByStop: Record<number, StopArrival[]> = {};
  // Cas zadnjega uspesnega fetcha per postaja — stari zivi prihodi ob izpadu
  // OBA ne smejo vecno prekrivati svezih GTFS podatkov.
  let liveAt: Record<number, number> = {};
  let lastFetchedKey = '';

  // Datum veljavnosti voznih redov iz meta.json (prej hardkodiran string,
  // ki je ob vsaki osvezitvi GTFS zastarel).
  let feedLabel = '';
  $: feedExpired = gtfs ? !feedCoversDate(gtfs) : false;

  onMount(async () => {
    timer = setInterval(() => { tick++; refreshLive(); }, 30_000);
    const m = await loadMeta();
    if (m?.built) {
      const d = new Date(m.built);
      // Rodilnik ("julija"), ne Intl imenovalnik ("julij") — glej lib/time.ts.
      if (!isNaN(d.getTime())) feedLabel = tr('Velja od {mesec}', { mesec: fmtMonthYearGenitive(d) });
    }
  });
  onDestroy(() => { if (timer) clearInterval(timer); });

  // Filter smeri: 'to' = samo odhodi, ki še pridejo v center (Glavni trg ali
  // Avtobusna postaja kot ena od naslednjih postaj), 'from' = tisti, ki so center
  // že pustili za sabo. null = brez filtra.
  let centerFilter: CenterDir | null = null;

  // Indeks se zgradi enkrat na dan (vozni red se čez dan ne spreminja); dayKey
  // ga prek tick-a osveži čez polnoč.
  function dayKeyOf(_tick: number): number {
    const d = new Date();
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }
  function makeCenterIndex(g: GTFS | null, _dayKey: number): CenterIndex | null {
    return g ? buildCenterIndex(g, new Date()) : null;
  }
  $: dayKey = dayKeyOf(tick);
  $: centerIndex = makeCenterIndex(gtfs, dayKey);

  // Kandidati so namenoma širši od prikazanih osmih: ko je filter vklopljen,
  // marsikatero najbližje postajališče odpade in seznam bi se brez rezerve
  // skrčil na dve kartici.
  $: nearCandidates = gtfs
    ? nearestStops(gtfs.stops, origin, 40).filter(s => s.d <= $nearbyRadiusM)
    : [];
  function pickStops<T extends Stop>(list: T[], idx: CenterIndex | null, dir: CenterDir | null, k: number): T[] {
    const ok = dir && idx ? list.filter(s => stopServesCenter(idx.get(s.id), dir)) : list;
    return ok.slice(0, k);
  }
  // V načinu za starejše je na zaslonu manj kartic in manj odhodov na kartico —
  // dolg seznam pri veliki pisavi zahteva le več drsenja, ne da bi kaj povedal.
  $: maxStops = $seniorMode ? 5 : 8;
  $: maxRows = $seniorMode ? 2 : 3;
  $: nearStops = pickStops(nearCandidates, centerIndex, centerFilter, maxStops);
  $: favStopList = pickStops(
    gtfs ? gtfs.stops.filter(s => $favStops.has(s.id)) : [],
    centerIndex, centerFilter, 50,
  );

  // Set stopId-jev, ki so trenutno na zaslonu. Ob spremembi (premik uporabnika, nova
  // priljubljena postaja) sproži svež fetch — poleg rednega 30 s poll-a.
  $: stopIdsKey = Array.from(new Set([...nearStops.map(s => s.id), ...favStopList.map(s => s.id)]))
    .sort((a, b) => a - b).join(',');
  $: if (gtfs && stopIdsKey && stopIdsKey !== lastFetchedKey) {
    lastFetchedKey = stopIdsKey;
    refreshLive();
  }

  // routeId lookup po route_short_name — za pravilno barvo LineBadge iz OBA LineCode.
  $: routeIdByShort = gtfs
    ? new Map(gtfs.routes.map(r => [r.short.toLowerCase(), r.id]))
    : new Map<string, number>();

  async function refreshLive() {
    if (!gtfs) return;
    if (document.hidden) return; // app v ozadju — ne trosi proxy kvote
    const ids = Array.from(new Set([...nearStops.map(s => s.id), ...favStopList.map(s => s.id)]));
    if (ids.length === 0) return;
    const results = await Promise.allSettled(
      ids.map(async id => [id, await fetchArrivalsForStopPoint(id)] as const)
    );
    const next: Record<number, StopArrival[]> = { ...liveByStop };
    for (const r of results) {
      if (r.status === 'fulfilled') {
        next[r.value[0]] = r.value[1];
        liveAt[r.value[0]] = Date.now();
      }
    }
    liveByStop = next;
  }

  // Imena postaj za "cilj" v načinu za starejše — zadnja postaja vožnje je
  // zanesljivejši cilj kot razrez opisa linije.
  $: stopNames = gtfs ? new Map(gtfs.stops.map(s => [s.id, s.name])) : new Map<number, string>();

  // Ob vklopljenem filtru se odhodi najprej presejejo in šele nato odreže prve
  // tri — sicer bi bila kartica prazna vedno, ko prvi trije odhodi peljejo v
  // napačno smer.
  function liveRows(stopId: number, arr: StopArrival[]): BoardRow[] {
    const e = centerIndex?.get(stopId);
    const out: BoardRow[] = [];
    for (const a of arr) {
      // lineFallback: živ prihod nosi opis smeri iz OBA, ki se z opisom iz
      // voznega reda ne ujame vedno (glej matchesCenter).
      if (centerFilter && !matchesCenter(e, centerFilter, a.lineCode, a.headsign, { lineFallback: true })) continue;
      const [hh, mm] = (a.arrivalTime || '0:0').split(':').map(Number);
      out.push({
        routeId: routeIdByShort.get(a.lineCode.toLowerCase()) ?? a.lineId,
        routeShort: a.lineCode,
        headsign: a.headsign,
        minutesFromNow: a.etaMin,
        depSec: (hh || 0) * 3600 + (mm || 0) * 60,
        delayMin: a.delayMin,
        delayKnown: a.delayKnown,
      });
      if (out.length === maxRows) break;
    }
    return out;
  }

  function gtfsRows(stopId: number): BoardRow[] {
    if (!gtfs) return [];
    const e = centerIndex?.get(stopId);
    const out: BoardRow[] = [];
    for (const d of upcomingDepartures(gtfs, stopId, new Date(), centerFilter ? 24 : maxRows)) {
      if (centerFilter && !matchesCenter(e, centerFilter, d.route.short, d.trip.headsign)) continue;
      out.push({
        routeId: d.route.id,
        routeShort: d.route.short,
        headsign: d.trip.headsign,
        minutesFromNow: d.minutesFromNow,
        depSec: d.depSec,
        destination: tripDestination(gtfs, d.trip, stopNames),
      });
      if (out.length === maxRows) break;
    }
    return out;
  }

  function rowsFor(stopId: number): BoardRow[] {
    const live = liveByStop[stopId];
    // Zivi podatki veljajo 2 min od zadnjega uspesnega fetcha; starejsi
    // padejo nazaj na GTFS (etaMin iz starega fetcha je ze zlagan).
    const fresh = Date.now() - (liveAt[stopId] ?? 0) < 120_000;
    if (live && live.length > 0 && fresh) {
      const rows = liveRows(stopId, live);
      // OBA vrne le bližnje prihode; če filter med njimi ne najde nič, ima vozni
      // red lahko primeren odhod malo kasneje.
      if (rows.length > 0 || !centerFilter) return rows;
    }
    return gtfsRows(stopId);
  }

  // Ali je za katero od prikazanih postaj na voljo živ podatek — od tega je odvisno,
  // ali pika ob naslovu utripa zeleno ("V živo") ali miruje ("Po voznem redu").
  function anyLive(list: { id: number }[], _live: typeof liveByStop, _tick: number): boolean {
    return list.some(s => (liveByStop[s.id]?.length ?? 0) > 0 && Date.now() - (liveAt[s.id] ?? 0) < 120_000);
  }

  // Eksplicitni parametri namesto comma-operator trika — TS-cisto, odvisnosti jasne.
  function makeBoards<T extends Stop>(
    g: GTFS | null, list: T[], _live: typeof liveByStop, _tick: number,
    _idx: CenterIndex | null, filter: CenterDir | null, _senior: boolean,
  ) {
    if (!g) return [];
    // Postajališči z istim imenom sta par čez cesto — brez namiga o smeri ju
    // uporabnik ne razlikuje (na Domu sta prej dvakrat pisala "UKC - Pobreška").
    const nameCount = new Map<string, number>();
    for (const s of list) nameCount.set(s.name, (nameCount.get(s.name) ?? 0) + 1);
    return list.map(s => {
      const rows = rowsFor(s.id);
      return {
        stop: s as Stop,
        rows,
        directionHint: (nameCount.get(s.name) ?? 0) > 1 ? (rows[0]?.headsign ?? '') : '',
      };
    // Ob vklopljenem filtru kartica brez odhodov ni odgovor na vprašanje
    // "kje ujamem avtobus v center" — raje je ni.
    }).filter(b => !filter || b.rows.length > 0);
  }
  $: boards = makeBoards(gtfs, nearStops, liveByStop, tick, centerIndex, centerFilter, $seniorMode);
  $: favBoards = makeBoards(gtfs, favStopList, liveByStop, tick, centerIndex, centerFilter, $seniorMode);
  $: nearLive = anyLive(nearStops, liveByStop, tick);
  $: favLive = anyLive(favStopList, liveByStop, tick);

  $: CENTER_CHIPS = [
    { id: 'to', label: $t('V center'), icon: ArrowDownToDot },
    { id: 'from', label: $t('Iz centra'), icon: ArrowUpFromDot },
  ] as { id: CenterDir; label: string; icon: ComponentType }[];
  function toggleCenter(dir: CenterDir) {
    centerFilter = centerFilter === dir ? null : dir;
    track({ e: 'filter', d: [centerFilter === 'to' ? 'v-center' : centerFilter === 'from' ? 'iz-centra' : 'izklop'] });
  }
  $: centerSuffix = centerFilter === 'to' ? ' · ' + $t('v center') : centerFilter === 'from' ? ' · ' + $t('iz centra') : '';

  async function refresh() {
    await onRequestLocation();
    tick++;
    refreshLive();
  }
</script>

<Screen title={$t('Dom')} onRefresh={refresh}>
  <div class="px-4 pb-6 space-y-4 max-w-screen-sm mx-auto">
    <!-- Greeting / context strip -->
    <div class="flex items-start justify-between" class:mm-stack={$seniorMode}>
      <div class="min-w-0">
        <div class="t-subhead text-muted">
          {#if hasGeo}{$t('Blizu tebe')}{:else}{$t('Središče Maribora')}{/if}
        </div>
        {#if feedExpired}
          <div class="t-footnote mt-0.5" style="color: var(--status-delay)">{$t('Za danes ni voznega reda — vozni redi so zastareli')}</div>
        {:else if feedLabel}
          <div class="t-footnote text-muted mt-0.5">{feedLabel}</div>
        {/if}
      </div>
      {#if weather}
        <button class="pressable t-subhead flex items-center gap-1.5 rounded-full px-2.5 py-1 -mr-1 surface-2 border border-base shrink-0"
                on:click={onOpenWeather} aria-label={$t('Podrobno vreme')}>
          <span>{weather.emoji}</span>
          <span class="font-semibold">{weather.tempC}°</span>
          <span class="text-muted">{weather.label}</span>
        </button>
      {/if}
    </div>

    <!-- Quick action: plan a route -->
    <button class="pressable w-full rounded-2xl p-4 text-left shadow-card flex items-center gap-3"
            style="background: linear-gradient(135deg, var(--accent), var(--accent-pressed)); color: white;"
            on:click={onOpenPlanner}>
      <div class="w-11 h-11 rounded-xl grid place-items-center" style="background: rgba(255,255,255,0.18)">
        <MapPinned size={22} strokeWidth={2} />
      </div>
      <div class="flex-1 min-w-0">
        <div class="t-headline">{$t('Kam greš?')}</div>
        <div class="t-footnote" style="opacity: 0.85">{$t('Načrtuj pot z avtobusom ali peš')}</div>
      </div>
    </button>

    <!-- Smer: pokaži samo postajališča, s katerih se pelje v center (Glavni trg
         ali Avtobusna postaja kot ena od naslednjih postaj) oziroma iz njega. -->
    <div class="flex gap-2" role="group" aria-label={$t('Smer vožnje')}>
      {#each CENTER_CHIPS as c (c.id)}
        {@const on = centerFilter === c.id}
        <button type="button"
                class="pressable flex-1 rounded-full border flex items-center justify-center gap-2 t-subhead font-semibold"
                style="touch-action: manipulation; min-height: {$seniorMode ? '56px' : '44px'};
                       background: {on ? 'var(--accent)' : 'var(--surface-2)'};
                       color: {on ? '#ffffff' : 'var(--text)'};
                       border-color: {on ? 'var(--accent)' : 'var(--border)'};"
                aria-pressed={on}
                on:click={() => toggleCenter(c.id)}>
          <svelte:component this={c.icon} size={$seniorMode ? 22 : 17} strokeWidth={2}
                            color={on ? '#ffffff' : 'var(--text-muted)'} />
          {c.label}
        </button>
      {/each}
    </div>

    <!-- Nearby boards (toggable v nastavitvah) -->
    {#if $homeShowNearby}
    {#if !gtfs}
      {#each Array(3) as _}
        <div class="surface rounded-2xl border border-base p-4 space-y-3">
          <Skeleton height="20px" width="60%" />
          <Skeleton height="40px" />
          <Skeleton height="40px" />
        </div>
      {/each}
    {:else if !hasGeo}
      <EmptyState icon={MapPinned} title={$t('Dovoli lokacijo')} body={$t('Omogoči dostop do lokacije, da vidiš odhode iz najbližjih postajališč.')}>
        <button class="pressable h-11 px-5 rounded-xl t-subhead font-semibold"
                style="background: var(--accent); color: #ffffff;"
                on:click={refresh}>{$t('Omogoči lokacijo')}</button>
      </EmptyState>
    {:else if boards.length === 0 && centerFilter}
      <EmptyState icon={CloudOff}
                  title={centerFilter === 'to' ? $t('V bližini ni odhodov v center') : $t('V bližini ni odhodov iz centra')}
                  body={$t('Ta smer se s postajališč v tvoji bližini zdaj ne pelje. Poglej vse odhode ali poskusi čez nekaj minut.')}>
        <button class="pressable h-11 px-5 rounded-xl t-subhead font-semibold"
                style="background: var(--accent); color: #ffffff;"
                on:click={() => centerFilter = null}>{$t('Pokaži vse odhode')}</button>
      </EmptyState>
    {:else if boards.length === 0}
      <EmptyState icon={CloudOff} title={$t('Ni postajališč v bližini')} body={$t('Premakni se bližje središču mesta.')} />
    {:else}
      <div class="flex items-center justify-between pt-1" class:mm-stack={$seniorMode}>
        <h2 class="t-footnote text-muted uppercase tracking-wide">{$t('Najbližja postajališča')}{centerSuffix}</h2>
        <LiveDot live={nearLive} label={nearLive ? $t('V živo') : $t('Po voznem redu')} />
      </div>
      <Hint id="home.stop" text={$t('Tapni ime postajališča za vse odhode in lego na karti.')} />

      {#each boards as b (b.stop.id)}
        <StopBoard {gtfs} stop={b.stop} rows={b.rows} directionHint={b.directionHint}
                   distanceM={(b.stop as any).d} onSelect={onStopSelect} />
      {/each}
    {/if}
    {/if}

    {#if $homeShowFavs && favBoards.length > 0}
      <div class="flex items-center justify-between pt-2" class:mm-stack={$seniorMode}>
        <h2 class="t-footnote text-muted uppercase tracking-wide">{$t('Priljubljena postajališča')}{centerSuffix}</h2>
        <LiveDot live={favLive} label={favLive ? $t('V živo') : $t('Po voznem redu')} />
      </div>
      {#each favBoards as b (b.stop.id)}
        <StopBoard {gtfs} stop={b.stop} rows={b.rows} directionHint={b.directionHint}
                   starred onSelect={onStopSelect} />
      {/each}
    {/if}
  </div>
</Screen>

<style>
  /* Pri +50 % besedila se vrstica "naslov levo, oznaka desno" razbije v dva
     ozka stolpca, ki oba lomita besede. V načinu za starejše gre v dve vrstici. */
  .mm-stack {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }
</style>
