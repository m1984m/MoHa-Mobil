<script lang="ts">
  import { backdrop, sheet, swap } from '../motion';
  import { X, Star } from 'lucide-svelte';
  import LineBadge from '../ui/LineBadge.svelte';
  import ReadAloud from '../ui/ReadAloud.svelte';
  import { stopTimetableSpeech } from '../readAloud';
  import { allDeparturesForStop, dayKindToDate, dayKindOf, isHolidayService, rowTarget, type GTFS, type Stop, type DayKind } from '../gtfs';
  import { twinStopHint } from '../simpleStops';
  import { scrollToMe, resetScroll } from '../scrollToMe';
  import { nowMb, nowSecMb } from '../clock';
  import { favStops } from '../favorites';
  import { focusTrap } from '../focusTrap';
  import { t } from '../i18n';

  export let open = false;
  export let gtfs: GTFS | null;
  export let stop: Stop | null;
  export let onClose: () => void;
  // Opcijski filter: pokaže samo odhode določene linije (+ izbrane smeri).
  // Uporablja se za shortcute iz Priljubljenih, kjer uporabnik tapne točen par (postaja, linija).
  export let filterRouteId: number | null = null;
  export let filterDir: number | null = null;
  export let filterHeadsign: string = '';
  // Klik na LineBadge → parent naj odpre vozni red te linije (smer = trip.dir).
  // Brez tega prop-a so LineBadge-i statični.
  export let onOpenLine: ((routeId: number, dir: number) => void) | null = null;

  let day: DayKind = detectToday();
  // Ob vsakem odprtju spet današnji dan: prej je okno ostalo na zadnjem izbranem
  // (»Nedelja« od včeraj) in naslednji odhod se ni označil (pregled 12.10.2026).
  let wasOpen = false;
  $: if (open !== wasOpen) {
    wasOpen = open;
    if (open) day = detectToday();
  }

  // Glava: smer filtra je cilj (cel opis se začne z izhodiščem), pod imenom pa opis
  // linij in smeri, kadar ima postajališče dvojnika čez cesto (ponovna ocena 05.10.2026).
  $: filterDest = filterHeadsign
    ? rowTarget(gtfs, gtfs?.routes.find(r => r.id === filterRouteId)?.short ?? '', filterHeadsign).dest : '';
  $: twinHint = gtfs && stop ? twinStopHint(gtfs, stop) : '';

  // Vrsta dneva po službi, ki danes res vozi: na praznik (25.12., 31.10.) nedelja.
  function detectToday(): DayKind {
    return dayKindOf(gtfs, nowMb());
  }
  $: holidayToday = open && !!gtfs && isHolidayService(gtfs, nowMb());

  $: days = [
    { id: 'weekday', label: $t('Delavnik') },
    { id: 'saturday', label: $t('Sobota') },
    { id: 'sunday', label: $t('Nedelja') },
  ] as { id: DayKind; label: string }[];

  $: rawDeps = gtfs && stop ? allDeparturesForStop(gtfs, stop.id, dayKindToDate(day, nowMb(), gtfs)) : [];
  $: deps = filterRouteId != null
    ? rawDeps.filter(d => d.route.id === filterRouteId && (filterDir == null || d.trip.dir === filterDir))
    : rawDeps;
  $: isFav = stop ? $favStops.has(stop.id) : false;

  // Danes: seznam se odpre pri uri naslednjega odhoda, ta je obrobljen, pretekli so brez
  // podlage in s pridušeno minuto (brez prosojnosti, ki bi pokvarila kontrast; N11).
  $: nowSec = open && day === detectToday() ? nowSecMb() : null;
  $: nextDep = nowSec == null ? null : deps.find(d => d.depSec >= nowSec!) ?? null;
  $: nextHour = nextDep ? Math.floor(nextDep.depSec / 3600) % 24 : -1;
  function chipStyle(d: { depSec: number }): string {
    if (nextDep && d === nextDep) return 'box-shadow: inset 0 0 0 2px var(--accent-on-tint, var(--accent))';
    if (nowSec != null && d.depSec < nowSec) return 'background: transparent; box-shadow: inset 0 0 0 1px var(--border)';
    return '';
  }

  // Group by hour
  $: grouped = (() => {
    const m = new Map<number, { route: any; trip: any; depSec: number }[]>();
    for (const d of deps) {
      const h = Math.floor(d.depSec / 3600) % 24;
      if (!m.has(h)) m.set(h, []);
      m.get(h)!.push(d);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  })();

  // Za današnji dan se berejo naslednji odhodi, za drug dan prvi in zadnji po linijah.
  function readText(): string {
    if (!stop) return '';
    const label = days.find(d => d.id === day)?.label ?? '';
    const now = nowMb();
    const nowSec = day === detectToday() ? now.getHours() * 3600 + now.getMinutes() * 60 : null;
    return stopTimetableSpeech(stop.name, label, deps, nowSec);
  }

  function fmtMin(sec: number): string {
    return String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  }
</script>

<!-- Escape na <svelte:window>, ne na overlay div-u: ta nikoli ne dobi fokusa,
     zato keydown nanj ni nikoli prišel in modala ni bilo mogoče zapreti s tipkovnico. -->
<svelte:window on:keydown={(e) => { if (open && e.key === 'Escape') onClose(); }} />

{#if open && stop}
  <div in:backdrop out:backdrop={{ out: true }} class="fixed inset-0 z-50 flex flex-col"
       style="background: rgba(0,0,0,0.45); backdrop-filter: blur(6px);"
       on:click|self={onClose}
       role="presentation">
    <div in:sheet out:sheet={{ out: true }} class="surface w-full sm:max-w-lg mx-auto mt-auto rounded-t-3xl sm:rounded-3xl sm:my-8 shadow-float flex flex-col overflow-hidden"
         style="max-height: calc(100dvh - 2rem);"
         role="dialog" aria-modal="true" aria-label={$t('Vozni red postaje {postaja}', { postaja: stop.name })} tabindex="-1"
         use:focusTrap>
      <div class="flex items-center gap-3 px-5 pt-4 pb-2 shrink-0">
        <div class="min-w-0 flex-1">
          <div class="t-footnote text-muted uppercase tracking-wide">
            {$t('Vozni red')}{#if filterRouteId != null && filterDest} · {$t('smer {smer}', { smer: filterDest })}{/if}
          </div>
          <div class="t-title2 line-clamp-2">{stop.name}</div>
          {#if twinHint}<div class="t-footnote text-muted line-clamp-2">{twinHint}</div>{/if}
        </div>
        <ReadAloud resetKey={`${stop.id}:${day}:${filterRouteId}`} text={readText} />
        <button class="pressable w-11 h-11 rounded-full surface-2 grid place-items-center"
                on:click={() => favStops.toggle(stop.id)}
                aria-label={isFav ? $t('Odstrani iz priljubljenih') : $t('Dodaj med priljubljene')}
                aria-pressed={isFav}>
          <Star size={18}
                color={isFav ? 'var(--status-delay)' : 'var(--text-muted)'}
                fill={isFav ? 'var(--status-delay)' : 'none'} />
        </button>
        <button class="pressable w-11 h-11 rounded-full surface-2 grid place-items-center"
                on:click={onClose} aria-label={$t('Zapri')}>
          <X size={18} />
        </button>
      </div>

      <div class="px-5 pb-3 shrink-0">
        <div class="surface-2 rounded-xl p-1 flex gap-1">
          {#each days as d}
            {@const a = day === d.id}
            <button class="pressable flex-1 h-9 rounded-lg t-subhead transition-colors"
                    style="background: {a ? 'var(--accent)' : 'transparent'}; color: {a ? 'white' : 'var(--text)'}"
                    on:click={() => day = d.id}>{d.label}</button>
          {/each}
        </div>
        {#if holidayToday && day === detectToday()}
          <div class="t-footnote text-muted mt-2" role="note">{detectToday() === 'saturday'
            ? $t('Danes je praznik: avtobusi vozijo po sobotnem redu.')
            : detectToday() === 'weekday'
              ? $t('Danes avtobusi vozijo po delavniškem redu.')
              : $t('Danes je praznik: avtobusi vozijo po nedeljskem redu.')}</div>
        {/if}
      </div>

      <div class="flex-1 overflow-y-auto px-5 pb-5" data-tt-scroll>
        {#key day}
        <div in:swap use:resetScroll>
        {#if deps.length === 0}
          <div class="t-body text-muted text-center py-8">{$t('Ni odhodov za izbrani dan.')}</div>
        {:else}
          <ul class="space-y-2">
            {#each grouped as [h, list]}
              <li class="flex gap-3 items-start" use:scrollToMe={h === nextHour}>
                <div class="w-12 shrink-0 t-title3 font-bold tabular-nums pt-1"
                     style={nowSec != null && nextHour >= 0 && h < nextHour ? 'color: var(--text-muted)' : ''}>{String(h).padStart(2, '0')}</div>
                <div class="flex-1 flex flex-wrap gap-1.5">
                  {#each list as d}
                    {#if onOpenLine}
                      <button class="pressable inline-flex items-center gap-1.5 surface-2 rounded-lg pl-1 pr-2 py-1"
                              style={chipStyle(d)}
                              on:click={() => onOpenLine!(d.route.id, d.trip.dir)}
                              aria-label={$t('Vozni red linije {linija}', { linija: d.route.short }) + (d === nextDep ? ', ' + $t('naslednji') : '')}>
                        <LineBadge short={d.route.short} routeId={d.route.id} size="sm" />
                        <span class="t-footnote tabular-nums font-semibold" style={nowSec != null && d.depSec < nowSec ? 'color: var(--text-muted)' : ''}>:{fmtMin(d.depSec)}</span>
                      </button>
                    {:else}
                      <div class="inline-flex items-center gap-1.5 surface-2 rounded-lg pl-1 pr-2 py-1" style={chipStyle(d)}>
                        <LineBadge short={d.route.short} routeId={d.route.id} size="sm" />
                        <span class="t-footnote tabular-nums font-semibold" style={nowSec != null && d.depSec < nowSec ? 'color: var(--text-muted)' : ''}>:{fmtMin(d.depSec)}</span>
                      </div>
                    {/if}
                  {/each}
                </div>
              </li>
            {/each}
          </ul>
        {/if}
        </div>
        {/key}
      </div>
    </div>
  </div>
{/if}
