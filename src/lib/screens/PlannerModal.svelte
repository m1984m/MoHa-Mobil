<script lang="ts">
  import { onMount } from 'svelte';
  import { backdrop, sheet } from '../motion';
  import { X, MapPin, Flag, Navigation, ArrowRightLeft, Star, Clock, Route as RouteIcon, ArrowRight, ChevronDown, Ticket } from 'lucide-svelte';
  import { type GTFS, type Stop } from '../gtfs';
  import { searchStops, normName, twinStopHint } from '../simpleStops';
  import { searchDay, DAY_SEC, type Plan } from '../planner';
  import { nowMb, nowSecMb } from '../clock';
  import { planTrip, materializePlan, parseHM, tomorrowNoon, type Place, type PlaceKind, type TimeMode, type TransferIssue } from '../planTrip';
  import LineBadge from '../ui/LineBadge.svelte';
  import Skeleton from '../ui/Skeleton.svelte';
  import { favStops } from '../favorites';
  import { plannerShowFavs } from '../settings';
  import { savedRoutes } from '../savedRoutes';
  import { focusTrap } from '../focusTrap';
  import { toast } from '../toast';
  import { t, tr, plural } from '../i18n';
  import ReadAloud from '../ui/ReadAloud.svelte';
  import { candidatesSpeech } from '../readAloud';
  import { EXT, loadIjppSi, outsideMaribor, searchIjppStops, type Mode } from '../ijppPlan';

  export let open: boolean = false;
  export let gtfs: GTFS | null;
  export let origin: { lat: number; lon: number };
  export let hasGeo: boolean;
  export let onClose: () => void;
  export let onShowPlan: (plan: Plan, geoms: any[], from: { lat: number; lon: number; name: string }, to: { lat: number; lon: number; name: string }) => void;
  // Cenik iz rezultatov — prej je bil dosegljiv le prek Nastavitve → Pomoč.
  export let onOpenFares: () => void = () => {};

  // Medkrajevno (cela Slovenija): izhodišče ali cilj zunaj Maribora.
  let mode: Mode = 'all';
  $: intercity = !!((fromPlace && outsideMaribor(fromPlace)) || (toPlace && outsideMaribor(toPlace)));
  // Povezava na prevoz.org za isti od, do in dan (deljeni prevozi). Njihov izvozni API brez
  // pisnega dovoljenja ne (pogoji uporabe 10.1, robots.txt prepoveduje /api/), zato samo povezava.
  // Dan iskanja (danes, jutri ali izbrani), ne vedno današnji (F19).
  $: prevozDate = (candidates.length > 0 ? candidatesTomorrow : chipTomorrow) ? tomorrowNoon() : nowMb();
  $: fromTown = fromPlace ? townOf(fromPlace) : '';
  $: toTown = toPlace ? townOf(toPlace) : '';
  $: prevozHref = intercity && fromTown && toTown
    ? `https://prevoz.org/prevoz/list/?fc=SI&f=${encodeURIComponent(fromTown)}&tc=SI&t=${encodeURIComponent(toTown)}&d=${ymdDash(prevozDate)}`
    : '';
  // Ime kraja za prevoz.org: v Mariboru »Maribor«, drugje kraj iz Nominatima (strukturiran
  // naslov), pri postajah prvi del imena (»Koper AP« → »Koper«). »Moja lokacija« zunaj
  // Maribora brez znanega kraja: povezave ni (prej je šlo v parameter kraja »Moja lokacija«).
  function townOf(p: Place): string {
    if (!outsideMaribor(p)) return 'Maribor';
    if (p.town) return p.town;
    if (p.name === tr('Moja lokacija')) return '';
    if (p.kind === 'addr') return p.name.split(',').pop()!.trim();
    return p.name.split(/[,(]| - | AP\b| žel\.| železniška/i)[0].trim() || p.name;
  }
  function kindLabel(k: PlaceKind | undefined): string {
    return k === 'rail' ? tr('železniška postaja')
      : k === 'busStation' ? tr('avtobusna postaja')
      : k === 'stop' ? tr('postajališče')
      : k === 'town' ? tr('kraj')
      : tr('naslov');
  }
  function ymdDash(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  let fromQuery = '';
  let toQuery = '';
  let fromPlace: Place | null = null;
  let toPlace: Place | null = null;
  let fromFocus = false;
  let toFocus = false;
  let running = false;
  let error = '';
  // Kratko obvestilo bralniku zaslona (role=status) o izidu iskanja (F23).
  let statusMsg = '';
  // Izbrana pot ima prestop, ki ga z dejansko pešpotjo ni mogoče ujeti (F4).
  let transferWarn: { plan: Plan; geoms: any[]; from: Place; to: Place; issues: TransferIssue[] } | null = null;
  let fromAddrResults: Place[] = [];
  let toAddrResults: Place[] = [];
  let fromAddrTimer: any = null;
  let toAddrTimer: any = null;
  export let candidates: Plan[] = [];
  // Predlogi so za jutri: izbrani čas je bil ob iskanju več kot 15 min mimo (searchDay).
  let candidatesTomorrow = false;
  // »Prihod do« največ 15 min mimo: prikazane so poti z odhodom zdaj, tu je izbrana ura za pojasnilo.
  let arriveLateTime: string | null = null;
  // Predizpolnjen cilj — iz gumba "pot do postajališča" (z imenom) ali long-pressa na karti (brez imena).
  // Nov objekt sproži apply (z reverse-geocode v ozadju, če ime manjka) + auto-run, ko sta oba dela zapolnjena.
  // `from`: izhodišče shranjene poti ali povezave, ki je ni bilo mogoče izračunati (F11).
  export let pendingDest: { lat: number; lon: number; name?: string; from?: Place } | null = null;
  let lastConsumedDest: typeof pendingDest = null;

  // Predlogi veljajo za poizvedbo, s katero so nastali. Sprememba izhodišča, cilja, časa ali
  // načina jih razveljavi, da pod novim vnosom ali napako ne ostanejo stari (F1).
  const placeSig = (p: Place | null, q: string) => p ? `${p.lat.toFixed(5)},${p.lon.toFixed(5)}` : `q:${q.trim()}`;
  function sigOf(fp: Place | null, fq: string, tp: Place | null, tq: string, tm: TimeMode, ts: string, m: Mode): string {
    return `${placeSig(fp, fq)}|${placeSig(tp, tq)}|${tm}|${tm === 'now' ? '' : ts}|${m}`;
  }
  // Iz trenutnih vrednosti, ne iz reaktivnega querySig: ta se po kliku na način osveži šele
  // po obdelavi dogodka, run() pa teče sinhrono v njem.
  const currentSig = () => sigOf(fromPlace, fromQuery, toPlace, toQuery, timeMode, timeStr, mode);
  $: querySig = sigOf(fromPlace, fromQuery, toPlace, toQuery, timeMode, timeStr, mode);
  let resultSig = '';
  $: if (querySig !== resultSig && !running && (candidates.length > 0 || error || transferWarn)) clearResults();
  function clearResults() {
    candidates = []; candidatesTomorrow = false; arriveLateTime = null; error = ''; statusMsg = ''; transferWarn = null;
  }

  // Hrani aktivno operacijo, da jo lahko prekličemo ob zapiranju, resetu ali novem run-u.
  let activeCtl: AbortController | null = null;
  function abortActive() {
    if (activeCtl) { activeCtl.abort(); activeCtl = null; }
    // Prekinjeno iskanje v finally indikatorja ne ugasne (ni več aktivno), zato ga ugasne
    // preklic — sicer je po zaprtju med iskanjem »Poišči pot« ostal onemogočen.
    running = false;
  }
  // Sistemski nazaj zapre okno mimo handleClose (App samo nastavi open = false). Izbrana pot,
  // ki je še čakala na pešpot, je zato sekundo pozneje sama odprla karto (pregled 12.10.2026).
  $: if (!open) abortActive();

  let timeMode: TimeMode = 'now';
  let timeExpanded = false;
  let timeStr: string = defaultTimeStr();

  function defaultTimeStr() {
    const n = nowMb();
    return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
  }
  $: timeModeLabel = timeMode === 'now' ? $t('Zdaj') : timeMode === 'depart' ? $t('Odhod ob {time}', { time: timeStr }) : $t('Prihod do {time}', { time: timeStr });
  // Oznaka »jutri« ob izbranem času že pred iskanjem. Ura se osveži ob odprtju in vsakih 30 s,
  // da oznaka ne zaostane, če okno ostane odprto čez mejo 15 min.
  let nowTick = nowSecMb();
  $: if (open) nowTick = nowSecMb();
  onMount(() => {
    const id = setInterval(() => { if (open) nowTick = nowSecMb(); }, 30_000);
    return () => clearInterval(id);
  });
  $: chipTomorrow = timeMode !== 'now' && searchDay(parseHM(timeStr), nowTick) === 'tomorrow';

  // Iskanje brez šumnikov in po besedah (»zelezniska« najde »Železniška«), enako kot v
  // Preprostem pogledu — prej je bil podniz z šumniki (evalvacija 04.10.2026, N7).
  $: fromResults = gtfs && fromFocus && !fromPlace && fromQuery.trim()
    ? searchStops(gtfs, fromQuery, 6)
    : [];
  $: toResults = gtfs && toFocus && !toPlace && toQuery.trim()
    ? searchStops(gtfs, toQuery, 6)
    : [];
  // Postajališči z istim imenom (par čez cesto) loči opis linij in smeri. Dvojnik se
  // išče med vsemi postajališči — med prikazanimi šestimi ga je rez lahko odrezal.
  function twinHint(_list: Stop[], s: Stop): string {
    return gtfs ? twinStopHint(gtfs, s) : '';
  }

  // Ob odprtju je izhodišče privzeto »Moja lokacija« — prej je bilo polje prazno, gumb
  // »Poišči pot« pa onemogočen brez pojasnila (evalvacija 04.10.2026, N4). Samo enkrat
  // na odprtje, da izbrisano polje ne skoči nazaj.
  //
  // `fromIsMe`: izhodišče je trenutna lega, ne posnetek ob odprtju. Okno ostane
  // naloženo tudi po izbiri poti, zato bi se sicer naslednjič računalo od tam, kjer je
  // bil uporabnik prejšnjič (pregled kode 05.10.2026).
  let fromIsMe = false;
  let prefilled = false;
  $: if (!open) prefilled = false;
  $: if (open && !prefilled) {
    prefilled = true;
    // Ob obstoječih predlogih (»Vsi predlogi« s karte) lega ostane, sicer bi jih premik razveljavil;
    // iskanje jo vzame sveže (run).
    if (hasGeo && ((!fromPlace && !fromQuery.trim()) || (fromIsMe && candidates.length === 0))) {
      fromPlace = { lat: origin.lat, lon: origin.lon, name: tr('Moja lokacija') };
      fromQuery = tr('Moja lokacija');
      fromIsMe = true;
    }
  }
  $: missingFrom = !fromPlace && !fromQuery.trim();
  $: missingTo = !toPlace && !toQuery.trim();
  $: favList = gtfs && $plannerShowFavs ? gtfs.stops.filter(s => $favStops.has(s.id)) : [];
  $: showFromFavs = fromFocus && !fromPlace && !fromQuery.trim() && favList.length > 0;
  $: showToFavs = toFocus && !toPlace && !toQuery.trim() && favList.length > 0;

  $: scheduleAddr('from', fromQuery, fromFocus, fromPlace);
  $: scheduleAddr('to', toQuery, toFocus, toPlace);

  // Seq token prepreci out-of-order: pocasnejsi Nominatim odgovor za starejsi
  // niz ne sme prepisati predlogov za novejsi vnos.
  let addrSeq: Record<'from' | 'to', number> = { from: 0, to: 0 };
  // Poizvedba Nominatim v teku za polje: nov vnos jo prekliče (F28).
  const addrCtl: Record<'from' | 'to', AbortController | null> = { from: null, to: null };

  function scheduleAddr(which: 'from' | 'to', q: string, focus: boolean, place: Place | null) {
    const timerRef = which === 'from' ? fromAddrTimer : toAddrTimer;
    if (timerRef) clearTimeout(timerRef);
    addrCtl[which]?.abort();
    addrCtl[which] = null;
    if (!focus || place || !q.trim() || q.trim().length < 3) {
      addrSeq[which]++; // razveljavi morebitni fetch v teku
      if (which === 'from') fromAddrResults = []; else toAddrResults = [];
      return;
    }
    const t = setTimeout(async () => {
      const myToken = ++addrSeq[which];
      const ctl = new AbortController();
      addrCtl[which] = ctl;
      const res = await geocodeMany(q.trim(), ctl.signal);
      if (myToken !== addrSeq[which] || ctl.signal.aborted) return; // medtem je bil sprozen novejsi
      if (which === 'from') fromAddrResults = res; else toAddrResults = res;
    }, 350);
    if (which === 'from') fromAddrTimer = t; else toAddrTimer = t;
  }

  const NOM_H = { 'Accept-Language': 'sl', 'User-Agent': 'MoHaMobil/0.5.1 (github.com/m1984m/MoHa-Mobil)' };
  const NOM_TIMEOUT_MS = 5000;
  // JSON iz Nominatima z omejitvijo 5 s in preklicem; ob napaki `fallback`. Prej brez omejitve:
  // počasen odgovor je zadržal predloge in iskanje (F28).
  async function nomJson(url: string, signal?: AbortSignal, fallback: any = null): Promise<any> {
    const c = new AbortController();
    const tid = setTimeout(() => c.abort(), NOM_TIMEOUT_MS);
    const stop = () => c.abort();
    signal?.addEventListener('abort', stop, { once: true });
    try {
      const r = await fetch(url, { headers: NOM_H, signal: c.signal });
      return r.ok ? await r.json() : fallback;
    } catch { return fallback; } finally {
      clearTimeout(tid);
      signal?.removeEventListener('abort', stop);
    }
  }

  const PLACE_TYPES = new Set(['city', 'town', 'village', 'hamlet', 'municipality', 'suburb', 'quarter', 'neighbourhood', 'isolated_dwelling', 'locality']);
  // Kraj, ulica in vrsta iz strukturiranega naslova Nominatim.
  function nomPlace(it: any): Place & { mb: boolean } {
    const a = it.address ?? {};
    const kraj = a.city || a.town || a.village || a.municipality || '';
    // Ustanova ali točka z lastnim imenom (»Prešernova koča na Stolu«) pod svojim imenom, ne pod
    // ulico (prej »Foreplay 67, Zabreznica«, ki ne pove, zakaj je zadetek tu; D1).
    const poi = it.name && !['highway', 'place', 'boundary', 'building'].includes(it.class) && it.name !== a.road;
    const ulica = poi ? String(it.name)
      : a.road ? `${a.road}${a.house_number ? ' ' + a.house_number : ''}` : String(it.display_name ?? '').split(',')[0].trim();
    const name = kraj && ulica !== kraj ? `${ulica}, ${kraj}` : ulica;
    const isTown = !a.road && (it.class === 'place' || it.class === 'boundary' || PLACE_TYPES.has(it.addresstype) || PLACE_TYPES.has(it.type));
    return { lat: parseFloat(it.lat), lon: parseFloat(it.lon), name, kind: isTown ? 'town' : 'addr', town: kraj || (isTown ? ulica : undefined), mb: kraj === 'Maribor' };
  }

  // Zadetek mora vsebovati vpisane besede (brez šumnikov, ujemanje začetka besede) v imenu,
  // ulici, hišni številki ali kraju. Nominatim je na »Prešernova« vrnil tudi »Čopova ulica,
  // Ljubljana« in »Foreplay 67, Zabreznica« (D1).
  function nomMatches(it: any, words: string[]): boolean {
    const a = it.address ?? {};
    const hay = normName([it.name, a.road, a.pedestrian, a.footway, a.square, a.house_number, a.city, a.town, a.village,
      a.municipality, a.suburb, a.hamlet, a.neighbourhood, a.quarter, a.amenity, a.shop, a.tourism, a.building]
      .filter(Boolean).join(' ')).split(' ');
    return words.every(w => hay.some(h => h.startsWith(w)));
  }

  async function geocodeMany(q: string, signal?: AbortSignal): Promise<Place[]> {
    try {
      // Cela Slovenija, Maribor ima prednost (viewbox brez omejitve). Prej je bil vsakemu iskanju
      // dodan », Maribor« in cilja zunaj mesta ni bilo mogoče najti.
      const si = loadIjppSi();
      // Dve poizvedbi: z viewboxom vrne Nominatim samo Maribor, brez njega mariborskih ulic ne
      // najde (»Prešernova« → samo Ljubljana). Najprej Maribor, nato ostala Slovenija.
      const NOM = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&countrycodes=si&addressdetails=1`;
      // Zaporedno, ne hkrati: pravila Nominatima dovolijo eno zahtevo naenkrat.
      const jMb = await nomJson(`${NOM}&limit=5&viewbox=15.55,46.60,15.75,46.50&bounded=1`, signal, []);
      if (signal?.aborted) return [];
      const jSi = await nomJson(`${NOM}&limit=8`, signal, []);
      if (signal?.aborted) return [];
      const words = normName(q).split(' ').filter(Boolean);
      const j = [...(Array.isArray(jMb) ? jMb : []), ...(Array.isArray(jSi) ? jSi : [])].filter(it => nomMatches(it, words));
      // »Prešernova ulica 5, Maribor«: ulica in kraj, Maribor prvi, drugi kraji pod njim (Matej 04.11.).
      const addr = j.map(nomPlace).filter((p, i, arr) => arr.findIndex(x => x.name === p.name) === i);
      // Medkrajevna postajališča (avtobusne in železniške postaje po Sloveniji) pred naslovi.
      const sd = await si;
      const st: Place[] = sd ? searchIjppStops(sd, q, 4).filter(x => outsideMaribor(x)) : [];
      const strip = ({ mb, ...p }: Place & { mb: boolean }) => p as Place;
      const all = [...addr.filter(a => a.mb).map(strip), ...st, ...addr.filter(a => !a.mb).map(strip)];
      return all.filter((x, i) => all.findIndex(y => y.name === x.name) === i).slice(0, 8);
    } catch { return []; }
  }

  function pickSavedRoute(r: { from: Place; to: Place }) {
    fromPlace = { ...r.from };
    toPlace = { ...r.to };
    fromQuery = r.from.name;
    toQuery = r.to.name;
    fromFocus = false;
    toFocus = false;
    run();
  }

  // Brisanje z možnostjo razveljavitve — prej je bil X nepovraten.
  function removeSaved(r: { id: string; label: string; from: Place; to: Place }) {
    savedRoutes.remove(r.id);
    toast.showUndo(tr('Pot odstranjena'), () => savedRoutes.add({ label: r.label, from: r.from, to: r.to }));
  }

  function pickFromAddr(p: Place) { fromPlace = p; fromQuery = p.name; fromFocus = false; fromAddrResults = []; fromIsMe = false; }
  function pickToAddr(p: Place) { toPlace = p; toQuery = p.name; toFocus = false; toAddrResults = []; }

  function useMyLocationAsFrom() {
    if (!hasGeo) return;
    fromPlace = { lat: origin.lat, lon: origin.lon, name: tr('Moja lokacija') };
    fromQuery = tr('Moja lokacija');
    fromFocus = false;
    fromIsMe = true;
  }
  function pickFrom(s: Stop) { fromPlace = { lat: s.lat, lon: s.lon, name: s.name, kind: 'stop' }; fromQuery = s.name; fromFocus = false; fromIsMe = false; }
  function pickTo(s: Stop) { toPlace = { lat: s.lat, lon: s.lon, name: s.name, kind: 'stop' }; toQuery = s.name; toFocus = false; }
  function swap() { const f = fromPlace, q = fromQuery; fromPlace = toPlace; fromQuery = toQuery; toPlace = f; toQuery = q; fromIsMe = false; }

  // Kratko ime in kraj točke (long-press na karti, »Moja lokacija« zunaj Maribora za prevoz.org).
  async function reverseGeocode(lat: number, lon: number, signal?: AbortSignal): Promise<{ name: string; town: string } | null> {
    const j = await nomJson(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=18&addressdetails=1`, signal);
    if (!j?.display_name) return null;
    const a = j.address ?? {};
    return {
      name: j.display_name.split(',').slice(0, 2).join(',').trim(),
      town: a.city || a.town || a.village || a.municipality || '',
    };
  }

  $: if (open && pendingDest && pendingDest !== lastConsumedDest) {
    lastConsumedDest = pendingDest;
    applyPendingDest(pendingDest);
  }

  async function applyPendingDest(d: { lat: number; lon: number; name?: string; from?: Place }) {
    const placeholder = d.name ?? tr('Izbrana lokacija ({lat}, {lon})', { lat: d.lat.toFixed(4), lon: d.lon.toFixed(4) });
    toPlace = { lat: d.lat, lon: d.lon, name: placeholder };
    toQuery = placeholder;
    toFocus = false;
    toAddrResults = [];
    // Shranjena pot ali povezava: izhodišče iz nje, ne trenutna lega (F11).
    if (d.from) {
      fromPlace = { ...d.from };
      fromQuery = d.from.name;
      fromFocus = false;
      fromIsMe = false;
    }
    // Avtomatsko zapolni izhodišče z lokacijo uporabnika, če je na voljo in še ni izbrano —
    // iz obeh vstopnih točk (long-press / "pot do postajališča") je "od moje lokacije" prevladujoča izbira.
    if (hasGeo && !fromPlace) {
      fromPlace = { lat: origin.lat, lon: origin.lon, name: tr('Moja lokacija') };
      fromQuery = tr('Moja lokacija');
      fromFocus = false;
      fromIsMe = true;
    }
    // Auto-run: če sta oba konca zapolnjena, takoj izračunaj — ena interakcija manj.
    // Uporabnik še vedno vidi rezultat in lahko prilagodi čas / znova poišče.
    if (fromPlace && toPlace) run();
    // Ime v ozadju dopolnimo (samo za long-press, kjer name manjka).
    if (!d.name) {
      const better = await reverseGeocode(d.lat, d.lon);
      if (better && toPlace && toPlace.lat === d.lat && toPlace.lon === d.lon) {
        toPlace = { ...toPlace, name: better.name, town: better.town || undefined, kind: 'addr' };
        toQuery = better.name;
      }
    }
  }

  async function geocode(q: string, signal?: AbortSignal): Promise<Place | null> {
    const j = await nomJson(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&countrycodes=si&limit=1&addressdetails=1&viewbox=15.55,46.60,15.75,46.50&bounded=0`, signal, []);
    if (!Array.isArray(j) || j.length === 0) return null;
    const p = nomPlace(j[0]);
    return { lat: p.lat, lon: p.lon, name: j[0].display_name.split(',').slice(0, 2).join(',').trim(), kind: p.kind, town: p.town };
  }

  async function run() {
    if (!gtfs) return;
    // Nadzor že pred geokodiranjem, da zaprtje okna prekine tudi to čakanje.
    abortActive();
    const ctl = new AbortController();
    activeCtl = ctl;
    running = true;
    // Stari predlogi ne ostanejo med novim iskanjem ali pod napako (F1).
    clearResults();
    resultSig = currentSig();
    try {
      // Trenutna lega ob iskanju, ne ob odprtju okna.
      if (fromIsMe && hasGeo) fromPlace = { lat: origin.lat, lon: origin.lon, name: tr('Moja lokacija'), town: fromPlace?.town };
      if (!fromPlace && fromQuery.trim()) {
        const ql = normName(fromQuery);
        const st = gtfs.stops.find(s => normName(s.name) === ql);
        fromPlace = st ? { lat: st.lat, lon: st.lon, name: st.name, kind: 'stop' } : await geocode(fromQuery.trim(), ctl.signal);
      }
      if (!toPlace && toQuery.trim()) {
        const ql = normName(toQuery);
        const st = gtfs.stops.find(s => normName(s.name) === ql);
        toPlace = st ? { lat: st.lat, lon: st.lon, name: st.name, kind: 'stop' } : await geocode(toQuery.trim(), ctl.signal);
      }
      if (ctl.signal.aborted) return;
      // Izhodišče in cilj sta zdaj razrešena v okviru tega iskanja.
      resultSig = currentSig();
      if (!fromPlace || !toPlace) { error = tr('Ne najdem izhodišča ali cilja.'); return; }
      // Kopiji: polji se med čakanjem na ORS lahko izpraznita (vnos v polje).
      const from = fromPlace, to = toPlace;
      // »Moja lokacija« zunaj Maribora: kraj za povezavo na prevoz.org v ozadju (F19).
      if (fromIsMe && outsideMaribor(from) && !from.town) {
        reverseGeocode(from.lat, from.lon).then(r => {
          if (r?.town && fromIsMe && fromPlace && fromPlace.lat === from.lat && fromPlace.lon === from.lon) {
            fromPlace = { ...fromPlace, town: r.town };
          }
        });
      }

      const res = await planTrip({ gtfs, from, to, mode, timeMode, timeStr, signal: ctl.signal });
      if (ctl.signal.aborted || (!res.ok && res.aborted)) return;
      if (!res.ok) { error = res.error; return; }
      candidates = res.plans;
      candidatesTomorrow = res.tomorrow;
      arriveLateTime = res.lateTime;
      statusMsg = tr('Najdenih poti: {n}', { n: res.plans.length });
    } catch (e: any) {
      if (e?.name === 'AbortError' || ctl.signal.aborted) return;
      error = tr('Napaka: {msg}', { msg: String(e?.message ?? e) });
    } finally {
      // running sprosti samo run, ki je še aktiven — sicer starejši finally
      // ugasne indikator novejšemu (double-run race ob auto-run + ročnem kliku).
      if (activeCtl === ctl) { activeCtl = null; running = false; }
    }
  }

  async function choosePlan(chosen: Plan) {
    if (!gtfs || !fromPlace || !toPlace) return;
    const from = fromPlace, to = toPlace;
    abortActive();
    const ctl = new AbortController();
    activeCtl = ctl;
    running = true;
    transferWarn = null;
    try {
      const m = await materializePlan(chosen, ctl.signal);
      if (!m || ctl.signal.aborted) return;
      // Z dejansko pešpotjo prestop ni več izvedljiv: pot se ne odpre tiho, uporabnik
      // izbere drugo ali jo vseeno pogleda (F4).
      if (m.issues.length > 0) {
        transferWarn = { plan: m.shown, geoms: m.geoms, from, to, issues: m.issues };
        return;
      }
      onShowPlan(m.shown, m.geoms, from, to);
      onClose();
    } catch (e: any) {
      if (e?.name === 'AbortError' || ctl.signal.aborted) return;
      throw e;
    } finally {
      if (activeCtl === ctl) { activeCtl = null; running = false; }
    }
  }

  function showWarnedPlan() {
    if (!transferWarn) return;
    const w = transferWarn;
    transferWarn = null;
    onShowPlan(w.plan, w.geoms, w.from, w.to);
    onClose();
  }

  function fmtDur(sec: number): string {
    const m = Math.round(sec / 60);
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)} h ${m % 60} min`;
  }
  function fmtTime(sec: number): string {
    const h = Math.floor(sec / 3600) % 24;
    const m = Math.floor((sec % 3600) / 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  function busLegs(p: Plan) { return p.legs.filter(l => l.kind === 'bus') as any[]; }
  // Odhod in prihod na kartici z oznako dneva: časi od polnoči dneva iskanja, jutrišnji + 24 h (F6).
  function depLabel(sec: number): string {
    return sec >= DAY_SEC ? tr('odhod jutri {time}', { time: fmtTime(sec) }) : tr('odhod {time}', { time: fmtTime(sec) });
  }
  function arrLabel(sec: number): string {
    return sec >= DAY_SEC ? tr('prihod jutri {time}', { time: fmtTime(sec) }) : tr('prihod {time}', { time: fmtTime(sec) });
  }
  const hasExt = (p: Plan) => p.legs.some(l => l.kind === 'bus' && l.route.id >= EXT);
  const hasCity = (p: Plan) => p.legs.some(l => l.kind === 'bus' && l.route.id < EXT);

  // Predlogi izhodišča in cilja kot combobox (WCAG 2.1.1): puščici, Enter, Escape, klik (F9).
  type Opt = { id: string; label: string; hint?: string; tag?: string; icon: 'me' | 'fav' | 'stop' | 'addr'; header?: string; pick: () => void };
  function buildOpts(which: 'from' | 'to', withMe: boolean, favs: Stop[], stops: Stop[], addrs: Place[]): Opt[] {
    const out: Opt[] = [];
    const pickStop = which === 'from' ? pickFrom : pickTo;
    const pickAddr = which === 'from' ? pickFromAddr : pickToAddr;
    if (withMe) out.push({ id: `pl-${which}-me`, label: tr('Moja lokacija'), icon: 'me', pick: useMyLocationAsFrom });
    favs.forEach((s, i) => out.push({ id: `pl-${which}-f${i}`, label: s.name, icon: 'fav', header: i === 0 ? tr('Priljubljena') : undefined, pick: () => pickStop(s) }));
    stops.forEach((s, i) => out.push({ id: `pl-${which}-s${i}`, label: s.name, hint: twinHint(stops, s) || undefined, tag: tr('postajališče'), icon: 'stop', pick: () => pickStop(s) }));
    addrs.forEach((p, i) => out.push({ id: `pl-${which}-a${i}`, label: p.name, tag: kindLabel(p.kind), icon: 'addr', pick: () => pickAddr(p) }));
    return out;
  }
  $: fromOpts = buildOpts('from', hasGeo, showFromFavs ? favList : [], fromResults, fromAddrResults);
  $: toOpts = buildOpts('to', false, showToFavs ? favList : [], toResults, toAddrResults);
  $: fromListOpen = fromFocus && !fromPlace && fromOpts.length > 0;
  $: toListOpen = toFocus && !toPlace && toOpts.length > 0;
  let fromActive = -1;
  let toActive = -1;
  $: if (fromOpts) fromActive = -1;
  $: if (toOpts) toActive = -1;
  let fromListEl: HTMLElement | undefined;
  let toListEl: HTMLElement | undefined;

  function comboKey(which: 'from' | 'to', e: KeyboardEvent) {
    const opts = which === 'from' ? fromOpts : toOpts;
    const isOpen = which === 'from' ? fromListOpen : toListOpen;
    let a = which === 'from' ? fromActive : toActive;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!opts.length) return;
      e.preventDefault();
      if (which === 'from') fromFocus = true; else toFocus = true;
      a = e.key === 'ArrowDown' ? (a + 1) % opts.length : (a <= 0 ? opts.length - 1 : a - 1);
      if (which === 'from') fromActive = a; else toActive = a;
      const id = opts[a].id;
      requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'nearest' }));
    } else if (e.key === 'Enter') {
      if (isOpen && a >= 0 && a < opts.length) { e.preventDefault(); opts[a].pick(); }
      else if (!running && !missingFrom && !missingTo) { e.preventDefault(); run(); }
    } else if (e.key === 'Escape' && isOpen) {
      // Zapre samo seznam, ne načrtovalnika.
      e.preventDefault();
      e.stopPropagation();
      if (which === 'from') { fromFocus = false; fromActive = -1; } else { toFocus = false; toActive = -1; }
    }
  }
  // Seznam se ob izgubi fokusa skrije, razen če fokus ostane v njem.
  function comboBlur(which: 'from' | 'to', e: FocusEvent) {
    const list = which === 'from' ? fromListEl : toListEl;
    if (list && e.relatedTarget instanceof Node && list.contains(e.relatedTarget)) return;
    setTimeout(() => { if (which === 'from') fromFocus = false; else toFocus = false; }, 150);
  }
  function optKey(o: Opt, e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); o.pick(); }
  }

  function reset() {
    abortActive();
    fromQuery = ''; toQuery = ''; fromPlace = null; toPlace = null; error = ''; candidates = []; fromIsMe = false;
    candidatesTomorrow = false; arriveLateTime = null; statusMsg = ''; transferWarn = null; resultSig = '';
    timeMode = 'now'; timeExpanded = false; timeStr = defaultTimeStr();
    lastConsumedDest = null;
  }

  function handleClose() { reset(); onClose(); }

  // Če je nad načrtovalnikom odprto drugo okno (npr. cene iz rezultatov), Escape zapre
  // samo to — prej je zaprl in ponastavil tudi načrtovalnik (pregled kode 05.10.2026).
  let rootEl: HTMLElement | undefined;
  function onKey(e: KeyboardEvent) {
    if (!open || e.key !== 'Escape') return;
    const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
    const top = dialogs[dialogs.length - 1];
    if (top && rootEl && top !== rootEl && !rootEl.contains(top)) return;
    handleClose();
  }
</script>

<svelte:window on:keydown={onKey} />

{#if open}
  <div in:backdrop={{ alpha: 0.35, blur: 4 }} out:backdrop={{ out: true, alpha: 0.35, blur: 4 }} class="fixed inset-0 z-50 flex flex-col" style="background: rgba(0,0,0,0.35); backdrop-filter: blur(4px);"
       role="dialog" aria-modal="true" aria-label={$t('Načrtuj pot')} bind:this={rootEl}>
    <div in:sheet={{ from: 'top' }} out:sheet={{ out: true, from: 'top' }} class="surface rounded-b-3xl shadow-float"
         style="padding-top: env(safe-area-inset-top); max-height: calc(100dvh - env(safe-area-inset-bottom)); overflow-y: auto; -webkit-overflow-scrolling: touch;"
         use:focusTrap>
      <div class="flex items-center justify-between px-4 pt-4 pb-2">
        <div class="t-title2">{$t('Načrtuj pot')}</div>
        <button class="pressable w-11 h-11 rounded-full surface-2 grid place-items-center" on:click={handleClose} aria-label={$t('Zapri')}>
          <X size={18} />
        </button>
      </div>

      <div class="px-4 pb-4 space-y-3">
        <!-- From -->
        <div class="relative">
          <div class="relative surface-2 rounded-xl border border-base">
            <MapPin size={18} color="var(--status-ontime)" class="absolute left-3 top-1/2 -translate-y-1/2" />
            <!-- Place se razveljavi ob dejanski spremembi besedila (input), NE ob fokusu —
                 tap v polje za pregled vnosa ne sme tiho zavreči izbranih koordinat. -->
            <input bind:value={fromQuery}
              role="combobox" aria-autocomplete="list" aria-label={$t('Izhodišče')}
              aria-expanded={fromListOpen} aria-controls="pl-from-list"
              aria-activedescendant={fromListOpen && fromActive >= 0 && fromOpts[fromActive] ? fromOpts[fromActive].id : undefined}
              on:focus={() => { fromFocus = true; }}
              on:input={() => { if (fromPlace) fromPlace = null; fromIsMe = false; fromFocus = true; }}
              on:keydown={(e) => comboKey('from', e)}
              on:blur={(e) => comboBlur('from', e)}
              class="w-full h-12 bg-transparent rounded-[inherit] pl-10 pr-3 t-body"
              placeholder={$t('Od — postajališče, naslov ali moja lokacija')} />
          </div>
          {#if fromListOpen}
            <!-- V toku dokumenta, NE absolutno: spustni seznam je bil znotraj vsebnika
                 z overflow-y:auto in se je odrezal na robu lista (od 6 zadetkov vidnih 2,5). -->
            <ul id="pl-from-list" role="listbox" aria-label={$t('Predlogi za izhodišče')} bind:this={fromListEl}
                class="mt-1 surface rounded-xl border border-base shadow-elev max-h-72 overflow-y-auto">
              {#each fromOpts as o, i (o.id)}
                {#if o.header}<li role="presentation" class="px-3 pt-2 pb-1 t-footnote text-muted uppercase tracking-wide">{o.header}</li>{/if}
                <li id={o.id} role="option" aria-selected={i === fromActive} tabindex="-1"
                    class="pressable w-full text-left px-3 py-3 t-body flex items-center gap-2 border-b border-base cursor-pointer"
                    class:pl-opt-active={i === fromActive}
                    on:mousedown={(e) => e.preventDefault()} on:click={o.pick} on:keydown={(e) => optKey(o, e)}>
                  {#if o.icon === 'me'}<Navigation size={16} color="var(--accent)" />
                  {:else if o.icon === 'fav'}<Star size={14} fill="var(--status-delay)" color="var(--status-delay)" />
                  {:else if o.icon === 'stop'}<MapPin size={14} color="var(--accent)" />
                  {:else}<MapPin size={14} color="var(--text-muted)" />{/if}
                  <span class="min-w-0" class:font-medium={o.icon === 'me'}>
                    <span class="block truncate">{o.label}</span>
                    {#if o.hint}<span class="block t-footnote text-muted truncate">{o.hint}</span>{/if}
                  </span>
                  {#if o.tag}<span class="ml-auto t-footnote text-muted shrink-0">{o.tag}</span>{/if}
                </li>
              {/each}
            </ul>
          {/if}
        </div>

        <!-- Swap button -->
        <div class="flex justify-end -my-1">
          <button class="pressable w-8 h-8 rounded-full surface-2 border border-base grid place-items-center" on:click={swap} aria-label={$t('Zamenjaj')}>
            <ArrowRightLeft size={14} />
          </button>
        </div>

        <!-- To -->
        <div class="relative">
          <div class="relative surface-2 rounded-xl border border-base">
            <Flag size={18} color="var(--status-disrupt)" class="absolute left-3 top-1/2 -translate-y-1/2" />
            <input bind:value={toQuery}
              role="combobox" aria-autocomplete="list" aria-label={$t('Cilj')}
              aria-expanded={toListOpen} aria-controls="pl-to-list"
              aria-activedescendant={toListOpen && toActive >= 0 && toOpts[toActive] ? toOpts[toActive].id : undefined}
              on:focus={() => { toFocus = true; }}
              on:input={() => { if (toPlace) toPlace = null; toFocus = true; }}
              on:keydown={(e) => comboKey('to', e)}
              on:blur={(e) => comboBlur('to', e)}
              class="w-full h-12 bg-transparent rounded-[inherit] pl-10 pr-3 t-body"
              placeholder={$t('Do — postajališče ali naslov')} />
          </div>
          {#if toListOpen}
            <ul id="pl-to-list" role="listbox" aria-label={$t('Predlogi za cilj')} bind:this={toListEl}
                class="mt-1 surface rounded-xl border border-base shadow-elev max-h-72 overflow-y-auto">
              {#each toOpts as o, i (o.id)}
                {#if o.header}<li role="presentation" class="px-3 pt-2 pb-1 t-footnote text-muted uppercase tracking-wide">{o.header}</li>{/if}
                <li id={o.id} role="option" aria-selected={i === toActive} tabindex="-1"
                    class="pressable w-full text-left px-3 py-3 t-body flex items-center gap-2 border-b border-base cursor-pointer"
                    class:pl-opt-active={i === toActive}
                    on:mousedown={(e) => e.preventDefault()} on:click={o.pick} on:keydown={(e) => optKey(o, e)}>
                  {#if o.icon === 'fav'}<Star size={14} fill="var(--status-delay)" color="var(--status-delay)" />
                  {:else if o.icon === 'stop'}<Flag size={14} color="var(--status-disrupt)" />
                  {:else}<Flag size={14} color="var(--text-muted)" />{/if}
                  <span class="min-w-0">
                    <span class="block truncate">{o.label}</span>
                    {#if o.hint}<span class="block t-footnote text-muted truncate">{o.hint}</span>{/if}
                  </span>
                  {#if o.tag}<span class="ml-auto t-footnote text-muted shrink-0">{o.tag}</span>{/if}
                </li>
              {/each}
            </ul>
          {/if}
        </div>

        <!-- Shranjene poti -->
        {#if $savedRoutes.length > 0 && candidates.length === 0}
          <div>
            <div class="t-footnote text-muted uppercase tracking-wide mb-2 px-1">{$t('Shranjene poti')}</div>
            <ul class="space-y-2">
              {#each $savedRoutes as r}
                <li class="surface-2 rounded-xl border border-base overflow-hidden flex items-stretch">
                  <button class="pressable flex-1 text-left px-3 py-2.5 min-w-0"
                          on:click={() => pickSavedRoute(r)}>
                    <div class="flex items-center gap-2 mb-0.5">
                      <RouteIcon size={14} color="var(--accent)" />
                      <div class="t-callout font-semibold truncate">{r.label}</div>
                    </div>
                    <div class="flex items-center gap-1.5 t-footnote text-muted min-w-0">
                      <span class="truncate">{r.from.name}</span>
                      <ArrowRight size={10} />
                      <span class="truncate">{r.to.name}</span>
                    </div>
                  </button>
                  <button class="pressable w-11 min-h-[44px] grid place-items-center border-l border-base shrink-0"
                          on:click={() => removeSaved(r)}
                          aria-label={$t('Odstrani shranjeno pot {label}', { label: r.label })}>
                    <X size={16} />
                  </button>
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        <!-- Time mode -->
        <div>
          <button class="pressable w-full surface-2 rounded-xl border border-base px-3 h-12 flex items-center gap-2"
                  on:click={() => timeExpanded = !timeExpanded}>
            <Clock size={16} color="var(--accent)" />
            <span class="t-body font-medium">{timeModeLabel}</span>
            {#if chipTomorrow}
              <span class="t-footnote rounded-full px-2 py-0.5 border border-base surface">{$t('jutri')}</span>
            {/if}
            <span class="ml-auto grid place-items-center transition-transform"
                  style="transform: rotate({timeExpanded ? 180 : 0}deg)"><ChevronDown size={20} color="var(--text-muted)" /></span>
          </button>
          {#if timeExpanded}
            <div class="surface-2 rounded-xl border border-base mt-2 p-3 space-y-3">
              <div class="grid grid-cols-3 gap-1 surface rounded-lg p-1">
                {#each [{id: 'now' as TimeMode, label: $t('Zdaj')}, {id: 'depart' as TimeMode, label: $t('Odhod ob')}, {id: 'arrive' as TimeMode, label: $t('Prihod do')}] as opt}
                  {@const a = timeMode === opt.id}
                  <button class="pressable h-9 rounded-md t-footnote font-semibold"
                          style="background: {a ? 'var(--accent)' : 'transparent'}; color: {a ? 'white' : 'var(--text)'}"
                          on:click={() => timeMode = opt.id}>{opt.label}</button>
                {/each}
              </div>
              {#if timeMode !== 'now'}
                <label class="flex items-center gap-3">
                  <span class="t-callout">{$t('Čas:')}</span>
                  <input type="time" bind:value={timeStr}
                         class="flex-1 h-11 surface rounded-lg border border-base px-3 t-body tabular-nums" />
                </label>
              {/if}
            </div>
          {/if}
        </div>

        {#if intercity}
          <div>
            <div class="t-footnote text-muted px-1 mb-1">{$t('Prevoz po Sloveniji')}</div>
            <div class="grid grid-cols-4 gap-1 surface-2 rounded-xl border border-base p-1" role="radiogroup" aria-label={$t('Prevoz po Sloveniji')}>
              {#each [{ id: 'all' as Mode, label: $t('Vse') }, { id: 'bus' as Mode, label: $t('Avtobus') }, { id: 'rail' as Mode, label: $t('Vlak') }, { id: 'busRail' as Mode, label: $t('Bus + vlak') }] as opt}
                {@const a = mode === opt.id}
                <button type="button" role="radio" aria-checked={a}
                        class="pressable min-h-[44px] rounded-lg t-footnote font-semibold"
                        style="background: {a ? 'var(--accent)' : 'transparent'}; color: {a ? 'white' : 'var(--text)'}"
                        on:click={() => { mode = opt.id; if (candidates.length || error) run(); }}>{opt.label}</button>
              {/each}
            </div>
          </div>
        {/if}

        <button class="pressable w-full h-12 rounded-xl bg-accent text-white t-headline disabled:opacity-60 flex items-center justify-center gap-2"
          disabled={(!fromPlace && !fromQuery.trim()) || (!toPlace && !toQuery.trim()) || running}
          aria-busy={running}
          on:click={run}>
          {#if running}
            <!-- Dostopno ime ostane med iskanjem (F23), pike so samo vizualne. -->
            <span class="sr-only">{$t('Iščem pot')}</span>
            <div class="w-2 h-2 rounded-full bg-white animate-bounce" aria-hidden="true"></div>
            <div class="w-2 h-2 rounded-full bg-white animate-bounce" style="animation-delay: 0.15s" aria-hidden="true"></div>
            <div class="w-2 h-2 rounded-full bg-white animate-bounce" style="animation-delay: 0.3s" aria-hidden="true"></div>
          {:else}
            {$t('Poišči pot')}
          {/if}
        </button>
        {#if !running && (missingFrom || missingTo)}
          <div class="t-footnote text-muted px-1 -mt-1">
            {missingFrom ? $t('Izberi, od kod greš.') : $t('Vpiši, kam greš.')}
          </div>
        {/if}

        <div class="sr-only" role="status">{statusMsg}</div>
        {#if error}
          <div class="t-footnote px-1" role="alert" style="color: var(--status-disrupt)">{error}</div>
        {/if}
        {#if transferWarn}
          <div class="surface-2 rounded-xl border p-3 space-y-2" role="alert" style="border-color: var(--status-delay)">
            {#each transferWarn.issues as is}
              <div class="t-footnote">
                {$t('Prestop {stop}: hoja traja {need} min, do odhoda je le {have} min. Ta prestop verjetno ne uspe.', { stop: is.stop, need: is.needMin, have: is.haveMin })}
              </div>
            {/each}
            <div class="flex gap-2">
              <button type="button" class="pressable flex-1 min-h-[44px] px-3 rounded-lg border border-base surface t-footnote font-semibold"
                      on:click={() => transferWarn = null}>{$t('Izberi drugo pot')}</button>
              <button type="button" class="pressable flex-1 min-h-[44px] px-3 rounded-lg border border-base surface t-footnote"
                      on:click={showWarnedPlan}>{$t('Vseeno pokaži')}</button>
            </div>
          </div>
        {/if}
        {#if prevozHref && !running && (error || candidates.length > 0)}
          <a href={prevozHref} target="_blank" rel="noopener noreferrer"
             class="pressable w-full min-h-[44px] px-3 rounded-xl border border-base surface-2 flex items-center gap-2 t-footnote">
            <RouteIcon size={16} color="var(--accent)" />
            <span class="text-left">{$t('Deljeni prevozi na prevoz.org')}</span>
          </a>
        {/if}

        {#if running && candidates.length === 0}
          <div class="space-y-2 pt-2">
            <Skeleton height="20px" width="40%" />
            <Skeleton height="48px" />
          </div>
        {/if}

        {#if candidates.length > 0}
          <div class="pt-1">
            <div class="flex items-center justify-between gap-2 mb-2 px-1">
              <div class="t-footnote text-muted uppercase tracking-wide">
                {$t('Predlogi poti')}{#if candidatesTomorrow} · {$t('jutri')}{/if}
              </div>
              <ReadAloud resetKey={candidates} text={() => candidatesSpeech(candidates)} />
            </div>
            {#if arriveLateTime}
              <div class="t-footnote text-muted px-1 mb-2">
                {$t('Prihod do {time} ni več mogoč, zato so prikazane poti z odhodom zdaj.', { time: arriveLateTime })}
              </div>
            {/if}
            <ul class="space-y-2">
              {#each candidates as p, i}
                <li>
                  <button class="pressable w-full text-left surface-2 rounded-xl border border-base p-3 flex items-start gap-3"
                          on:click={() => choosePlan(p)}>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-baseline gap-2">
                        <div class="t-title3 font-semibold">{fmtDur(p.arrSec - p.depSec)}</div>
                      </div>
                      <!-- Odhod in prihod z dnevom (»prihod jutri 01:04«), da se krajša vožnja loči od zgodnejšega prihoda (F6). -->
                      <div class="t-footnote font-medium tabular-nums">{depLabel(p.depSec)} · {arrLabel(p.arrSec)}</div>
                      <div class="t-footnote text-muted mb-1.5">
                        <!-- Prej »peš · 851 m peš« pri poti samo peš. -->
                        {#if p.transfers === 0 && busLegs(p).length === 0}{$t('samo peš, {m} m', { m: Math.round(p.walkMeters) })}
                        {:else}
                          {#if p.transfers === 0}{$t('brez prestopanja')}
                          {:else}{p.transfers} {plural(p.transfers, ['prestop', 'prestopa', 'prestopi', 'prestopov'], ['change', 'changes'])}
                          {/if}
                          {#if p.walkMeters > 0} · {$t('{m} m peš', { m: Math.round(p.walkMeters) })}{/if}
                        {/if}
                      </div>
                      <div class="flex flex-wrap gap-1.5">
                        {#each busLegs(p) as bl}
                          <LineBadge short={bl.route.short} routeId={bl.route.id} size="sm" />
                        {/each}
                      </div>
                    </div>
                    {#if i === 0}
                      <div class="shrink-0 t-footnote rounded-full px-2 py-0.5" style="background: var(--accent); color: white;">{$t('priporočeno')}</div>
                    {:else if p.lessWalk}
                      <div class="shrink-0 t-footnote rounded-full px-2 py-0.5 border border-base surface">{$t('manj hoje')}</div>
                    {/if}
                  </button>
                </li>
              {/each}
            </ul>
            <!-- Vir: načrt je po voznem redu, brez živih zamud (F12). -->
            <div class="t-footnote text-muted px-1 mt-2">{$t('Po voznem redu, zamude niso upoštevane.')}</div>
            {#if candidates.some(c => hasCity(c) || hasExt(c))}
              <!-- Cenik je samo mestni (Marprom); vlak in medkrajevni avtobus nista vključena (F18). -->
              <button type="button" class="pressable w-full mt-1 min-h-[44px] px-3 rounded-xl flex items-center gap-2 t-footnote text-muted"
                      on:click={onOpenFares}>
                <Ticket size={16} />
                <span class="text-left">{$t('Cenik mestnega prometa Marprom')}</span>
              </button>
              {#if candidates.some(hasExt)}
                <div class="t-footnote text-muted px-1">{$t('Cena vlaka in medkrajevnega avtobusa ni vključena.')}</div>
              {/if}
            {/if}
          </div>
        {/if}
      </div>
    </div>
    <button class="flex-1" on:click={handleClose} aria-label={$t('Zapri')}></button>
  </div>
{/if}

<style>
  /* Izbrani predlog s puščicami (combobox): viden obris, ker fokus ostane v polju. */
  .pl-opt-active { outline: 2px solid var(--accent); outline-offset: -2px; }
</style>
