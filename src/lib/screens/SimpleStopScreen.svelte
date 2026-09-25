<script lang="ts">
  import { page } from '../motion';
  import { onDestroy } from 'svelte';
  import { ArrowLeft, Star, Volume2, Square, Map as MapIcon, MoonStar } from 'lucide-svelte';
  import { nextServiceDeparture, splitHeadsign, type GTFS, type Stop } from '../gtfs';
  import { fetchArrivalsForStopPoint, type StopArrival } from '../realtime';
  import { favStops } from '../favorites';
  import {
    liveDepartureRows, scheduleDepartureRows, routeIdIndex, LIVE_FRESH_MS, type DepartureRow,
  } from '../departures';
  import { canSpeak, speaking, speak, stopSpeaking, departuresSpeech } from '../speech';
  import { fmtClock, fmtDayOffset } from '../time';
  import { focusTrap } from '../focusTrap';
  import { t } from '../i18n';
  import LineBadge from '../ui/LineBadge.svelte';
  import DepartureTime from '../ui/DepartureTime.svelte';
  import LiveDot from '../ui/LiveDot.svelte';

  // Vsi bližnji odhodi z enega postajališča, v velikem tisku, brez karte.
  // Vrstice niso gumbi: dotik nanje ne bi naredil ničesar, zato ne smejo
  // izgledati, kot da bi.
  export let gtfs: GTFS | null;
  export let stop: Stop | null;
  export let onClose: () => void;
  // Skrit, a odprt (karta je čez njega) — brez animacije zapiranja in odpiranja.
  export let hidden = false;
  export let onShowMap: (s: Stop) => void;

  const MAX_ROWS = 6;

  let live: StopArrival[] = [];
  let liveAt = 0;
  let tick = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let loadedFor: number | null = null;

  async function refresh() {
    if (!stop || hidden || document.hidden) return; // pod karto ne poizveduj
    const id = stop.id;
    try {
      const r = await fetchArrivalsForStopPoint(id);
      if (stop?.id === id) { live = r; liveAt = Date.now(); }
    } catch {}
  }

  $: if (stop && stop.id !== loadedFor) {
    loadedFor = stop.id;
    live = []; liveAt = 0;
    refresh();
    if (!timer) timer = setInterval(() => { tick++; refresh(); }, 30_000);
  }
  $: if (!stop && timer) { clearInterval(timer); timer = null; loadedFor = null; stopSpeaking(); }
  onDestroy(() => { if (timer) clearInterval(timer); stopSpeaking(); });
  // Ob odhodu na karto utihni.
  $: if (hidden) stopSpeaking();

  $: routeIds = routeIdIndex(gtfs);
  $: stopNames = gtfs ? new Map(gtfs.stops.map(s => [s.id, s.name])) : new Map<number, string>();
  // tick kot parameter: svežina se preveri znova ob vsakem 30-sekundnem koraku.
  function isFresh(l: StopArrival[], at: number, _tick: number): boolean {
    return l.length > 0 && Date.now() - at < LIVE_FRESH_MS;
  }
  $: isLive = isFresh(live, liveAt, tick);
  // tick je parameter: ob izpadu živih podatkov se vozni red vseeno osveži vsakih
  // 30 s (minute tečejo, odpeljani avtobusi izpadejo).
  function makeRows(s: Stop | null, g: GTFS | null, liveNow: boolean, _tick: number): DepartureRow[] {
    if (!s || !g) return [];
    return liveNow ? liveDepartureRows(live, routeIds, MAX_ROWS) : scheduleDepartureRows(g, s.id, MAX_ROWS, stopNames);
  }
  $: rows = makeRows(stop, gtfs, isLive, tick);
  $: nextDay = (stop && gtfs && rows.length === 0) ? nextServiceDeparture(gtfs, stop.id) : null;
  $: starred = stop ? $favStops.has(stop.id) : false;

  function readAloud() {
    if ($speaking) { stopSpeaking(); return; }
    if (stop) speak(departuresSpeech([{ name: stop.name, rows }]));
  }
</script>

{#if stop}
  <div in:page out:page={{ out: true }} class="fixed inset-0 z-[65] flex flex-col surface" style:display={hidden ? 'none' : null}
       style="padding-top: env(safe-area-inset-top);"
       role="dialog" aria-modal="true" aria-label={stop.name} tabindex="-1" use:focusTrap>
    <div class="px-4 pt-3 pb-2 max-w-screen-sm mx-auto w-full">
      <button type="button" class="pressable mm-ss-back" on:click={onClose}>
        <ArrowLeft size={26} strokeWidth={2.25} /> {$t('Nazaj')}
      </button>
    </div>

    <div class="flex-1 overflow-y-auto scrollbox">
      <div class="px-4 max-w-screen-sm mx-auto space-y-4"
           style="padding-bottom: calc(env(safe-area-inset-bottom) + 2rem);">
        <div>
          <h1 class="t-title1">{stop.name}</h1>
          <div class="mt-1"><LiveDot live={isLive} label={isLive ? $t('V živo') : $t('Po voznem redu')} /></div>
        </div>

        <div class="flex flex-wrap gap-3">
          {#if $canSpeak && rows.length}
            <button type="button" class="pressable mm-ss-btn" style="color: var(--accent)" on:click={readAloud}>
              {#if $speaking}<Square size={22} strokeWidth={2.25} /> {$t('Ustavi branje')}
              {:else}<Volume2 size={24} strokeWidth={2} /> {$t('Preberi na glas')}{/if}
            </button>
          {/if}
          <button type="button" class="pressable mm-ss-btn" on:click={() => stop && favStops.toggle(stop.id)}>
            <Star size={24} strokeWidth={2} fill={starred ? 'var(--status-delay)' : 'none'} color={starred ? 'var(--status-delay)' : 'currentColor'} />
            {starred ? $t('Shranjeno med moje') : $t('Shrani med moje')}
          </button>
        </div>

        {#if rows.length === 0}
          <div class="surface-2 rounded-2xl p-5 flex items-center gap-3">
            <MoonStar size={26} color="var(--text-muted)" />
            <div class="t-body">
              {#if nextDay}
                {$t('Danes ni več odhodov · prvi {dan} ob', { dan: fmtDayOffset(nextDay.dayOffset, nextDay.weekday) })}
                <b>{fmtClock(nextDay.depSec)}</b>
              {:else}
                {$t('Danes ni več odhodov')}
              {/if}
            </div>
          </div>
        {:else}
          <ul class="space-y-2" aria-label={$t('Odhodi')}>
            {#each rows as r}
              {@const split = splitHeadsign(r.headsign, r.destination)}
              <li class="mm-ss-row">
                <LineBadge short={r.routeShort} routeId={r.routeId} size="lg" />
                <div class="flex-1 min-w-0">
                  <div class="t-headline">{split.dest}</div>
                  {#if split.via}<div class="t-footnote text-muted truncate">{$t('prek {via}', { via: split.via })}</div>{/if}
                </div>
                <div class="flex flex-col items-end gap-1 shrink-0">
                  <DepartureTime minutesFromNow={r.minutesFromNow} depSec={r.depSec} />
                  {#if r.delayKnown && Math.abs(r.delayMin ?? 0) >= 1}
                    {@const d = r.delayMin ?? 0}
                    <span class="t-footnote font-semibold" style="color: {Math.abs(d) > 5 ? 'var(--status-disrupt)' : Math.abs(d) >= 3 ? 'var(--status-delay)' : 'var(--status-ontime)'}">{d > 0 ? '+' : ''}{d} min</span>
                  {:else if r.delayKnown}
                    <span class="t-footnote" style="color: var(--status-ontime)">{$t('točno')}</span>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}

        <button type="button" class="pressable mm-ss-btn w-full" on:click={() => stop && onShowMap(stop)}>
          <MapIcon size={26} strokeWidth={2} color="var(--accent)" /> {$t('Pokaži na karti')}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .mm-ss-back, .mm-ss-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 10px;
    min-height: 64px; padding: 0 20px; border-radius: 18px;
    background: var(--surface-2); border: 2px solid var(--border); color: var(--text);
    font-weight: 600; font-size: calc(16px * var(--ui-scale)); touch-action: manipulation;
  }
  .mm-ss-back { padding-left: 14px; }
  .mm-ss-row {
    display: flex; align-items: center; gap: 14px;
    min-height: 88px; padding: 12px 16px; border-radius: 18px;
    background: var(--surface); border: 2px solid var(--border);
  }
</style>
