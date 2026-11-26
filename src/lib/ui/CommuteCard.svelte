<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Footprints } from 'lucide-svelte';
  import { dist, type GTFS } from '../gtfs';
  import type { Place } from '../planTrip';
  import { planCommute, fetchCommuteLive, commuteView, type Commute, type CommuteLive } from '../commute';
  import { commuteSpeech, daysSincePlanDay } from '../readAloud';
  import { nowSecMb } from '../clock';
  import { fmtClock } from '../time';
  import { online } from '../online';
  import { t, plural } from '../i18n';
  import ReadAloud from './ReadAloud.svelte';

  // Kartica »Odhod čez X min« (commute.ts). 'hero' = rdeča kartica na vrhu Doma (namesto
  // »Kam greš?«), 'simple' = povedna kartica z velikim besedilom v preprostem pogledu.
  export let gtfs: GTFS;
  export let from: Place;
  export let to: Place;
  /** »Dom → Služba« (hero) ali »Domov« / ime kraja (simple). */
  export let label: string;
  export let variant: 'hero' | 'simple' = 'hero';
  export let onOpen: (() => void) | null = null;
  /** Trenutna lega (hero): če je potnik že stran od izhodišča poti, je na poti. */
  export let origin: { lat: number; lon: number } | null = null;
  export let hasGeo = false;
  /** Za starša: 'none' pomeni, da kartice ni (samo hoja, ponoči, napaka) — pokaže svoje. */
  export let status: 'loading' | 'ok' | 'none' = 'loading';

  // Izhodišče se v preprostem pogledu premika z lego: novo načrtovanje (z dvema klicema
  // ORS) šele po premiku za več kot 150 m, ne ob vsakem tresljaju GPS (pregled kode).
  const REPLAN_MOVE_M = 150;
  // Opozorilo »ne ujameš« ostane še 5 min po odhodu zamujenega avtobusa.
  const MISSED_SHOW_SEC = 5 * 60;

  let commute: Commute | null = null;
  let live: CommuteLive | null = null;
  let nowMs = Date.now();
  let missedClock: string | null = null;
  let missedUntilMs = 0;
  let planning = false;
  let ctrl: AbortController | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let ticks = 0;
  let plannedFrom: Place | null = null;
  let plannedTo = '';

  const toKey = (p: Place) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
  $: if (gtfs && (toKey(to) !== plannedTo || !plannedFrom || dist(from, plannedFrom) > REPLAN_MOVE_M)) {
    plannedTo = toKey(to);
    plannedFrom = { ...from };
    missedClock = null;
    replan();
  }

  async function replan() {
    ctrl?.abort();
    const c = new AbortController();
    ctrl = c;
    planning = true;
    if (!commute) status = 'loading';
    try {
      const res = await planCommute(gtfs, from, to, c.signal);
      if (c.signal.aborted) return;
      commute = res;
      live = null;
      status = res ? 'ok' : 'none';
      if (res) void refreshLive();
    } catch {
      if (!c.signal.aborted) { commute = null; status = 'none'; }
    } finally {
      if (ctrl === c) planning = false;
    }
  }

  async function refreshLive() {
    const c = commute;
    if (!c || document.hidden || !$online) return;
    try {
      const l = await fetchCommuteLive(c.bus);
      if (commute === c) live = l;
    } catch {
      if (commute === c) live = null;
    }
  }

  // V ozadju nič: ne odšteva, ne preverja zamujenega avtobusa in ne načrtuje znova.
  function onTick() {
    if (document.hidden) return;
    nowMs = Date.now();
    if (++ticks % 2 === 0) void refreshLive();
  }
  function onVisible() {
    if (document.hidden) return;
    nowMs = Date.now();
    void refreshLive();
  }

  onMount(() => {
    timer = setInterval(onTick, 15_000);
    document.addEventListener('visibilitychange', onVisible);
  });
  onDestroy(() => {
    if (timer) clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    ctrl?.abort();
  });

  // Ura v merilu poti: sekunde od polnoči dneva iskanja, po polnoči + 24 h (kot PlanSteps).
  function nowInPlan(c: Commute | null, _ms: number): number {
    return nowSecMb() + 86_400 * daysSincePlanDay(c?.plan.baseDay ?? null);
  }
  $: nowSec = nowInPlan(commute, nowMs);
  $: onTheWay = variant === 'hero' && hasGeo && !!origin && dist(origin, from) > REPLAN_MOVE_M;
  $: view = commute ? commuteView(commute, live, nowSec, nowMs, onTheWay) : null;

  // Tega avtobusa ni več mogoče ujeti: povej to in poišči naslednjega. Največ en ponovni
  // izračun na minuto, če bi načrtovalnik vrnil isti (po živem času že zamujeni) avtobus.
  let lastMissAt = 0;
  $: if (view?.missed && !planning && !document.hidden && nowMs - lastMissAt > 60_000) {
    lastMissAt = nowMs;
    missedClock = view.clock;
    missedUntilMs = nowMs + Math.max(0, view.depSec - nowSec) * 1000 + MISSED_SHOW_SEC * 1000;
    replan();
  }
  $: if (missedClock && nowMs > missedUntilMs) missedClock = null;

  $: bus = commute?.bus ?? null;
  $: walkMin = commute ? Math.max(1, Math.round(commute.walkSec / 60)) : 0;
  const minWord = (n: number) => plural(n, ['minuto', 'minuti', 'minute', 'minut'], ['minute', 'minutes']);

  $: statusText = !view ? ''
    : !view.live ? $t('Po voznem redu, zamude ne poznamo')
    : view.delayMin ? $t('V živo, zamuja {n} min', { n: view.delayMin })
    : $t('V živo, vozi točno');

  function speech(): string {
    if (!view || !bus) return '';
    return commuteSpeech({
      title: variant === 'simple' ? label : undefined,
      line: bus.route.short, routeId: bus.route.id, stop: bus.from.name, clock: view.clock,
      minUntil: view.minUntil, delayMin: view.delayMin, live: view.live,
      goMin: onTheWay ? null : view.goMin, missedClock,
    });
  }
  // Kratko ime za bralnik zaslona; podrobnosti so vidno besedilo v gumbu.
  $: openLabel = bus && view
    ? `${label}: ${bus.route.short}, ${view.clock}. ${$t('Pokaži pot na karti')}`
    : label;
</script>

{#if status === 'loading'}
  {#if variant === 'hero'}
    <div class="rounded-2xl p-4 shadow-card mm-cc-hero" aria-busy="true">
      <div class="t-subhead font-semibold">{label}</div>
      <div class="t-callout mt-3" style="opacity: 0.9">{$t('Iščem naslednji avtobus…')}</div>
    </div>
  {:else}
    <div class="surface rounded-2xl border-2 border-base p-5 space-y-2" aria-busy="true">
      <div class="t-title2">{label}</div>
      <div class="t-body text-muted">{$t('Iščem naslednji avtobus…')}</div>
    </div>
  {/if}
{:else if status === 'ok' && view && bus}
  {#if variant === 'hero'}
    <div class="rounded-2xl p-4 shadow-card mm-cc-hero">
      <div class="flex items-center justify-between gap-3">
        <div class="t-subhead font-semibold min-w-0 truncate">{label}</div>
        <span class="rounded-full shrink-0" style="background: #fff"><ReadAloud text={speech} label={label} /></span>
      </div>
      <button type="button" class="pressable block w-full text-left mt-2" style="color: inherit"
              on:click={() => onOpen?.()} aria-label={openLabel}>
        {#if missedClock}
          <span class="block t-footnote font-semibold">{$t('Avtobusa ob {time} ne ujameš več.', { time: missedClock })}</span>
        {/if}
        <span class="block mm-cc-big">
          {#if view.minUntil <= 0}{$t('Odhaja zdaj')}
          {:else}{$t('čez')} {view.minUntil} <small>min</small>{/if}
        </span>
        <span class="flex items-center gap-2 flex-wrap t-callout">
          <span class="mm-cc-line">{bus.route.short}</span>
          <span class="min-w-0">{bus.from.name} ·
            {#if view.schedClock}<s style="opacity: 0.8">{view.schedClock}</s>{/if}
            <span class="font-semibold">{view.clock}</span></span>
        </span>
        <!-- Na poti (stran od izhodišča) »Pojdi čez« ne velja: hoja je od doma. -->
        {#if !onTheWay}
          <span class="flex items-center gap-2 flex-wrap mt-3">
            <span class="mm-cc-pill" class:mm-cc-pulse={view.goMin <= 0}>
              <Footprints size={16} strokeWidth={2.25} />
              {view.goMin <= 0 ? $t('Pojdi zdaj') : $t('Pojdi čez {n} min', { n: view.goMin })}
            </span>
            <span class="t-subhead">{$t('{n} min hoje', { n: walkMin })}</span>
          </span>
        {/if}
        <span class="flex items-center gap-2 t-footnote mt-3">
          <span class="mm-cc-dot" style="opacity: {view.live ? 1 : 0.55}"></span>{statusText}
        </span>
        {#if commute && commute.next.length}
          <span class="flex gap-1.5 mt-3 t-subhead font-semibold">
            <span class="mm-cc-next">{$t('nato')} {fmtClock(commute.next[0])}</span>
            {#if commute.next[1]}<span class="mm-cc-next">{fmtClock(commute.next[1])}</span>{/if}
          </span>
        {/if}
      </button>
    </div>
  {:else}
    <div class="surface rounded-2xl border-2 border-base p-5 space-y-4">
      <div class="t-title2">{label}</div>
      <p class="t-body">
        {#if missedClock}{$t('Avtobusa ob {time} ne ujameš več.', { time: missedClock })} {/if}
        {#if view.minUntil <= 0}
          {$t('Avtobus {line} s postajališča {stop} odhaja zdaj.', { line: bus.route.short, stop: bus.from.name })}
        {:else}
          {$t('Avtobus {line} s postajališča {stop} pelje čez {n} {enota}, ob {time}.', {
            line: bus.route.short, stop: bus.from.name, n: view.minUntil, enota: minWord(view.minUntil), time: view.clock })}
        {/if}
        {#if !view.live}{$t('Čas je po voznem redu.')}
        {:else if view.delayMin}{$t('Zamuja {n} {enota}.', { n: view.delayMin, enota: minWord(view.delayMin) })}{/if}
      </p>
      <div class="mm-cc-go" class:mm-cc-go-now={view.goMin <= 0} class:mm-cc-pulse={view.goMin <= 0}>
        {view.goMin <= 0 ? $t('Pojdi zdaj') : $t('Pojdi čez {n} {enota}', { n: view.goMin, enota: minWord(view.goMin) })}
      </div>
      <ReadAloud variant="big" wide text={speech} caption={$t('Petra, preberi')} />
    </div>
  {/if}
{/if}

<style>
  /* Predpona mm-cc-: skupni CSS (glej reference_css_class_collision). */
  .mm-cc-hero { background: linear-gradient(135deg, var(--hero-from), var(--hero-to)); color: #fff; }
  .mm-cc-big {
    font-size: calc(44px * var(--ui-scale)); line-height: 1.05; font-weight: 700;
    letter-spacing: -0.03em; margin: 6px 0 6px; white-space: nowrap;
  }
  .mm-cc-big small { font-size: calc(20px * var(--ui-scale)); font-weight: 600; letter-spacing: 0; }
  .mm-cc-line {
    display: inline-flex; align-items: center; justify-content: center; height: 28px; min-width: 34px;
    padding: 0 7px; border-radius: 8px; background: #fff; color: var(--hero-from); font-weight: 700;
  }
  .mm-cc-pill {
    display: inline-flex; align-items: center; gap: 6px; border-radius: 9999px; padding: 5px 11px;
    background: #fff; color: var(--hero-from); font-weight: 700; font-size: calc(14px * var(--ui-scale));
    white-space: nowrap;
  }
  .mm-cc-dot { width: 8px; height: 8px; border-radius: 4px; background: #fff; flex: none; }
  .mm-cc-next { background: rgba(255, 255, 255, 0.18); border-radius: 10px; padding: 4px 9px; white-space: nowrap; }
  .mm-cc-go {
    border-radius: 16px; padding: 16px; text-align: center; font-weight: 700;
    font-size: calc(22px * var(--ui-scale)); line-height: 1.2;
    background: var(--surface-2); color: var(--text);
  }
  .mm-cc-go-now { background: var(--accent); color: #fff; }
  @media (prefers-reduced-motion: no-preference) {
    .mm-cc-pulse { animation: mm-cc-p 1.4s ease-in-out infinite; }
    @keyframes mm-cc-p { 50% { opacity: 0.6; } }
  }
</style>
