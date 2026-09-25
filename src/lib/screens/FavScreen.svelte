<script lang="ts">
  import { backdrop, sheet } from '../motion';
  import { Star, Trash2, Route as RouteIcon, ArrowRight, Plus, X, Pencil, AlarmClock, ChevronRight, AlertTriangle } from 'lucide-svelte';
  import type { GTFS, Stop, Route } from '../gtfs';
  import { upcomingDepartures, nextServiceDeparture } from '../gtfs';
  import Screen from '../ui/Screen.svelte';
  import EmptyState from '../ui/EmptyState.svelte';
  import LineBadge from '../ui/LineBadge.svelte';
  import DepartureTime from '../ui/DepartureTime.svelte';
  import ConfirmDialog from '../ui/ConfirmDialog.svelte';
  import ReadAloud from '../ui/ReadAloud.svelte';
  import { departuresSpeech, gtfsRow, noMoreToday } from '../readAloud';
  import StopTimetableModal from './StopTimetableModal.svelte';
  import { favStops } from '../favorites';
  import { favLines, type FavLine } from '../favLines';
  import { alarms, alarmsCoverageWarning } from '../alarms';
  import { savedRoutes, type SavedRoute } from '../savedRoutes';
  import { compactLists } from '../settings';
  import { pushBack } from '../backstack';
  import { focusTrap } from '../focusTrap';
  import { toast } from '../toast';
  import { t, tr, plural } from '../i18n';
  import { onMount, onDestroy } from 'svelte';

  export let gtfs: GTFS | null;
  export let onStopSelect: (s: Stop) => void;
  export let onRunSavedRoute: (r: SavedRoute) => void = () => {};
  // Alarmi izhajajo iz pripetih linij, zato je vstop tukaj (in v Nastavitvah),
  // ne kot šesti zavihek — TabBar je s petimi na 390 px že zapolnjen.
  export let onOpenAlarms: () => void = () => {};

  $: alarmSummary = $alarms.length === 0
    ? $t('Opozori me, preden mi avtobus uide')
    : $t('{on} od {total} vklopljenih', { on: $alarms.filter(a => a.enabled).length, total: $alarms.length });
  // Opozorilo mora biti vidno že tu — opomnik, ki zaradi izteka voznega reda ne bo
  // zazvonil, se sicer opazi šele zjutraj, ko avtobus uide. Odvisno samo od gtfs in
  // seznama opomnikov, zato se ne preračunava ob vsakem 30-sekundnem tiku.
  $: alarmWarn = gtfs && $alarms.length > 0 ? alarmsCoverageWarning(gtfs, $alarms) : null;

  let tick = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  onMount(() => { timer = setInterval(() => tick++, 30_000); });
  onDestroy(() => { if (timer) clearInterval(timer); });

  $: favList = gtfs ? gtfs.stops.filter(s => $favStops.has(s.id)) : [];
  // Eksplicitni parametri namesto comma-operator trika — TS-cisto, odvisnost od tick jasna.
  function makeBoards(g: GTFS | null, list: Stop[], _tick: number) {
    return g ? list.map(s => ({ stop: s, deps: upcomingDepartures(g, s.id, new Date(), 2) })) : [];
  }
  $: boards = makeBoards(gtfs, favList, tick);

  // Poteg navzdol osveži odštevalnike (prej je bil na voljo samo na Domu, čeprav
  // so odhodi tu enako časovno občutljivi).
  async function refresh() { tick++; }

  let clearConfirmOpen = false;
  function clearAll() {
    const snapshot = [...$favStops];
    favStops.clear();
    clearConfirmOpen = false;
    toast.showUndo(tr('Priljubljene postaje počiščene'), () => {
      for (const id of snapshot) favStops.toggle(id);
    });
  }

  // ── Swipe-to-delete ──
  let offsets = new Map<string, number>();
  let pendingDelete = new Set<string>();
  let dragKey: string | null = null;
  let startX = 0;
  let startY = 0;
  let dragged = false;
  let suppressClick = false;
  const THRESHOLD = 100;

  function startDrag(e: PointerEvent, key: string) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragKey = key;
    startX = e.clientX;
    startY = e.clientY;
    dragged = false;
  }

  function moveDrag(e: PointerEvent, key: string) {
    if (dragKey !== key) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!dragged && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
      dragged = true;
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    }
    if (dragged) {
      e.preventDefault();
      offsets.set(key, dx);
      offsets = offsets;
    }
  }

  function endDrag(e: PointerEvent, key: string, onDelete: () => void) {
    if (dragKey !== key) return;
    dragKey = null;
    if (!dragged) {
      offsets.delete(key);
      offsets = offsets;
      return;
    }
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 350);
    const dx = offsets.get(key) ?? 0;
    if (Math.abs(dx) >= THRESHOLD) {
      pendingDelete.add(key);
      pendingDelete = pendingDelete;
      const dir = dx > 0 ? 1 : -1;
      const vw = (typeof window !== 'undefined' ? window.innerWidth : 500) || 500;
      offsets.set(key, dir * vw);
      offsets = offsets;
      setTimeout(() => {
        onDelete();
        offsets.delete(key);
        pendingDelete.delete(key);
        offsets = offsets;
        pendingDelete = pendingDelete;
      }, 220);
    } else {
      offsets.delete(key);
      offsets = offsets;
    }
  }

  function guardClick(e: MouseEvent) {
    if (suppressClick) {
      e.stopPropagation();
      e.preventDefault();
    }
  }

  function off(key: string): number { return offsets.get(key) ?? 0; }

  // Poteg v stran je bil nepovraten. Obe brisanji zdaj ponudita razveljavitev;
  // pripete linije postaje se ob razveljavitvi vrnejo skupaj s postajo.
  function deleteStop(stop: Stop) {
    const pinned = $favLines.filter(f => f.stopId === stop.id);
    favStops.toggle(stop.id);
    for (const p of pinned) favLines.remove(p.stopId, p.routeId, p.dir);
    toast.showUndo(tr('{name} odstranjena', { name: stop.name }), () => {
      favStops.toggle(stop.id);
      for (const p of pinned) favLines.toggle(p);
    });
  }

  function deleteRoute(r: SavedRoute) {
    savedRoutes.remove(r.id);
    toast.showUndo(tr('Pot odstranjena'), () => savedRoutes.add({ label: r.label, from: r.from, to: r.to }));
  }

  // ── Preimenovanje shranjene poti ──
  // savedRoutes.rename() je obstajal, a ga ni klical noben zaslon — oznaka je
  // ostala samodejna ("Moja lokacija → Dvorana Tabor"), namesto "Dom → Služba".
  let renameId: string | null = null;
  let renameValue = '';
  function openRename(r: SavedRoute) { renameId = r.id; renameValue = r.label; }
  function commitRename() {
    const v = renameValue.trim();
    if (renameId && v) savedRoutes.rename(renameId, v);
    renameId = null;
  }

  // ── Shortcut linija+smer ──
  let pickerStop: Stop | null = null;
  let ttStop: Stop | null = null;
  let ttRouteId: number | null = null;
  let ttDir: number | null = null;
  let ttHeadsign = '';
  let ttOpen = false;

  type LineChoice = { route: Route; dir: number; headsign: string };

  function lineChoicesForStop(g: GTFS, stopId: number): LineChoice[] {
    const seen = new Set<string>();
    const out: LineChoice[] = [];
    const routeById = new Map(g.routes.map(r => [r.id, r]));
    for (const t of g.trips) {
      if (!t.stops.some(st => st[0] === stopId)) continue;
      const k = `${t.route}:${t.dir}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const r = routeById.get(t.route);
      if (!r) continue;
      out.push({ route: r, dir: t.dir, headsign: t.headsign });
    }
    return out.sort((a, b) => a.route.short.localeCompare(b.route.short, 'sl', { numeric: true }) || a.dir - b.dir);
  }

  $: pickerChoices = (gtfs && pickerStop) ? lineChoicesForStop(gtfs, pickerStop.id) : [];

  // Sistemski "nazaj" zapre modal namesto izhoda iz aplikacije.
  let backPicker: (() => void) | null = null;
  $: if (pickerStop && !backPicker) {
    backPicker = pushBack(() => pickerStop = null);
  } else if (!pickerStop && backPicker) {
    const r = backPicker; backPicker = null; r();
  }
  let backTt: (() => void) | null = null;
  $: if (ttOpen && !backTt) {
    backTt = pushBack(() => ttOpen = false);
  } else if (!ttOpen && backTt) {
    const r = backTt; backTt = null; r();
  }
  let backRename: (() => void) | null = null;
  $: if (renameId && !backRename) {
    backRename = pushBack(() => renameId = null);
  } else if (!renameId && backRename) {
    const r = backRename; backRename = null; r();
  }

  function pinLine(stop: Stop, c: LineChoice) {
    favLines.toggle({
      stopId: stop.id,
      routeId: c.route.id,
      dir: c.dir,
      stopName: stop.name,
      routeShort: c.route.short,
      headsign: c.headsign,
    });
  }

  function openTimetableFor(f: FavLine) {
    if (!gtfs) return;
    const s = gtfs.stops.find(x => x.id === f.stopId);
    if (!s) return;
    ttStop = s;
    ttRouteId = f.routeId;
    ttDir = f.dir;
    ttHeadsign = f.headsign;
    ttOpen = true;
  }
</script>

<svelte:window on:keydown={(e) => {
  if (e.key !== 'Escape') return;
  if (renameId) renameId = null;
  else if (pickerStop) pickerStop = null;
}} />

<Screen title={$t('Priljubljene')} onRefresh={refresh}>
  <div class="px-4 max-w-screen-sm mx-auto space-y-3">
    <button class="pressable w-full surface rounded-2xl border shadow-card min-h-[56px] px-4 py-3 flex items-center gap-3 text-left"
            style={alarmWarn ? 'border-color: var(--status-delay)' : ''}
            class:border-base={!alarmWarn}
            on:click={onOpenAlarms}
            aria-label={$t('Odpri opomnike za odhod')}>
      {#if alarmWarn}
        <AlertTriangle size={20} color="var(--status-delay)" />
      {:else}
        <AlarmClock size={20} color="var(--accent)" />
      {/if}
      <div class="flex-1 min-w-0">
        <div class="t-body font-medium">{$t('Opomniki za odhod')}</div>
        {#if alarmWarn}
          <div class="t-footnote" style="color: var(--status-delay)">{alarmWarn.text}</div>
        {:else}
          <div class="t-footnote text-muted truncate">{alarmSummary}</div>
        {/if}
      </div>
      <ChevronRight size={18} color="var(--text-muted)" />
    </button>

    {#if $savedRoutes.length > 0}
      <h2 class="t-footnote text-muted uppercase tracking-wide mt-1">{$t('Shranjene poti')}</h2>
      {#each $savedRoutes as r (r.id)}
        {@const key = `r:${r.id}`}
        {@const dx = off(key)}
        <div class="relative rounded-2xl" style="height: auto;">
          <div class="absolute inset-0 rounded-2xl flex items-center justify-between px-6 pointer-events-none"
               style="background: var(--status-disrupt); color: white; opacity: {Math.abs(dx) > 10 ? 1 : 0}; transition: opacity 120ms;">
            <Trash2 size={22} />
            <Trash2 size={22} />
          </div>
          <!-- role=group: pointer handlerji so swipe-to-delete gesta na kartici -->
          <div class="pressable relative w-full surface rounded-2xl border border-base shadow-card flex items-stretch overflow-hidden"
               role="group"
               style="transform: translateX({dx}px); transition: {dragKey === key ? 'none' : 'transform 0.22s var(--ease-ios)'}; touch-action: pan-y;"
               on:pointerdown={(e) => startDrag(e, key)}
               on:pointermove={(e) => moveDrag(e, key)}
               on:pointerup={(e) => endDrag(e, key, () => deleteRoute(r))}
               on:pointercancel={(e) => endDrag(e, key, () => {})}>
            <button class="flex-1 min-w-0 text-left px-4 py-3"
                    on:click|capture={guardClick}
                    on:click={() => { if (!pendingDelete.has(key)) onRunSavedRoute(r); }}>
              <div class="flex items-center gap-2 mb-1">
                <RouteIcon size={16} color="var(--accent)" />
                <div class="t-title3 font-semibold flex-1 truncate">{r.label}</div>
              </div>
              <div class="flex items-center gap-1.5 t-footnote text-muted">
                <span class="truncate">{r.from.name}</span>
                <ArrowRight size={12} />
                <span class="truncate">{r.to.name}</span>
              </div>
            </button>
            <button type="button"
                    class="pressable w-11 min-h-[44px] grid place-items-center border-l border-base shrink-0"
                    on:pointerdown|stopPropagation
                    on:click|stopPropagation={() => openRename(r)}
                    aria-label={$t('Preimenuj pot {label}', { label: r.label })}>
              <Pencil size={16} color="var(--text-muted)" />
            </button>
          </div>
        </div>
      {/each}
      <h2 class="t-footnote text-muted uppercase tracking-wide pt-2">{$t('Postajališča')}</h2>
    {/if}

    {#if favList.length === 0 && $savedRoutes.length === 0}
      <EmptyState icon={Star} title={$t('Še ni priljubljenih')} body={$t('Dodaj postajo s pritiskom na zvezdico ali shrani pot iz načrtovalca.')} />
    {:else if favList.length > 0}
      <div class="flex items-center justify-between">
        <div class="t-footnote text-muted">{favList.length} {plural(favList.length, ['postaja', 'postaji', 'postaje', 'postaj'], ['stop', 'stops'])}</div>
        <div class="flex items-center gap-2">
          <ReadAloud text={() => departuresSpeech(boards.map(b => ({
            name: b.stop.name, rows: b.deps.map(gtfsRow),
            empty: gtfs && b.deps.length === 0 ? noMoreToday(nextServiceDeparture(gtfs, b.stop.id)) : undefined,
          })))} />
          <button class="pressable t-footnote text-muted flex items-center gap-1 min-h-[44px] px-1" on:click={() => clearConfirmOpen = true}>
            <Trash2 size={14} /> {$t('Počisti')}
          </button>
        </div>
      </div>
      {#each boards as b (b.stop.id)}
        {@const key = `s:${b.stop.id}`}
        {@const dx = off(key)}
        {@const pinned = $favLines.filter(f => f.stopId === b.stop.id)}
        <div class="relative rounded-2xl">
          <div class="absolute inset-0 rounded-2xl flex items-center justify-between px-6 pointer-events-none"
               style="background: var(--status-disrupt); color: white; opacity: {Math.abs(dx) > 10 ? 1 : 0}; transition: opacity 120ms;">
            <Trash2 size={22} />
            <Trash2 size={22} />
          </div>
          <!-- role=group: pointer handlerji so swipe-to-delete gesta na kartici -->
          <div class="pressable relative w-full text-left surface rounded-2xl border border-base shadow-card overflow-hidden"
                  role="group"
                  style="transform: translateX({dx}px); transition: {dragKey === key ? 'none' : 'transform 0.22s var(--ease-ios)'}; touch-action: pan-y;"
                  on:pointerdown={(e) => startDrag(e, key)}
                  on:pointermove={(e) => moveDrag(e, key)}
                  on:pointerup={(e) => endDrag(e, key, () => deleteStop(b.stop))}
                  on:pointercancel={(e) => endDrag(e, key, () => {})}>
            <button class="w-full text-left px-4 pt-3 pb-2 flex items-center gap-2"
                    on:click|capture={guardClick}
                    on:click={() => { if (!pendingDelete.has(key)) onStopSelect(b.stop); }}>
              <Star size={16} fill="var(--status-delay)" color="var(--status-delay)" />
              <div class="t-title3 font-semibold flex-1 truncate">{b.stop.name}</div>
            </button>
            {#if b.deps.length === 0}
              <div class="px-4 pb-3 t-footnote text-muted">{$t('Danes ni več odhodov')}</div>
            {:else}
              <ul>
                {#each b.deps as d}
                  <li class="border-t border-base">
                    <button class="pressable w-full text-left px-4 {$compactLists ? 'py-1.5' : 'py-2.5'} flex items-center gap-3"
                            on:click|capture={guardClick}
                            on:click={() => { if (!pendingDelete.has(key)) onStopSelect(b.stop); }}
                            aria-label={$t('{line} proti {dest}', { line: d.route.short, dest: d.trip.headsign })}>
                      <LineBadge short={d.route.short} routeId={d.route.id} size={$compactLists ? 'sm' : 'md'} />
                      <div class="flex-1 min-w-0 {$compactLists ? 't-subhead' : 't-callout'} truncate">{d.trip.headsign}</div>
                      <DepartureTime minutesFromNow={d.minutesFromNow} depSec={d.depSec} size={$compactLists ? 'sm' : 'md'} />
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
            <div class="px-3 py-2 border-t border-base flex flex-col gap-1.5">
              {#each pinned as f}
                <button type="button"
                        class="pressable w-full inline-flex items-center gap-2 min-h-[44px] pl-1 pr-3 rounded-xl border border-base"
                        style="background: var(--surface-2);"
                        on:pointerdown|stopPropagation
                        on:click|stopPropagation={() => openTimetableFor(f)}
                        aria-label={$t('Vozni red linije {line} za {dest}', { line: f.routeShort, dest: f.headsign })}>
                  <LineBadge short={f.routeShort} routeId={f.routeId} size="sm" />
                  <span class="t-footnote flex-1 min-w-0 truncate text-left">{f.headsign}</span>
                </button>
              {/each}
              <button type="button"
                      class="pressable w-full inline-flex items-center justify-center gap-1 min-h-[44px] px-3 rounded-xl border border-base t-footnote text-muted"
                      style="background: var(--surface-2);"
                      on:pointerdown|stopPropagation
                      on:click|stopPropagation={() => pickerStop = b.stop}
                      aria-label={$t('Pripni linijo')}>
                <Plus size={14} /> {$t('Pripni linijo')}
              </button>
            </div>
          </div>
        </div>
      {/each}
    {/if}
  </div>
</Screen>

{#if pickerStop && gtfs}
  <div in:backdrop out:backdrop={{ out: true }} class="fixed inset-0 z-50 flex flex-col"
       style="background: rgba(0,0,0,0.45); backdrop-filter: blur(6px);"
       on:click|self={() => pickerStop = null}
       role="presentation">
    <div in:sheet out:sheet={{ out: true }} class="surface w-full sm:max-w-lg mx-auto mt-auto rounded-t-3xl sm:rounded-3xl sm:my-8 shadow-float flex flex-col overflow-hidden"
         style="max-height: calc(100dvh - 2rem);"
         role="dialog" aria-modal="true" aria-label={$t('Pripni linijo')} tabindex="-1"
         use:focusTrap>
      <div class="flex items-center gap-3 px-5 pt-4 pb-3 shrink-0">
        <div class="min-w-0 flex-1">
          <div class="t-footnote text-muted uppercase tracking-wide">{$t('Pripni linijo')}</div>
          <div class="t-title2 truncate">{pickerStop.name}</div>
        </div>
        <button class="pressable w-11 h-11 rounded-full surface-2 grid place-items-center"
                on:click={() => pickerStop = null} aria-label={$t('Zapri')}>
          <X size={18} />
        </button>
      </div>
      <div class="flex-1 overflow-y-auto px-5 pb-5">
        {#if pickerChoices.length === 0}
          <div class="t-body text-muted text-center py-8">{$t('Ni linij za to postajo.')}</div>
        {:else}
          <ul class="surface-2 rounded-2xl overflow-hidden">
            {#each pickerChoices as c, i}
              {@const on = $favLines.some(f => f.stopId === pickerStop!.id && f.routeId === c.route.id && f.dir === c.dir)}
              <li>
                <button class="pressable w-full px-4 py-3 flex items-center gap-3 text-left {i > 0 ? 'border-t border-base' : ''}"
                        on:click={() => pinLine(pickerStop!, c)}
                        aria-pressed={on}>
                  <LineBadge short={c.route.short} routeId={c.route.id} size="md" />
                  <!-- Prej je bila pod headsignom še vrstica "Smer A/B" — interni GTFS
                       dir, ki uporabniku ne pove ničesar; headsign nosi vso informacijo. -->
                  <div class="flex-1 min-w-0 t-body font-medium truncate">{c.headsign}</div>
                  {#if on}
                    <div class="w-5 h-5 rounded-full bg-accent grid place-items-center shrink-0">
                      <div class="w-2 h-2 rounded-full bg-white"></div>
                    </div>
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  </div>
{/if}

{#if renameId}
  <div in:backdrop out:backdrop={{ out: true }} class="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-4"
       style="background: rgba(0,0,0,0.45); backdrop-filter: blur(6px);"
       on:click|self={() => renameId = null}
       role="presentation">
    <div in:sheet out:sheet={{ out: true }} class="surface w-full sm:max-w-sm rounded-3xl shadow-float p-5"
         role="dialog" aria-modal="true" aria-label={$t('Preimenuj pot')} tabindex="-1"
         use:focusTrap>
      <div class="t-headline font-semibold mb-1">{$t('Preimenuj pot')}</div>
      <div class="t-footnote text-muted mb-3">{$t('Na primer »Dom → Služba«.')}</div>
      <input bind:value={renameValue}
             maxlength="40"
             on:keydown={(e) => { if (e.key === 'Enter') commitRename(); }}
             class="w-full h-12 surface-2 rounded-xl border border-base px-3 t-body mb-4"
             aria-label={$t('Ime poti')} />
      <div class="flex gap-2">
        <button type="button" class="pressable flex-1 min-h-[44px] rounded-xl surface-2 border border-base t-callout font-semibold"
                on:click={() => renameId = null}>{$t('Prekliči')}</button>
        <button type="button" class="pressable flex-1 min-h-[44px] rounded-xl t-callout font-semibold disabled:opacity-50"
                style="background: var(--accent); color: #ffffff;"
                disabled={!renameValue.trim()}
                on:click={commitRename}>{$t('Shrani')}</button>
      </div>
    </div>
  </div>
{/if}

<ConfirmDialog open={clearConfirmOpen}
               title={$t('Počisti vse priljubljene postaje?')}
               body={$t('Shranjene poti ostanejo. Dejanje lahko takoj razveljaviš.')}
               confirmLabel={$t('Počisti')} destructive
               onConfirm={clearAll}
               onCancel={() => clearConfirmOpen = false} />

<StopTimetableModal open={ttOpen} {gtfs} stop={ttStop}
                    filterRouteId={ttRouteId} filterDir={ttDir} filterHeadsign={ttHeadsign}
                    onClose={() => ttOpen = false} />
