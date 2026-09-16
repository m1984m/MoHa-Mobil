<script lang="ts">
  import { ArrowLeft, Plus, Trash2, Pencil, AlarmClock, BellRing, BellOff, Smartphone, X, Send, AlertTriangle } from 'lucide-svelte';
  import type { GTFS } from '../gtfs';
  import EmptyState from '../ui/EmptyState.svelte';
  import LineBadge from '../ui/LineBadge.svelte';
  import { focusTrap } from '../focusTrap';
  import { pushBack } from '../backstack';
  import { toast } from '../toast';
  import { favLines } from '../favLines';
  import type { FavLine } from '../favLines';
  import {
    alarms, addAlarm, updateAlarm, removeAlarm, toggleAlarm,
    computeOccurrences, alarmsCoverageWarning, nextRingLabel, daysLabel,
    DAY_SHORT, DEFAULT_LEAD_MIN, MAX_LEAD_MIN,
  } from '../alarms';
  import type { Alarm, Occurrence } from '../alarms';
  import { pushState, enablePush, disablePush, showLocalTest, isIOS, isStandalone } from '../push';
  import { fmtClock, fmtPlural } from '../time';

  // Zaslon je poln prekrivni sloj (z-50, nad TabBar), ne šesti zavihek:
  // pet zavihkov na 390 px že zapolni vrstico, šesti bi oznake obrezal.
  // Vstop je iz Priljubljenih in iz Nastavitev.
  export let open = false;
  export let gtfs: GTFS | null;
  export let onClose: () => void;

  const DATE_FMT = new Intl.DateTimeFormat('sl-SI', { day: 'numeric', month: 'long', year: 'numeric' });

  // Ponovitve so vir podatka "naslednjič zazvoni …" in telo prve sinhronizacije.
  $: occ = open && gtfs ? computeOccurrences(gtfs, $alarms) : [];
  $: warning = open ? alarmsCoverageWarning(gtfs, $alarms) : null;
  $: iosBlocked = isIOS() && !isStandalone();
  $: enabledCount = $alarms.filter(a => a.enabled).length;

  function nextFor(id: string): Occurrence | null {
    return occ.find(o => o.alarmId === id) ?? null;
  }

  function fmtLastSync(ms: number): string {
    const d = new Date(ms);
    return fmtClock(d.getHours() * 3600 + d.getMinutes() * 60);
  }

  // ── urejevalnik ────────────────────────────────────────────────────────────
  let editorOpen = false;
  let editId: string | null = null;
  let eFav: FavLine | null = null;
  let eDays: boolean[] = [true, true, true, true, true, false, false];
  let eFrom = '06:00';
  let eTo = '08:00';
  let eLead = DEFAULT_LEAD_MIN;

  const favKey = (f: { stopId: number; routeId: number; dir: number }) => `${f.stopId}:${f.routeId}:${f.dir}`;

  function minToStr(m: number): string { return fmtClock(m * 60); }
  function strToMin(s: string): number | null {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
    if (!m) return null;
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
  }

  $: eFromMin = strToMin(eFrom);
  $: eToMin = strToMin(eTo);
  // Okno čez polnoč ni dovoljeno (glej komentar pri computeOccurrences) — raje
  // jasna zavrnitev kot opomnik, ki tiho nikoli ne zazvoni.
  $: windowValid = eFromMin !== null && eToMin !== null && eToMin >= eFromMin;
  $: canSave = eFav !== null && eDays.some(Boolean) && windowValid;

  function openNew() {
    editId = null;
    eFav = $favLines[0] ?? null;
    eDays = [true, true, true, true, true, false, false];
    eFrom = '06:00';
    eTo = '08:00';
    eLead = DEFAULT_LEAD_MIN;
    editorOpen = true;
  }

  function openEdit(a: Alarm) {
    editId = a.id;
    // Če je uporabnik med tem odpel linijo, uporabimo posnetek oznak iz opomnika —
    // sicer bi urejanje obstoječega pokazalo prazno izbiro.
    eFav = $favLines.find(f => favKey(f) === favKey(a))
      ?? { stopId: a.stopId, routeId: a.routeId, dir: a.dir, stopName: a.stopName, routeShort: a.routeShort, headsign: a.headsign };
    eDays = [...a.days];
    eFrom = minToStr(a.fromMin);
    eTo = minToStr(a.toMin);
    eLead = a.leadMin;
    editorOpen = true;
  }

  function save() {
    if (!canSave || !eFav || eFromMin === null || eToMin === null) return;
    const base = {
      stopId: eFav.stopId, routeId: eFav.routeId, dir: eFav.dir,
      stopName: eFav.stopName, routeShort: eFav.routeShort, headsign: eFav.headsign,
      days: [...eDays],
      fromMin: eFromMin, toMin: eToMin, leadMin: eLead,
    };
    if (editId) updateAlarm(editId, base);
    else addAlarm({ ...base, enabled: true });
    editorOpen = false;
  }

  function del(a: Alarm) {
    removeAlarm(a.id);
    editorOpen = false;
    toast.showUndo(`Opomnik ${a.routeShort} odstranjen`, () => alarms.update(l => [...l, a]));
  }

  function setDays(preset: 'week' | 'weekend') {
    eDays = preset === 'week'
      ? [true, true, true, true, true, false, false]
      : [false, false, false, false, false, true, true];
  }

  function toggleDay(i: number) {
    eDays = eDays.map((v, j) => (j === i ? !v : v));
  }

  // Sistemski "nazaj" zapre najprej urejevalnik, nato zaslon.
  let backEditor: (() => void) | null = null;
  $: if (editorOpen && !backEditor) {
    backEditor = pushBack(() => editorOpen = false);
  } else if (!editorOpen && backEditor) {
    const r = backEditor; backEditor = null; r();
  }

  // ── obvestila ──────────────────────────────────────────────────────────────
  async function onEnable() { await enablePush(occ); }
  async function onDisable() { await disablePush(); }
  async function onTest() { await showLocalTest(); }
</script>

<svelte:window on:keydown={(e) => {
  if (!open || e.key !== 'Escape') return;
  if (editorOpen) editorOpen = false;
  else onClose();
}} />

{#if open}
  <div class="fixed inset-0 z-50 surface flex flex-col" style="padding-top: env(safe-area-inset-top);">
    <header class="shrink-0 px-2 pt-2 pb-2 flex items-center gap-1">
      <button class="pressable w-11 h-11 rounded-full grid place-items-center shrink-0"
              on:click={onClose} aria-label="Nazaj">
        <ArrowLeft size={20} />
      </button>
      <h1 class="t-title2 flex-1 min-w-0 truncate">Opomniki za odhod</h1>
      {#if $favLines.length > 0}
        <button class="pressable w-11 h-11 rounded-full surface-2 grid place-items-center shrink-0"
                on:click={openNew} aria-label="Nov opomnik">
          <Plus size={20} />
        </button>
      {/if}
    </header>

    <div class="flex-1 overflow-y-auto scrollbox"
         style="padding-bottom: calc(env(safe-area-inset-bottom) + 2rem);">
      <div class="px-4 max-w-screen-sm mx-auto space-y-6">

        <!-- Vozni red se izteka / ne velja več -->
        {#if warning}
          <div class="rounded-2xl border p-4 flex items-start gap-3"
               style="border-color: var(--status-delay); background: color-mix(in oklab, var(--status-delay) 12%, transparent);"
               role="status">
            <div class="shrink-0"><AlertTriangle size={20} color="var(--status-delay)" /></div>
            <div class="t-footnote" style="color: var(--status-delay)">{warning.text}</div>
          </div>
        {/if}

        <!-- Obvestila -->
        <section>
          <div class="t-footnote text-muted uppercase tracking-wide mb-2 px-1">Obvestila</div>
          <ul class="surface rounded-2xl border border-base overflow-hidden shadow-card">
            <li class="min-h-[56px] px-4 py-3 flex items-center gap-3">
              <svelte:component this={$pushState.subscribed ? BellRing : BellOff}
                                size={20}
                                color={$pushState.subscribed ? 'var(--status-ontime)' : 'var(--text-muted)'} />
              <div class="flex-1 min-w-0">
                <div class="t-body">{$pushState.subscribed ? 'Obvestila so vklopljena' : 'Obvestila so izklopljena'}</div>
                <div class="t-footnote text-muted">
                  {#if !$pushState.supported}
                    Ta brskalnik ne podpira potisnih obvestil.
                  {:else if $pushState.permission === 'denied'}
                    Brskalnik obvestila zavrača — dovoli jih v nastavitvah strani.
                  {:else if $pushState.subscribed}
                    Opomniki lahko zazvonijo na tej napravi.
                  {:else}
                    Brez njih opomniki ne morejo zazvoniti.
                  {/if}
                </div>
              </div>
              {#if $pushState.subscribed}
                <button class="pressable shrink-0 min-h-[44px] px-4 rounded-xl surface-2 border border-base t-footnote font-semibold disabled:opacity-50"
                        disabled={$pushState.busy}
                        on:click={onDisable}>Izklopi</button>
              {:else}
                <button class="pressable shrink-0 min-h-[44px] px-4 rounded-xl t-footnote font-semibold disabled:opacity-50"
                        style="background: var(--accent); color: #ffffff;"
                        disabled={$pushState.busy || !$pushState.supported || $pushState.permission === 'denied'}
                        on:click={onEnable}>{$pushState.busy ? 'Vklapljam…' : 'Vklopi obvestila'}</button>
              {/if}
            </li>

            <!-- Brez tega pojasnila obljubljamo budilko, dostavljamo pa obvestilo:
                 v načinu Ne moti / Focus opomnik ne zazvoni. -->
            <li class="px-4 py-3 border-t border-base flex items-start gap-3">
              <div class="shrink-0"><BellOff size={20} color="var(--text-muted)" /></div>
              <div class="t-footnote text-muted">
                <strong class="font-semibold">To ni sistemska budilka.</strong>
                Opomnik pride kot navadno obvestilo, zato v načinu »Ne moti« (Android) ali
                »Focus« (iPhone) ne bo zvonilo in ga lahko preslišiš. Za zbujanje pusti
                budilko telefona.
              </div>
            </li>

            {#if iosBlocked}
              <li class="px-4 py-3 border-t border-base flex items-start gap-3">
                <div class="shrink-0"><Smartphone size={20} color="var(--status-delay)" /></div>
                <div class="t-footnote" style="color: var(--status-delay)">
                  Na iPhonu in iPadu obvestila delujejo šele, ko aplikacijo dodaš na začetni zaslon
                  (Deli → Dodaj na začetni zaslon) in jo odpreš s te ikone.
                </div>
              </li>
            {/if}

            {#if $pushState.error}
              <li class="px-4 py-3 border-t border-base t-footnote" style="color: var(--status-disrupt)">
                {$pushState.error}
              </li>
            {/if}

            <li class="border-t border-base">
              <button class="pressable w-full min-h-[56px] px-4 flex items-center gap-3 text-left"
                      on:click={onTest} aria-label="Pokaži preizkusno obvestilo zdaj">
                <Send size={20} color="var(--text-muted)" />
                <div class="flex-1">
                  <div class="t-body">Preizkusi zdaj</div>
                  <div class="t-footnote text-muted">Takoj prikaže obvestilo na tej napravi</div>
                </div>
              </button>
            </li>

            <!-- Stanje STREŽNIKA, ne lokalnega izračuna: pomirjujoč stavek "pokriti do"
                 se sme pokazati samo, če je uskladitev res uspela. -->
            <li class="min-h-[44px] px-4 py-3 border-t border-base t-footnote text-muted">
              {#if !$pushState.subscribed}
                Dokler obvestila niso vklopljena, opomniki ne bodo zazvonili.
              {:else if $pushState.until !== null}
                V vrsti je {$pushState.count} {fmtPlural($pushState.count, 'zvonjenje', 'zvonjenji', 'zvonjenja', 'zvonjenj')},
                zadnje {DATE_FMT.format(new Date($pushState.until))}.{#if $pushState.lastSync} Nazadnje usklajeno ob {fmtLastSync($pushState.lastSync)}.{/if}
              {:else}
                Strežnik nima zvonjenj v vrsti.{#if $pushState.lastSync} Nazadnje usklajeno ob {fmtLastSync($pushState.lastSync)}.{/if}
              {/if}
            </li>
          </ul>
        </section>

        <!-- Seznam opomnikov -->
        <section>
          <div class="t-footnote text-muted uppercase tracking-wide mb-2 px-1">
            Opomniki{#if $alarms.length > 0} · {enabledCount} od {$alarms.length} vklopljenih{/if}
          </div>

          {#if $favLines.length === 0}
            <EmptyState icon={AlarmClock} title="Najprej pripni linijo"
                        body="Opomnik nastaviš za linijo, ki jo imaš pripeto v Priljubljenih. Odpri Priljubljene, izberi postajo in tapni »Pripni linijo«." />
          {:else if $alarms.length === 0}
            <EmptyState icon={AlarmClock} title="Ni opomnikov"
                        body="Nastavi opozorilo nekaj minut pred odhodom, da ti avtobus ne uide.">
              <button class="pressable min-h-[44px] px-5 rounded-xl t-callout font-semibold"
                      style="background: var(--accent); color: #ffffff;"
                      on:click={openNew}>Dodaj opomnik</button>
            </EmptyState>
          {:else}
            <ul class="space-y-3">
              {#each $alarms as a (a.id)}
                {@const nxt = nextFor(a.id)}
                <li class="surface rounded-2xl border border-base shadow-card overflow-hidden">
                  <div class="px-4 pt-3 pb-2 flex items-center gap-3">
                    <LineBadge short={a.routeShort} routeId={a.routeId} size="sm" />
                    <div class="min-w-0 flex-1">
                      <div class="t-body font-medium truncate">{a.stopName}</div>
                      <div class="t-footnote text-muted truncate">proti {a.headsign}</div>
                    </div>
                    <button type="button"
                            class="pressable relative w-12 h-7 rounded-full transition-colors shrink-0"
                            style="background: {a.enabled ? 'var(--accent)' : 'var(--surface-3)'}"
                            role="switch"
                            aria-checked={a.enabled}
                            aria-label="Vklopi ali izklopi opomnik {a.routeShort} {a.stopName}"
                            on:click={() => toggleAlarm(a.id)}>
                      <span class="absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-card transition-all"
                            style="left: {a.enabled ? '1.375rem' : '0.125rem'}"></span>
                    </button>
                  </div>
                  <div class="px-4 pb-2 flex flex-wrap items-center gap-x-2 gap-y-1 t-footnote text-muted">
                    <span>{daysLabel(a.days)}</span>
                    <span aria-hidden="true">·</span>
                    <span class="tabular-nums">{fmtClock(a.fromMin * 60)}–{fmtClock(a.toMin * 60)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{a.leadMin} min prej</span>
                  </div>
                  <div class="px-4 pb-3 t-footnote" style="color: {a.enabled && nxt ? 'var(--accent)' : 'var(--text-muted)'}">
                    {#if !a.enabled}
                      Izklopljen
                    {:else}
                      Naslednjič {nextRingLabel(nxt)}
                    {/if}
                  </div>
                  <div class="flex border-t border-base">
                    <button class="pressable flex-1 min-h-[44px] flex items-center justify-center gap-2 t-footnote font-medium"
                            on:click={() => openEdit(a)}
                            aria-label="Uredi opomnik {a.routeShort} {a.stopName}">
                      <Pencil size={14} /> Uredi
                    </button>
                    <button class="pressable flex-1 min-h-[44px] flex items-center justify-center gap-2 t-footnote font-medium border-l border-base"
                            style="color: var(--status-disrupt)"
                            on:click={() => del(a)}
                            aria-label="Izbriši opomnik {a.routeShort} {a.stopName}">
                      <Trash2 size={14} /> Izbriši
                    </button>
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </section>

      </div>
    </div>
  </div>
{/if}

{#if open && editorOpen}
  <div class="fixed inset-0 z-[70] flex flex-col"
       style="background: rgba(0,0,0,0.45); backdrop-filter: blur(6px);"
       on:click|self={() => editorOpen = false}
       role="presentation">
    <div class="surface w-full sm:max-w-lg mx-auto mt-auto rounded-t-3xl sm:rounded-3xl sm:my-8 shadow-float flex flex-col overflow-hidden"
         style="max-height: calc(100dvh - 2rem);"
         role="dialog" aria-modal="true" aria-label={editId ? 'Uredi opomnik' : 'Nov opomnik'} tabindex="-1"
         use:focusTrap>
      <div class="flex items-center gap-3 px-5 pt-4 pb-3 shrink-0">
        <div class="min-w-0 flex-1">
          <div class="t-footnote text-muted uppercase tracking-wide">Opomnik za odhod</div>
          <div class="t-title2 truncate">{editId ? 'Uredi opomnik' : 'Nov opomnik'}</div>
        </div>
        <button class="pressable w-11 h-11 rounded-full surface-2 grid place-items-center"
                on:click={() => editorOpen = false} aria-label="Zapri">
          <X size={18} />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto scrollbox px-5 pb-4 space-y-5">

        <!-- Linija -->
        <div>
          <div class="t-footnote text-muted uppercase tracking-wide mb-2">Linija in postaja</div>
          {#if $favLines.length === 0}
            <div class="t-footnote text-muted">Ni pripetih linij.</div>
          {:else}
            <ul class="surface-2 rounded-2xl overflow-hidden">
              {#each $favLines as f, i (favKey(f))}
                {@const sel = eFav !== null && favKey(eFav) === favKey(f)}
                <li>
                  <button class="pressable w-full px-4 py-3 flex items-center gap-3 text-left {i > 0 ? 'border-t border-base' : ''}"
                          on:click={() => eFav = f}
                          aria-pressed={sel}>
                    <LineBadge short={f.routeShort} routeId={f.routeId} size="sm" />
                    <div class="flex-1 min-w-0">
                      <div class="t-subhead font-medium truncate">{f.stopName}</div>
                      <div class="t-footnote text-muted truncate">proti {f.headsign}</div>
                    </div>
                    {#if sel}
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

        <!-- Dnevi -->
        <div>
          <div class="t-footnote text-muted uppercase tracking-wide mb-2">Dnevi</div>
          <div class="flex gap-1.5 mb-2">
            {#each DAY_SHORT as d, i}
              <button class="pressable flex-1 min-h-[44px] rounded-xl t-footnote font-semibold"
                      style="background: {eDays[i] ? 'var(--accent)' : 'var(--surface-2)'}; color: {eDays[i] ? 'white' : 'var(--text)'}"
                      role="switch"
                      aria-checked={eDays[i]}
                      aria-label={d}
                      on:click={() => toggleDay(i)}>{d}</button>
            {/each}
          </div>
          <div class="flex gap-1.5">
            <button class="pressable flex-1 min-h-[40px] rounded-xl surface-2 border border-base t-footnote"
                    on:click={() => setDays('week')}>Delavniki</button>
            <button class="pressable flex-1 min-h-[40px] rounded-xl surface-2 border border-base t-footnote"
                    on:click={() => setDays('weekend')}>Vikend</button>
          </div>
          {#if !eDays.some(Boolean)}
            <div class="t-footnote mt-2" style="color: var(--status-delay)">Izberi vsaj en dan.</div>
          {/if}
        </div>

        <!-- Okno -->
        <div>
          <div class="t-footnote text-muted uppercase tracking-wide mb-2">Časovno okno</div>
          <div class="flex items-center gap-2">
            <label class="flex-1">
              <span class="t-footnote text-muted">Od</span>
              <input type="time" bind:value={eFrom}
                     class="w-full h-12 surface-2 rounded-xl border border-base px-3 t-body tabular-nums"
                     aria-label="Začetek okna" />
            </label>
            <label class="flex-1">
              <span class="t-footnote text-muted">Do</span>
              <input type="time" bind:value={eTo}
                     class="w-full h-12 surface-2 rounded-xl border border-base px-3 t-body tabular-nums"
                     aria-label="Konec okna" />
            </label>
          </div>
          <div class="t-footnote mt-2" style="color: {windowValid ? 'var(--text-muted)' : 'var(--status-delay)'}">
            {#if windowValid}
              Zazvoni pred prvim odhodom v tem oknu.
            {:else}
              Konec okna mora biti za začetkom — okno čez polnoč ni podprto.
            {/if}
          </div>
        </div>

        <!-- Odmik -->
        <div>
          <div class="t-footnote text-muted uppercase tracking-wide mb-2">Koliko prej naj zazvoni</div>
          <div class="flex items-center gap-3">
            <input type="range" min="0" max={MAX_LEAD_MIN} step="1" bind:value={eLead}
                   class="flex-1 accent-[var(--accent)]"
                   aria-label="Odmik pred odhodom v minutah" />
            <div class="w-20 text-right t-title3 font-semibold tabular-nums">{eLead} min</div>
          </div>
        </div>
      </div>

      <div class="shrink-0 px-5 pt-3 pb-5 border-t border-base flex gap-2">
        <button type="button" class="pressable flex-1 min-h-[48px] rounded-xl surface-2 border border-base t-callout font-semibold"
                on:click={() => editorOpen = false}>Prekliči</button>
        <button type="button" class="pressable flex-1 min-h-[48px] rounded-xl t-callout font-semibold disabled:opacity-50"
                style="background: var(--accent); color: #ffffff;"
                disabled={!canSave}
                on:click={save}>Shrani</button>
      </div>
    </div>
  </div>
{/if}
