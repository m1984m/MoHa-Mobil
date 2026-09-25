<script lang="ts">
  import { onMount, onDestroy, tick as flush } from 'svelte';
  import {
    Home, MapPin, Search, Map as MapIcon, LayoutGrid, Pencil, Trash2, Plus, ChevronRight, Star,
  } from 'lucide-svelte';
  import { nearestStops, type GTFS, type Stop } from '../gtfs';
  import { fetchArrivalsForStopPoint, type StopArrival } from '../realtime';
  import { favStops } from '../favorites';
  import { nearbyRadiusM } from '../settings';
  import { simpleHome, simpleOthers, simplePlaces, MAX_PLACES, type SimplePlace } from '../simple';
  import {
    liveDepartureRows, scheduleDepartureRows, routeIdIndex, LIVE_FRESH_MS, type DepartureRow,
  } from '../departures';
  import { departuresSpeech } from '../readAloud';
  import { pushBack, type BackRelease } from '../backstack';
  import { fmtClock } from '../time';
  import { t, tr } from '../i18n';
  import StopBoard from '../ui/StopBoard.svelte';
  import LiveDot from '../ui/LiveDot.svelte';
  import Skeleton from '../ui/Skeleton.svelte';
  import ConfirmDialog from '../ui/ConfirmDialog.svelte';
  import ReadAloud from '../ui/ReadAloud.svelte';
  import SimpleStopSearch from './SimpleStopSearch.svelte';
  import { stopHint } from '../simpleStops';
  import { toast } from '../toast';

  // Preprost pogled — en zaslon, največ šest dejanj, najpomembnejše na sredini.
  //
  // Vrstni red sledi raziskavam sledenja pogledu: starejši najdlje gledajo sredino
  // zaslona in jih najbolj izrazit element pritegne prvi, zato so odhodi na vrhu
  // in so največji; gumb Domov (poudarjena barva) pride šele pod njimi. Robov in
  // skritih menijev ni, vsak gumb ima napis, nobena funkcija ne zahteva kretnje.
  export let gtfs: GTFS | null;
  export let origin: { lat: number; lon: number };
  export let hasGeo: boolean;
  export let onOpenStop: (s: Stop) => void;
  export let onRoute: (p: SimplePlace) => void;
  export let onEditPlace: (kind: 'home' | 'place', place: SimplePlace | null) => void;
  export let onOpenPlanner: () => void;
  export let onOpenMap: () => void;
  export let onFullApp: () => void;
  export let onRequestLocation: () => Promise<void>;

  const MAX_BOARDS = 2;
  // Pri dveh postajališčih en (naslednji) odhod na kartico, sicer dva: z dvema
  // vrsticama po 88 px bi kartici zapolnili cel zaslon in Domov bi padel pod rob.
  // Vse odhode pokaže dotik na kartico.
  const rowsPerBoard = (n: number) => (n > 1 ? 1 : 2);

  let tick = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let liveByStop: Record<number, StopArrival[]> = {};
  let liveAt: Record<number, number> = {};
  let lastKey = '';
  let lastLiveAt = 0;
  let locating = false;
  let denied = false;
  let editing = false;
  let removing: SimplePlace | null = null;
  let stopSearchOpen = false;

  // Potrditveno okno za brisanje: sistemski nazaj ga zapre (ne zapre aplikacije).
  let backRemoving: BackRelease | null = null;
  $: if (removing && !backRemoving) {
    backRemoving = pushBack(() => removing = null);
  } else if (!removing && backRemoving) {
    const r = backRemoving; backRemoving = null; r();
  }

  // Iskanje postajališča: sistemski nazaj ga zapre.
  let backSearch: BackRelease | null = null;
  $: if (stopSearchOpen && !backSearch) {
    backSearch = pushBack(() => stopSearchOpen = false);
  } else if (!stopSearchOpen && backSearch) {
    const r = backSearch; backSearch = null; r();
  }

  // Moja postajališča: vsa shranjena, v vrstnem redu shranjevanja (novo je zadnje,
  // tik nad "Dodaj postajališče"). "Moji avtobusi" zgoraj kažejo samo tista v
  // bližini — brez tega seznama se je shranjeno oddaljeno postajališče zdelo izgubljeno.
  $: stopById = gtfs ? new Map(gtfs.stops.map(s => [s.id, s])) : new Map<number, Stop>();
  $: savedStops = [...$favStops].map(id => stopById.get(id)).filter((s): s is Stop => !!s);

  async function pickSearched(s: Stop) {
    if (!$favStops.has(s.id)) {
      favStops.toggle(s.id);
      toast.show(tr('Shranjeno med moje'));
    }
    // Najprej zapri iskanje (sprosti njegov vnos v zgodovini), šele nato odpri
    // postajališče. Obratno bi App potisnil nov vnos pred sprostitvijo, iskanje ne
    // bi bilo več na vrhu sklada in njegov vnos bi ostal — en pritisk nazaj bi
    // potem ne naredil ničesar.
    stopSearchOpen = false;
    await flush();
    onOpenStop(s);
  }

  onMount(() => { timer = setInterval(() => { tick++; refreshLive(); }, 30_000); });
  onDestroy(() => { if (timer) clearInterval(timer); backRemoving?.(); backSearch?.(); });

  // Katera postajališča: če je med shranjenimi kakšno v bližini, ta (doma vidiš
  // svoje postajališče); sicer dve najbližji (običajno obe strani ceste); brez
  // lokacije shranjena.
  function pickStops(g: GTFS | null, geo: boolean, o: { lat: number; lon: number }, favs: Set<number>, radius: number): (Stop & { d?: number })[] {
    if (!g) return [];
    const fav = g.stops.filter(s => favs.has(s.id));
    if (!geo) return fav.slice(0, MAX_BOARDS);
    const near = nearestStops(g.stops, o, 12).filter(s => s.d <= Math.max(radius, 500));
    const nearFav = near.filter(s => favs.has(s.id));
    return (nearFav.length ? nearFav : near).slice(0, MAX_BOARDS);
  }
  $: stops = pickStops(gtfs, hasGeo, origin, $favStops, $nearbyRadiusM);

  $: stopKey = stops.map(s => s.id).join(',');
  $: if (gtfs && stopKey && stopKey !== lastKey) { lastKey = stopKey; refreshLive(); }

  async function refreshLive() {
    if (!gtfs || document.hidden) return;
    const ids = stops.map(s => s.id);
    if (!ids.length) return;
    const res = await Promise.allSettled(ids.map(async id => [id, await fetchArrivalsForStopPoint(id)] as const));
    const next = { ...liveByStop };
    for (const r of res) {
      if (r.status === 'fulfilled') { next[r.value[0]] = r.value[1]; liveAt[r.value[0]] = Date.now(); lastLiveAt = Date.now(); }
    }
    liveByStop = next;
  }

  $: routeIds = routeIdIndex(gtfs);
  $: stopNames = gtfs ? new Map(gtfs.stops.map(s => [s.id, s.name])) : new Map<number, string>();

  function rowsFor(stopId: number, max: number, _live: typeof liveByStop, _tick: number): DepartureRow[] {
    const live = liveByStop[stopId];
    if (live && live.length && Date.now() - (liveAt[stopId] ?? 0) < LIVE_FRESH_MS) {
      return liveDepartureRows(live, routeIds, max);
    }
    return gtfs ? scheduleDepartureRows(gtfs, stopId, max, stopNames) : [];
  }

  // Dve postajališči z istim imenom sta par čez cesto — smer ju loči.
  $: boards = stops.map(s => {
    const rows = rowsFor(s.id, rowsPerBoard(stops.length), liveByStop, tick);
    const twin = stops.filter(x => x.name === s.name).length > 1;
    return { stop: s, rows, hint: twin ? (rows[0]?.headsign ?? '') : '' };
  });
  $: anyLive = boards.some(b => (liveByStop[b.stop.id]?.length ?? 0) > 0 && Date.now() - (liveAt[b.stop.id] ?? 0) < LIVE_FRESH_MS);

  function clockOf(ms: number): string {
    const d = new Date(ms);
    return fmtClock(d.getHours() * 3600 + d.getMinutes() * 60);
  }

  async function locate() {
    locating = true;
    try { await onRequestLocation(); } finally { locating = false; }
    // Po zavrnitvi brskalnik ne vpraša znova — povej, kje se vklopi.
    denied = !hasGeo;
  }

  $: canAdd = $simpleOthers.length < MAX_PLACES;
  // Urejanje nima smisla, ko ni česa urejati.
  $: if (editing && !$simpleHome && $simpleOthers.length === 0) editing = false;
</script>

<section class="absolute inset-0 flex flex-col surface" style="padding-top: env(safe-area-inset-top);">
  <div class="flex-1 overflow-y-auto scrollbox">
    <div class="px-4 pt-3 max-w-screen-sm mx-auto space-y-6"
         style="padding-bottom: calc(env(safe-area-inset-bottom) + 2rem);">

      <!-- 1. Moji avtobusi -->
      <section aria-labelledby="mm-s-buses" class="space-y-3">
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <h1 id="mm-s-buses" class="t-title1">{$t('Moji avtobusi')}</h1>
          {#if boards.length}
            <ReadAloud variant="big" text={() => departuresSpeech(boards.map(b => ({ name: b.stop.name, rows: b.rows })))} />
          {/if}
        </div>

        {#if !gtfs}
          {#each Array(MAX_BOARDS) as _}
            <div class="surface rounded-2xl border border-base p-4 space-y-3">
              <Skeleton height="28px" width="60%" />
              <Skeleton height="64px" />
            </div>
          {/each}
        {:else if boards.length === 0}
          <div class="surface-2 rounded-2xl p-5 space-y-4">
            {#if !hasGeo}
              <p class="t-body">{$t('Dovoli lokacijo, da vidiš odhode s postajališča, kjer si.')}</p>
              <button type="button" class="pressable mm-s-row mm-s-accent w-full" disabled={locating} on:click={locate}>
                <MapPin size={30} strokeWidth={2} />
                <span class="flex-1 text-left">{locating ? $t('Čakam na dovoljenje…') : $t('Dovoli lokacijo')}</span>
              </button>
              {#if denied}
                <p class="t-callout" style="color: var(--status-delay)">{$t('Lokacija je zavrnjena. Vklopi jo v nastavitvah telefona ali brskalnika za to stran in poskusi znova.')}</p>
              {/if}
            {:else}
              <p class="t-body">{$t('V bližini ni postajališča. Odpri karto ali izberi cilj spodaj.')}</p>
            {/if}
          </div>
        {:else}
          {#each boards as b (b.stop.id)}
            <StopBoard {gtfs} stop={b.stop} rows={b.rows} directionHint={b.hint}
                       distanceM={b.stop.d ?? null} starred={$favStops.has(b.stop.id)}
                       onSelect={onOpenStop} />
          {/each}
          <div class="flex items-center gap-2 t-footnote text-muted" aria-live="polite">
            <LiveDot live={anyLive} label={anyLive ? $t('V živo') : $t('Po voznem redu')} />
            {#if anyLive && lastLiveAt}
              <span>· {$t('posodobljeno ob {time}', { time: clockOf(lastLiveAt) })}</span>
            {/if}
          </div>
        {/if}
      </section>

      <!-- 2. Domov -->
      <section aria-label={$t('Domov')}>
        {#if $simpleHome}
          {#if editing}
            <div class="mm-s-edit">
              <Home size={28} strokeWidth={2} />
              <div class="flex-1 min-w-0">
                <div class="t-headline">{$t('Domov')}</div>
                <div class="t-footnote text-muted truncate">{$simpleHome.name}</div>
              </div>
              <button type="button" class="pressable mm-s-small" on:click={() => onEditPlace('home', $simpleHome)}>
                <Pencil size={20} /> {$t('Spremeni')}
              </button>
            </div>
          {:else}
            <button type="button" class="pressable mm-s-row mm-s-accent w-full" on:click={() => $simpleHome && onRoute($simpleHome)}>
              <Home size={34} strokeWidth={2} />
              <span class="flex-1 min-w-0 text-left">
                <span class="block t-title2">{$t('Domov')}</span>
                <span class="block t-footnote truncate" style="opacity: 0.9">{$simpleHome.name}</span>
              </span>
              <ChevronRight size={28} />
            </button>
          {/if}
        {:else}
          <button type="button" class="pressable mm-s-row mm-s-plain w-full" on:click={() => onEditPlace('home', null)}>
            <Home size={30} strokeWidth={2} color="var(--accent)" />
            <span class="flex-1 min-w-0 text-left">
              <span class="block t-headline">{$t('Nastavi dom')}</span>
              <span class="block t-footnote text-muted">{$t('Potem te en dotik pripelje domov')}</span>
            </span>
            <Plus size={28} color="var(--accent)" />
          </button>
        {/if}
      </section>

      <!-- 3. Moja postajališča -->
      <section aria-labelledby="mm-s-stops" class="space-y-3">
        <h2 id="mm-s-stops" class="t-title3">{$t('Moja postajališča')}</h2>
        {#each savedStops as s (s.id)}
          <button type="button" class="pressable mm-s-row mm-s-plain w-full" on:click={() => onOpenStop(s)}>
            <Star size={30} strokeWidth={2} fill="var(--status-delay)" color="var(--status-delay)" />
            <span class="flex-1 min-w-0 text-left">
              <span class="block t-headline">{s.name}</span>
              {#if gtfs}
                {@const hint = stopHint(gtfs, s.id)}
                {#if hint}<span class="block t-footnote text-muted truncate">{hint}</span>{/if}
              {/if}
            </span>
            <ChevronRight size={28} color="var(--text-muted)" />
          </button>
        {/each}
        <button type="button" class="pressable mm-s-row mm-s-dashed w-full" on:click={() => stopSearchOpen = true}>
          <Plus size={30} strokeWidth={2} color="var(--accent)" />
          <span class="flex-1 text-left t-headline">{$t('Dodaj postajališče')}</span>
        </button>
      </section>

      <!-- 4. Moji kraji -->
      <section aria-labelledby="mm-s-places" class="space-y-3">
        <div class="flex items-center justify-between gap-3">
          <h2 id="mm-s-places" class="t-title3">{$t('Moji kraji')}</h2>
          {#if $simpleHome || $simpleOthers.length}
            <button type="button" class="pressable mm-s-small" on:click={() => editing = !editing}>
              {#if editing}{$t('Končano')}{:else}<Pencil size={20} /> {$t('Uredi')}{/if}
            </button>
          {/if}
        </div>

        {#each $simpleOthers as p (p.id)}
          {#if editing}
            <div class="mm-s-edit">
              <MapPin size={28} strokeWidth={2} />
              <div class="flex-1 min-w-0">
                <div class="t-headline truncate">{p.label}</div>
                <div class="t-footnote text-muted truncate">{p.name}</div>
              </div>
              <div class="flex flex-col gap-2 shrink-0">
                <button type="button" class="pressable mm-s-small" on:click={() => onEditPlace('place', p)}>
                  <Pencil size={20} /> {$t('Spremeni')}
                </button>
                <button type="button" class="pressable mm-s-small mm-s-danger" on:click={() => removing = p}>
                  <Trash2 size={20} /> {$t('Odstrani')}
                </button>
              </div>
            </div>
          {:else}
            <button type="button" class="pressable mm-s-row mm-s-plain w-full" on:click={() => onRoute(p)}>
              <MapPin size={30} strokeWidth={2} color="var(--accent)" />
              <span class="flex-1 min-w-0 text-left">
                <span class="block t-headline truncate">{p.label}</span>
                <span class="block t-footnote text-muted truncate">{p.name}</span>
              </span>
              <ChevronRight size={28} color="var(--text-muted)" />
            </button>
          {/if}
        {/each}

        {#if canAdd}
          <button type="button" class="pressable mm-s-row mm-s-dashed w-full" on:click={() => onEditPlace('place', null)}>
            <Plus size={30} strokeWidth={2} color="var(--accent)" />
            <span class="flex-1 text-left t-headline">{$t('Dodaj kraj')}</span>
          </button>
        {/if}
      </section>

      <!-- 5–7. Drug cilj, Karta, Celotna aplikacija -->
      <section class="space-y-3" aria-label={$t('Drugo')}>
        <button type="button" class="pressable mm-s-row mm-s-plain w-full" on:click={onOpenPlanner}>
          <Search size={30} strokeWidth={2} color="var(--accent)" />
          <span class="flex-1 text-left t-headline">{$t('Drug cilj')}</span>
          <ChevronRight size={28} color="var(--text-muted)" />
        </button>
        <button type="button" class="pressable mm-s-row mm-s-plain w-full" on:click={onOpenMap}>
          <MapIcon size={30} strokeWidth={2} color="var(--accent)" />
          <span class="flex-1 text-left t-headline">{$t('Karta z avtobusi')}</span>
          <ChevronRight size={28} color="var(--text-muted)" />
        </button>
        <button type="button" class="pressable mm-s-row mm-s-plain w-full" on:click={onFullApp}>
          <LayoutGrid size={30} strokeWidth={2} color="var(--text-muted)" />
          <span class="flex-1 min-w-0 text-left">
            <span class="block t-headline">{$t('Celotna aplikacija')}</span>
            <span class="block t-footnote text-muted">{$t('Vsi zavihki in nastavitve')}</span>
          </span>
          <ChevronRight size={28} color="var(--text-muted)" />
        </button>
      </section>
    </div>
  </div>
</section>

<SimpleStopSearch {gtfs} open={stopSearchOpen} onClose={() => stopSearchOpen = false} onPick={pickSearched} />

<ConfirmDialog open={!!removing}
  title={removing ? tr('Odstranim kraj »{kraj}«?', { kraj: removing.label }) : ''}
  confirmLabel={tr('Odstrani')} destructive
  onConfirm={() => { if (removing) simplePlaces.remove(removing.id); removing = null; }}
  onCancel={() => removing = null} />

<style>
  /* Glavne tarče ≥ 88 px (14 mm): pri tej velikosti starejši zadenejo več kot
     97 % dotikov (Leitão & Silva 2012). Predpona mm-s-: skupni CSS. */
  .mm-s-row {
    display: flex; align-items: center; gap: 16px;
    min-height: 88px; padding: 14px 18px;
    border-radius: 20px; touch-action: manipulation;
  }
  .mm-s-accent { background: var(--accent); color: #ffffff; }
  .mm-s-accent:disabled { opacity: 0.6; }
  .mm-s-plain { background: var(--surface); border: 2px solid var(--border); color: var(--text); }
  .mm-s-dashed { background: transparent; border: 2px dashed var(--border); color: var(--text); }

  .mm-s-edit {
    display: flex; align-items: center; gap: 14px;
    padding: 14px 16px; border-radius: 20px;
    background: var(--surface-2); border: 2px solid var(--border);
  }

  /* Sekundarni gumbi: ≥ 64 px visoki, vedno z napisom (ikona sama ni razumljiva). */
  .mm-s-small {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    min-height: 64px; padding: 0 18px; border-radius: 16px;
    background: var(--surface-2); border: 2px solid var(--border); color: var(--text);
    font-weight: 600; font-size: calc(15px * var(--ui-scale)); touch-action: manipulation;
  }
  .mm-s-danger { color: var(--status-disrupt); }
</style>
