<script lang="ts">
  import { page } from '../motion';
  import { onDestroy, onMount, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { ArrowLeft, MapPin, Star, BellRing, TriangleAlert, Check, Volume2, Send } from 'lucide-svelte';
  import { nearestStops, dayKindOf, type GTFS, type Stop } from '../gtfs';
  import { nowMb, toMb, mbWallToEpoch } from '../clock';
  import { favStops } from '../favorites';
  import { alarms, addAlarm, updateAlarm, computeOccurrences, onceFireAt, firstRing, ringDayLabel, type Alarm, type RemindPrefill } from '../alarms';
  import { pushState, enablePush, showLocalTest, syncNow } from '../push';
  import { pushBack, type BackRelease } from '../backstack';
  import { focusTrap } from '../focusTrap';
  import { fmtClock } from '../time';
  import { t, tr } from '../i18n';
  import { stopHint, searchStops, linesAtStop, departureTimes, sampleDate, type StopLine } from '../simpleStops';
  import LineBadge from '../ui/LineBadge.svelte';
  import ReadAloud from '../ui/ReadAloud.svelte';
  import { speak, stopSpeaking, speakingOwner, canSpeak } from '../speech';
  import { petraGuide } from '../simple';
  import NotifySoundHelp from '../ui/NotifySoundHelp.svelte';

  // Preprost pogled: opomnik za odhod v šestih korakih, po eno vprašanje na zaslon.
  // Postajališče → avtobus (linija in smer) → dnevi → ura avtobusa → koliko prej →
  // pregled. En avtobus = en opomnik (okno od–do je ena minuta); okna z več
  // avtobusi ostanejo v celotni aplikaciji (Matejeva odločitev 26.09.2026).
  // Izbira z enim odgovorom gre sama naprej, dnevi (več odgovorov) imajo "Naprej".
  export let gtfs: GTFS | null;
  export let origin: { lat: number; lon: number };
  export let hasGeo: boolean;
  export let onClose: () => void;
  // Popravljanje obstoječega opomnika: čarovnik je predizpolnjen in začne na pregledu,
  // shranjevanje pa ta opomnik posodobi (updateAlarm) namesto da doda novega.
  export let edit: Alarm | null = null;
  // »Opomni me« pri odhodu (celotna aplikacija, evalvacija N8): postajališče, avtobus in ura
  // so znani, dnevi so današnja vrsta dneva (delavnik ali ta dan vikenda). Začne na
  // pregledu, če avtobus ob tej uri vozi vse te dni, sicer pri izbiri ure.
  // F13: z zvonca je privzeto »Samo ta odhod« (enkratni opomnik pred PRIČAKOVANIM
  // odhodom: vozni red + znana zamuda); ponavljanje ob dnevih je izrecna izbira.
  export let prefill: RemindPrefill | null = null;

  type Step = 'stop' | 'line' | 'days' | 'time' | 'lead' | 'summary' | 'done';
  const ORDER: Step[] = ['stop', 'line', 'days', 'time', 'lead', 'summary'];
  let step: Step = 'stop';
  let stop: Stop | null = null;
  let line: StopLine | null = null;
  let days: boolean[] = [false, false, false, false, false, false, false];
  let depSec: number | null = null;
  let lead = 10;
  // Enkratni opomnik: pričakovani odhod (ms), odhod po voznem redu in zamuda za prikaz.
  let once = false;
  let onceDep: number | null = null;
  let onceSched: number | null = null;
  let onceDelay: number | null = null;
  // Ura po voznem redu (depSec) iz zvonca kot pravi trenutek: danes, ali ±1 dan, če je
  // tako bližje pričakovanemu odhodu (odhod čez polnoč).
  function schedEpoch(sec: number, near: number): number {
    const n = toMb(near);
    let at = mbWallToEpoch(n.getFullYear(), n.getMonth(), n.getDate(), 0, 0, sec);
    if (at - near > 12 * 3600_000) at -= 86_400_000;
    else if (near - at > 12 * 3600_000) at += 86_400_000;
    return at;
  }
  function expectedDep(p: RemindPrefill): number {
    const near = p.expectedAt ?? Date.now();
    const sched = schedEpoch(p.depSec, near);
    onceSched = sched;
    if (p.expectedAt == null) return sched;
    // Ura iz voznega reda + zamuda je natančna na minuto; ETA »čez N min« je zaokrožena.
    const cand = sched + (p.delayMin ?? 0) * 60_000;
    return Math.abs(cand - p.expectedAt) <= 120_000 ? cand : p.expectedAt;
  }
  // Ura OBA (prihod) se od odhoda v GTFS lahko razlikuje za minuto ali dve ali za
  // sekunde — predizpolnitev naj se ujame z najbližjo uro (validacija F13).
  function nearestTime(list: number[], sec: number): number | null {
    let best: number | null = null;
    for (const x of list) if (Math.abs(x - sec) <= 120 && (best == null || Math.abs(x - sec) < Math.abs(best - sec))) best = x;
    return best;
  }
  if (edit && gtfs) {
    const e = edit;
    stop = gtfs.stops.find(s => s.id === e.stopId) ?? null;
    line = stop ? linesAtStop(gtfs, stop.id).find(l => l.routeId === e.routeId && l.dir === e.dir) ?? null : null;
    days = [...e.days];
    depSec = e.fromMin * 60;
    lead = e.leadMin;
    if (e.once) { once = true; onceDep = e.once.depAt; }
    if (stop && line) step = 'summary';
  } else if (prefill && gtfs) {
    const p = prefill;
    stop = gtfs.stops.find(s => s.id === p.stopId) ?? null;
    line = stop ? linesAtStop(gtfs, stop.id).find(l => l.routeId === p.routeId && l.dir === p.dir) ?? null : null;
    // Vrsta dneva po službi, ki danes res vozi: na praznik (25.12. v petek) je to nedelja,
    // sicer bi čarovnik predlagal delavnike za avtobus iz nedeljskega reda.
    const kind = dayKindOf(gtfs, nowMb());
    days = [0, 1, 2, 3, 4, 5, 6].map(i => (kind === 'weekday' ? i < 5 : kind === 'saturday' ? i === 5 : i === 6));
    if (stop && line) {
      once = true;
      onceDelay = p.delayMin ?? null;
      onceDep = expectedDep(p);
      // Za ponavljanje: ura iz voznega reda, ki vozi vse te dni (s toleranco).
      depSec = nearestTime(timeInfo(gtfs, stop, line, days).times, p.depSec);
      // Enkratni opomnik ure iz voznega reda ne potrebuje: vedno na pregled.
      step = 'summary';
    } else if (stop) step = 'line';
  }
  let query = '';
  let saving = false;
  let dlg: HTMLElement;

  // Koraki, ki jih je uporabnik videl; »Nazaj« (gumb in sistemski) gre na prejšnjega
  // videnega, s prvega pa čarovnik zapre. Prej je čarovnik z zvonca začel na pregledu,
  // »Nazaj« pa je vodil skozi pet korakov, ki jih uporabnik ni nikoli videl — šest
  // dotikov do karte (pregled 12.10.2026). Popravljanje (edit) ostane kot doslej: nazaj
  // vodi skozi vse korake, ker se prav tako popravi izbira.
  let visited: Step[] = edit && step === 'summary' ? [...ORDER] : [step];

  // Menjava koraka: nov korak dobi fokus na vprašanju — sicer fokus pade na <body>
  // (gumb, ki ga je imel, izgine) in bralnik zaslona novega vprašanja ne prebere.
  function show(s: Step) {
    step = s;
    guide(s);
    void tick().then(() => dlg?.querySelector<HTMLElement>('h1')?.focus());
  }
  function go(s: Step) {
    if (visited[visited.length - 1] !== s) visited = [...visited, s];
    show(s);
  }
  // true = vrnil se je na prejšnji videni korak; false = ni ga, čarovnik naj se zapre.
  function stepBack(): boolean {
    if (step === 'done' || visited.length <= 1) return false;
    visited = visited.slice(0, -1);
    let target = visited[visited.length - 1];
    // Spremenjeni dnevi so ponastavili uro: »koliko prej« in pregled brez ure sta prazna,
    // »Shrani« pa ne naredi nič (pregled 12.10.2026). Nazaj zato vodi na izbiro ure,
    // od tam pa na dneve.
    if (!once && depSec == null && (target === 'lead' || target === 'summary')) {
      visited = [...visited.filter(s => s !== 'lead' && s !== 'summary' && s !== 'time' && s !== 'days'), 'days', 'time'];
      target = 'time';
    }
    show(target);
    return true;
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
    if (step === 'done' || visited.length <= 1) { onClose(); return; }
    // Najprej nov vnos: pushBack utiša branje, Petra pa naj prebere prejšnji korak.
    back = pushBack(onSystemBack);
    stepBack();
  }
  onDestroy(() => {
    alive = false;
    back();
    if (get(speakingOwner) === GUIDE) stopSpeaking();
  });

  function goBack() {
    if (saving) return;
    if (!stepBack()) onClose();
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
  // Ura ostane, če avtobus ob njej vozi tudi vse nove izbrane dni; sicer jo je treba izbrati znova.
  function keepTime(d: boolean[]): number | null {
    return depSec != null && gtfs && stop && line && timeInfo(gtfs, stop, line, d).times.includes(depSec) ? depSec : null;
  }
  function preset(p: 'work' | 'all' | 'weekend') {
    days = [0, 1, 2, 3, 4, 5, 6].map(i => p === 'all' || (p === 'work' ? i < 5 : i >= 5));
    depSec = keepTime(days);
    go('time');
  }
  function toggleDay(i: number) { days = days.map((v, j) => (j === i ? !v : v)); depSec = keepTime(days); }

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
  // Ura teče: pri enkratnem opomniku se skrajšan odmik in »prepozno« sproti osvežita.
  let now = Date.now();
  const clockTimer = setInterval(() => { now = Date.now(); }, 15_000);
  onDestroy(() => clearInterval(clockTimer));

  function onceSummaryOf(st: Stop | null, l: StopLine | null, dep: number | null, n: number, at: number): string {
    if (!st || !l || dep == null) return '';
    const f = onceFireAt(dep, n, at);
    if (!f) return '';
    const d = toMb(dep);
    const ura = fmtClock(d.getHours() * 3600 + d.getMinutes() * 60);
    const out = [f.leadMin >= 1
      ? tr('Opomnim te samo enkrat, {n} minut pred odhodom avtobusa {line}, smer {dest}, ob {ura} s postajališča {stop}.', {
          n: f.leadMin, line: l.routeShort, ura, stop: st.name, dest: l.dest })
      : tr('Opomnim te samo enkrat, takoj, ker avtobus {line}, smer {dest}, odpelje ob {ura} s postajališča {stop}.', {
          line: l.routeShort, ura, stop: st.name, dest: l.dest })];
    if (onceDelay && onceSched != null) {
      const sd = toMb(onceSched);
      out.push(tr('Upoštevana je zamuda {n} min (po voznem redu ob {ura}).', { n: onceDelay, ura: fmtClock(sd.getHours() * 3600 + sd.getMinutes() * 60) }));
    }
    if (f.leadMin < n) out.push(tr('Do odhoda ni več {n} minut, zato zazvoni prej.', { n }));
    return out.join(' ');
  }
  $: summary = once ? onceSummaryOf(stop, line, onceDep, lead, now) : summaryOf(stop, line, depSec, days, lead);
  $: tooLate = once && onceDep != null && onceFireAt(onceDep, lead, now) === null;
  // »Prvič zazvoni: torek ob 07:35« / »Danes je že prepozno, prvič zazvoni …« (F13).
  function firstRingText(at: number, ..._deps: unknown[]): string {
    if (once) {
      const f = onceDep != null ? onceFireAt(onceDep, lead, at) : null;
      return f ? tr('Prvič zazvoni: {when}', { when: ringDayLabel(f.fireAt, at) }) : '';
    }
    if (!gtfs || !stop || !line || depSec == null) return '';
    const fromMin = Math.floor(depSec / 60), toMin = Math.ceil(depSec / 60);
    const r = firstRing(gtfs, {
      stopId: stop.id, routeId: line.routeId, dir: line.dir, stopName: stop.name, routeShort: line.routeShort,
      headsign: line.dest, days, fromMin, toMin, leadMin: lead, enabled: true,
    }, at);
    if (r.fireAt == null) return tr('V voznem redu ni odhoda, ob katerem bi opomnik zazvonil.');
    return r.todayMissed
      ? tr('Danes je že prepozno, prvič zazvoni {when}.', { when: ringDayLabel(r.fireAt, at) })
      : tr('Prvič zazvoni: {when}', { when: ringDayLabel(r.fireAt, at) });
  }
  // Odvisnosti naštete izrecno: Svelte sicer ne ve, da funkcija bere te spremenljivke.
  $: firstRingLine = firstRingText(now, once, onceDep, depSec, days, lead, stop, line, $t);

  // Izbira z zvonca: samo ta odhod ali ponavljanje.
  function pickOnce() { once = true; guide(step); }
  function pickRepeat() {
    once = false;
    if (depSec == null) go(days.some(Boolean) ? 'time' : 'days');
    else guide(step);
  }

  // Ali je strežnik razpored res sprejel (F13: »Shranjeno« mora odražati uskladitev).
  let syncOk: boolean | null = null;
  let savedFireAt: number | null = null;

  async function save() {
    if (!gtfs || !stop || !line || saving) return;
    if (once) return saveOnce();
    if (depSec == null) return;
    saving = true;
    // Okno, ki zajame točno ta odhod tudi, če bi imel sekunde (od = do pri celi minuti).
    const fromMin = Math.floor(depSec / 60), toMin = Math.ceil(depSec / 60);
    const dup = get(alarms).find(a => a.stopId === stop!.id && a.routeId === line!.routeId && a.dir === line!.dir
      && a.fromMin === fromMin && a.toMin === toMin && a.leadMin === lead && a.days.join() === days.join());
    // Isti opomnik že obstaja: izklopljenega vklopi, sicer bi "shranjeno" ne zazvonilo.
    if (edit && get(alarms).some(a => a.id === edit!.id)) {
      // Uskladitev s strežnikom sproži App (scheduleSync ob vsaki spremembi $alarms).
      updateAlarm(edit.id, {
        stopId: stop.id, routeId: line.routeId, dir: line.dir,
        stopName: stop.name, routeShort: line.routeShort, headsign: line.dest,
        days: [...days], fromMin, toMin, leadMin: lead, enabled: true, once: null,
      });
    } else if (dup) {
      if (!dup.enabled) updateAlarm(dup.id, { enabled: true });
    } else {
      addAlarm({
        stopId: stop.id, routeId: line.routeId, dir: line.dir,
        stopName: stop.name, routeShort: line.routeShort, headsign: line.dest,
        days: [...days], fromMin, toMin, leadMin: lead, enabled: true,
      });
    }
    savedFireAt = firstRing(gtfs, {
      stopId: stop.id, routeId: line.routeId, dir: line.dir, stopName: stop.name, routeShort: line.routeShort,
      headsign: line.dest, days, fromMin, toMin, leadMin: lead, enabled: true,
    }).fireAt;
    await finishSave();
  }

  // »Samo ta odhod«: zazvoni enkrat pred pričakovanim odhodom, nato se odstrani.
  async function saveOnce() {
    if (!gtfs || !stop || !line || onceDep == null) return;
    const f = onceFireAt(onceDep, lead);
    if (!f) { now = Date.now(); return; }   // medtem prepozno: pregled to pokaže
    saving = true;
    const d = toMb(onceDep);
    const min = d.getHours() * 60 + d.getMinutes();
    const wd = (d.getDay() + 6) % 7;
    const draft = {
      stopId: stop.id, routeId: line.routeId, dir: line.dir,
      stopName: stop.name, routeShort: line.routeShort, headsign: line.dest,
      days: [0, 1, 2, 3, 4, 5, 6].map(i => i === wd), fromMin: min, toMin: min, leadMin: lead, enabled: true,
      once: { depAt: onceDep, fireAt: f.fireAt },
    };
    const dup = get(alarms).find(a => a.once && a.once.depAt === onceDep && a.stopId === stop!.id && a.routeId === line!.routeId);
    if (edit && get(alarms).some(a => a.id === edit!.id)) updateAlarm(edit.id, draft);
    else if (dup) updateAlarm(dup.id, draft);
    else addAlarm(draft);
    savedFireAt = f.fireAt;
    await finishSave();
  }

  async function finishSave() {
    // Dovoljenje za obvestila mora zahtevati dotik (iOS) — ta klic je še v njem.
    // Največ 20 s: tiho okno za dovoljenje v Chromu lahko ne odgovori nikoli, »Shranjujem…«
    // pa je med tem zaklenil Nazaj, Esc in sistemski nazaj (pregled 12.10.2026). Opomnik
    // je že shranjen; zaslon »Shranjeno« pove, če obvestila še niso vklopljena.
    // Ob že vklopljenih obvestilih počakamo na odgovor strežnika (F13), ne na zamik 1 s.
    const timeout = new Promise<boolean>(r => setTimeout(() => r(false), 20_000));
    syncOk = await Promise.race([
      get(pushState).subscribed
        ? syncNow(gtfs, get(alarms))
        : enablePush(computeOccurrences(gtfs!, get(alarms))),
      timeout,
    ]);
    saving = false;
    // Čarovnik je bil med čakanjem zaprt (Esc): Petra ne sme govoriti na drugem zaslonu.
    if (!alive) return;
    go('done');
  }

  $: stepNo = ORDER.indexOf(step) + 1;

  let retrying = false;
  async function retrySync() {
    retrying = true;
    syncOk = await syncNow(gtfs, get(alarms));
    retrying = false;
  }

  // Preizkus: lokalno obvestilo prek storitvenega delavca; dovoljenje se zahteva v tem dotiku.
  let testing = false;
  let testMsg = '';
  async function sendTest() {
    testing = true; testMsg = '';
    const ok = await showLocalTest();
    testing = false;
    if (!ok) testMsg = get(pushState).error ?? tr('Preizkusnega obvestila ni bilo mogoče prikazati.');
  }

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
      out.push(tr('Preveri opomnik.'));
      const at = Date.now();
      if (once && onceDep != null && !onceFireAt(onceDep, lead, at)) out.push(tr('Avtobus že odhaja, za opomnik je prepozno.'));
      else out.push(once ? onceSummaryOf(stop, line, onceDep, lead, at) : summaryOf(stop, line, depSec, days, lead), firstRingText(at),
        tr('Če je vse prav, pritisni Shrani opomnik.'));
    } else if (s === 'done') {
      out.push(tr('Opomnik je shranjen.'));
      out.push(doneText());
      out.push(tr('Pritisni Končano.'));
    }
    return out.filter(Boolean).join(' ');
  }
  // Besedilo zaslona »Shranjeno« (in Petre): uspeh samo, če je strežnik potrdil.
  function doneText(): string {
    const ps = get(pushState);
    if (syncOk && ps.subscribed) {
      return savedFireAt != null
        ? tr('Telefon ti bo poslal obvestilo {when}.', { when: ringDayLabel(savedFireAt) })
        : tr('Telefon ti bo poslal obvestilo {n} minut pred odhodom.', { n: lead });
    }
    if (!ps.subscribed) return ps.error ?? tr('Obvestila še niso vklopljena, zato opomnik ne bo zazvonil.');
    return ps.error ?? tr('Opomnik je shranjen v telefonu, strežnik pa ga ni potrdil, zato morda ne bo zazvonil. Preveri povezavo in poskusi znova.');
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
     role="dialog" aria-modal="true" aria-label={edit ? $t('Popravi opomnik') : $t('Nov opomnik')} tabindex="-1" use:focusTrap bind:this={dlg}>
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
        {#if prefill && !edit && onceDep != null}
          <!-- F13: z zvonca privzeto samo ta odhod; ponavljanje je izrecna izbira. -->
          <div class="grid grid-cols-1 min-[420px]:grid-cols-2 gap-2" role="group" aria-label={$t('Kako pogosto')}>
            <button type="button" class="pressable mm-aw-day" class:mm-aw-on={once} aria-pressed={once} disabled={saving} on:click={pickOnce}>
              {#if once}<Check size={22} strokeWidth={2.5} />{/if} {$t('Samo ta odhod')}
            </button>
            <button type="button" class="pressable mm-aw-day" class:mm-aw-on={!once} aria-pressed={!once} disabled={saving} on:click={pickRepeat}>
              {#if !once}<Check size={22} strokeWidth={2.5} />{/if} {$t('Ponavljaj ob dnevih')}
            </button>
          </div>
        {/if}
        {#if tooLate}
          <div class="surface-2 rounded-2xl p-5 t-body flex items-start gap-3" role="status" style="color: var(--status-delay)">
            <TriangleAlert size={26} class="shrink-0" />
            <span>{$t('Avtobus že odhaja, za opomnik je prepozno.')}</span>
          </div>
        {:else}
          <div class="surface-2 rounded-2xl p-5 t-title3 font-semibold leading-snug">{summary}</div>
          {#if firstRingLine}
            <p class="t-headline" role="status">{firstRingLine}</p>
          {/if}
          <ReadAloud variant="big" wide text={() => `${summary} ${firstRingLine}`} />
        {/if}
        <button type="button" class="pressable mm-aw-next w-full" disabled={saving || !summary || tooLate} on:click={save}>
          <BellRing size={26} /> {saving ? $t('Shranjujem…') : $t('Shrani opomnik')}
        </button>
        {#if once && prefill && !edit && onceDep != null}
          <button type="button" class="pressable mm-aw-row w-full" disabled={saving} on:click={() => go('lead')}>
            <span class="flex-1 text-left t-headline">{$t('Spremeni opozorilo')}</span>
          </button>
        {:else if prefill && !edit && !visited.includes('days')}
          <!-- Z zvonca je vse izbrano; dneve in čas opozorila se da še spremeniti
               (»Nazaj« s pregleda zapre, ker drugih korakov uporabnik ni videl). -->
          <button type="button" class="pressable mm-aw-row w-full" disabled={saving} on:click={() => go('days')}>
            <span class="flex-1 text-left t-headline">{$t('Spremeni dneve ali opozorilo')}</span>
          </button>
        {/if}

      {:else if step === 'done'}
        <h1 class="t-title1" tabindex="-1">{$t('Opomnik je shranjen')}</h1>
        <!-- Uspeh samo, če je strežnik razpored potrdil (syncOk), ne le lokalno shranil. -->
        {#key [syncOk, $pushState.subscribed, $pushState.error, $t]}
          {#if syncOk && $pushState.subscribed}
            <div class="surface-2 rounded-2xl p-5 t-body flex items-start gap-3" role="status">
              <BellRing size={26} color="var(--status-ontime)" />
              <span>{doneText()}</span>
            </div>
          {:else}
            <div class="surface-2 rounded-2xl p-5 t-body flex items-start gap-3" role="status" style="color: var(--status-delay)">
              <TriangleAlert size={26} class="shrink-0" />
              <span>{doneText()}</span>
            </div>
            {#if $pushState.subscribed}
              <button type="button" class="pressable mm-aw-row w-full" disabled={retrying} on:click={retrySync}>
                <span class="flex-1 text-left t-headline">{retrying ? $t('Shranjujem…') : $t('Poskusi znova')}</span>
              </button>
            {/if}
          {/if}
        {/key}
        <button type="button" class="pressable mm-aw-row w-full" disabled={testing} on:click={sendTest}>
          <Send size={26} color="var(--accent)" />
          <span class="flex-1 text-left t-headline">{$t('Pošlji preizkusno obvestilo')}</span>
        </button>
        {#if testMsg}<p class="t-body" style="color: var(--status-delay)">{testMsg}</p>{/if}
        <NotifySoundHelp big />
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
