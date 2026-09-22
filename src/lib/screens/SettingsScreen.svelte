<script lang="ts">
  import { onMount } from 'svelte';
  import { Sun, Moon, Monitor, Info, Database, Star, Map as MapIcon, Satellite, Building2, MapPinned, Home as HomeIcon, CalendarClock, Compass, Trash2, Timer, Clock, Rows3, Type, Contrast, Circle, Navigation, ExternalLink, AlarmClock, ChevronRight, Share2, MessageSquarePlus, Accessibility, ChartNoAxesColumn, Ticket, GraduationCap } from 'lucide-svelte';
  import Screen from '../ui/Screen.svelte';
  import ConfirmDialog from '../ui/ConfirmDialog.svelte';
  import { applyTheme, THEME_KEY, type Theme } from '../theme';
  import { plannerShowFavs, mapStyleKind, walkSpeedKmh, homeShowNearby, homeShowFavs, defaultTab, nearbyRadiusM, departureDisplay, compactLists, mapLabelSize, liveLocationWatch, seniorMode, analyticsEnabled, type MapStyleKind, type DefaultTab, type DepartureDisplay, type MapLabelSize } from '../settings';
  import { APP_VERSION, RELEASE_DATE, RELEASE_NOTES } from '../release';
  import { loadMeta, type GtfsMeta } from '../gtfs';
  import { disablePush } from '../push';
  import { toast } from '../toast';
  import { t, tr, lang, locale, type Lang } from '../i18n';
  import { restartOnboarding } from '../onboarding';

  export let theme: Theme;
  export let onOpenStats: () => void = () => {};
  export let onThemeChange: (t: Theme) => void;
  export let onOpenAlarms: () => void = () => {};
  export let onOpenFares: () => void = () => {};

  let gtfsMeta: GtfsMeta | null = null;
  onMount(async () => { gtfsMeta = await loadMeta(); });

  const DATE_FMT = new Intl.DateTimeFormat(locale(), { dateStyle: 'long' });
  $: gtfsBuiltLabel = gtfsMeta ? DATE_FMT.format(new Date(gtfsMeta.built)) : '';
  $: gtfsAgeDays = gtfsMeta ? Math.floor((Date.now() - new Date(gtfsMeta.built).getTime()) / 86_400_000) : 0;
  $: gtfsStale = gtfsMeta !== null && gtfsAgeDays > 30;

  const options: { id: Theme; label: string; icon: any }[] = [
    { id: 'light',    label: tr('Svetla'),         icon: Sun },
    { id: 'dark',     label: tr('Temna'),          icon: Moon },
    { id: 'auto',     label: tr('Samodejno'),      icon: Monitor },
    { id: 'contrast', label: tr('Visoki kontrast'), icon: Contrast },
    { id: 'mono',     label: tr('Črno-belo'),      icon: Circle },
  ];

  const mapOptions: { id: MapStyleKind; label: string; icon: any }[] = [
    { id: 'map', label: tr('Zemljevid'), icon: MapIcon },
    { id: 'satellite', label: tr('Satelit'), icon: Satellite },
  ];

  const speedOptions: { v: number; label: string; sub: string }[] = [
    { v: 3, label: '3 km/h', sub: tr('počasi') },
    { v: 4, label: '4 km/h', sub: tr('povprečno') },
    { v: 5, label: '5 km/h', sub: tr('hitro') },
  ];

  const defaultTabOptions: { id: DefaultTab; label: string; icon: any }[] = [
    { id: 'home', label: tr('Dom'), icon: HomeIcon },
    { id: 'timetables', label: tr('Vozni redi'), icon: CalendarClock },
    { id: 'map', label: tr('Karta'), icon: MapIcon },
    { id: 'fav', label: tr('Priljub.'), icon: Star },
  ];

  const radiusOptions: { v: number; label: string; sub: string }[] = [
    { v: 300,  label: '300 m', sub: tr('ozko') },
    { v: 500,  label: '500 m', sub: tr('običajno') },
    { v: 1000, label: '1 km',  sub: tr('široko') },
  ];

  const departureOptions: { id: DepartureDisplay; label: string; sub: string; icon: any }[] = [
    { id: 'minutes', label: tr('Minute'), sub: tr('do odhoda'), icon: Timer },
    { id: 'clock',   label: tr('Ura'),    sub: 'HH:MM',      icon: Clock },
    { id: 'both',    label: tr('Oboje'),  sub: tr('min + ura'),  icon: CalendarClock },
  ];

  const labelSizeOptions: { id: MapLabelSize; label: string }[] = [
    { id: 'small',  label: tr('Manjši') },
    { id: 'medium', label: tr('Srednji') },
    { id: 'large',  label: tr('Večji') },
  ];

  // Oznaki jezikov se ne prevajata: vsak jezik je zapisan v sebi, da ga najde
  // tudi nekdo, ki drugega jezika ne bere.
  const langOptions: { id: Lang; label: string }[] = [
    { id: 'sl', label: 'Slovenščina' },
    { id: 'en', label: 'English' },
  ];

  function pick(t: Theme) {
    applyTheme(t);
    onThemeChange(t);
  }

  let clearConfirmOpen = false;

  // Skriti vhod v statistiko: deset dotikov na ime razvijalca. Števec se
  // ponastavi, če je med dotikoma več kot sekunda in pol — tako ga naključno
  // drsanje po seznamu ne sproži.
  const DOTIKOV = 10;
  let dotiki = 0;
  let zadnjiDotik = 0;
  function dotikImena() {
    const zdaj = Date.now();
    dotiki = (zdaj - zadnjiDotik > 1500) ? 1 : dotiki + 1;
    zadnjiDotik = zdaj;
    const ostane = DOTIKOV - dotiki;
    if (ostane === 0) {
      dotiki = 0;
      onOpenStats();
    } else if (ostane <= 3) {
      toast.show(tr('Še {n} …', { n: ostane }));
    }
  }
  let clearing = false;

  async function clearAllData() {
    if (clearing) return;
    clearing = true;
    // Naročnina na obvestila in vrsta zvonjenj na strežniku preživita brisanje
    // localStorage — brez odjave bi telefon še tedne zvonil za opomnike, ki jih
    // v aplikaciji ni več nikjer videti.
    try { await disablePush(); } catch {}
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('mm.')) keysToRemove.push(k);
      }
      for (const k of keysToRemove) localStorage.removeItem(k);
      // Tema se ne drži predpone 'mm.' — brez tega je preživela "ponastavitev vseh nastavitev".
      localStorage.removeItem(THEME_KEY);
      try { sessionStorage.removeItem('mm_tab'); } catch {}
    } catch {}
    location.reload();
  }

  // Deljenje in predlogi ------------------------------------------------------
  // Povezava je namenoma trdo zapisana na produkcijski naslov: v razvoju ali z
  // lokalnega strežnika bi location.href dal naslov, ki ga prejemnik ne more odpreti.
  const APP_URL = 'https://m1984m.github.io/MoHa-Mobil/';
  const FEEDBACK_EMAIL = 'matej.moharic@gmail.com';

  let sharing = false;

  async function shareApp() {
    if (sharing) return;
    sharing = true;
    const data = { title: 'MoHa Mobil', text: tr('Vozni redi in živi prihodi mariborskih avtobusov.'), url: APP_URL };
    try {
      // Web Share API ponudi sistemski list (WhatsApp, SMS, pošta). Na namizju ga
      // večina brskalnikov nima, zato je kopiranje povezave enakovredna pot, ne napaka.
      if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
        await navigator.share(data);
        return;
      }
    } catch (e: any) {
      // Uporabnik je list zaprl — to ni napaka in ne sme sprožiti nadomestnega kopiranja.
      if (e?.name === 'AbortError') return;
    } finally {
      sharing = false;
    }
    try {
      await navigator.clipboard.writeText(APP_URL);
      toast.show(tr('Povezava kopirana'));
    } catch {
      // clipboard zahteva varen kontekst; če ga ni, naj uporabnik povezavo vsaj vidi.
      toast.show(APP_URL);
    }
  }

  // Podatki o različici in napravi so v telesu sporočila, ker brez njih predlog
  // pogosto ni razumljiv (npr. »gumba ni« na stari različici v predpomnilniku).
  $: feedbackHref = 'mailto:' + FEEDBACK_EMAIL
    + '?subject=' + encodeURIComponent('MoHa Mobil — predlog izboljšave')
    + '&body=' + encodeURIComponent(
        'Kaj bi rad izboljšal?\n\n\n'
        + '-- podatki za razvijalca --\n'
        + 'Različica: ' + APP_VERSION + '\n'
        + 'Vozni redi: ' + (gtfsBuiltLabel || 'neznano') + '\n'
        + 'Naprava: ' + (typeof navigator !== 'undefined' ? navigator.userAgent : 'neznano') + '\n'
      );
</script>

<Screen title={$t('Nastavitve')}>
  <div class="px-4 max-w-screen-sm mx-auto space-y-8 pt-1">

    <section>
      <div class="t-footnote text-muted uppercase tracking-wider font-semibold mb-2.5 px-2">{$t('Izgled')}</div>
      <div class="surface rounded-2xl border border-base overflow-hidden shadow-card p-2 mb-3">
        <div class="t-footnote text-muted px-2 pt-1 pb-2">{$t('Jezik')}</div>
        <div class="flex gap-2">
          {#each langOptions as o}
            {@const active = $lang === o.id}
            <button class="pressable flex-1 min-h-[48px] rounded-xl flex items-center justify-center t-body transition-colors"
                    style="background: {active ? 'var(--accent)' : 'transparent'}; color: {active ? 'white' : 'var(--text)'}"
                    lang={o.id}
                    aria-pressed={active}
                    on:click={() => lang.set(o.id)}>
              <span class="{active ? 'font-semibold' : ''}">{o.label}</span>
            </button>
          {/each}
        </div>
      </div>
      <ul class="surface rounded-2xl border border-base overflow-hidden shadow-card">
        {#each options as o, i}
          {@const active = theme === o.id}
          <button class="pressable w-full min-h-[60px] px-4 py-3 flex items-center gap-3.5 text-left {i < options.length - 1 ? 'border-b border-base' : ''}"
                  on:click={() => pick(o.id)}>
            <svelte:component this={o.icon} size={20} color={active ? 'var(--accent)' : 'var(--text-muted)'} strokeWidth={active ? 2.2 : 1.75} />
            <div class="flex-1 t-body {active ? 'font-semibold' : ''}">{o.label}</div>
            {#if active}
              <div class="w-5 h-5 rounded-full bg-accent grid place-items-center">
                <div class="w-2 h-2 rounded-full bg-white"></div>
              </div>
            {/if}
          </button>
        {/each}
      </ul>

      <ul class="surface rounded-2xl border border-base overflow-hidden shadow-card mt-3">
        <li class="min-h-[60px] px-4 py-3 flex items-center gap-3.5">
          <Accessibility size={20} color={$seniorMode ? 'var(--accent)' : 'var(--text-muted)'} strokeWidth={$seniorMode ? 2.2 : 1.75} />
          <div class="flex-1">
            <div class="t-body {$seniorMode ? 'font-semibold' : ''}">{$t('Način za starejše')}</div>
            <div class="t-footnote text-muted mt-0.5">
              {$t('Večje besedilo in gumbi, močnejši kontrast, manj vsebine na zaslon. Pri odhodih je v ospredju končna postaja.')}
            </div>
          </div>
          <button class="pressable mm-tap44 relative w-12 h-7 rounded-full transition-colors shrink-0"
                  style="background: {$seniorMode ? 'var(--accent)' : 'var(--surface-3)'}"
                  on:click={() => seniorMode.update(v => !v)}
                  aria-label={$t('Preklopi način za starejše')}
                  aria-pressed={$seniorMode}>
            <span class="absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-card transition-all"
                  style="left: {$seniorMode ? '1.375rem' : '0.125rem'}"></span>
          </button>
        </li>
      </ul>
    </section>

    <section>
      <div class="t-footnote text-muted uppercase tracking-wider font-semibold mb-2.5 px-2">{$t('Zagon')}</div>
      <div class="surface rounded-2xl border border-base overflow-hidden shadow-card p-2">
        <div class="t-footnote text-muted px-2 pt-1 pb-2">{$t('Privzeti zavihek ob zagonu')}</div>
        <div class="flex gap-2">
          {#each defaultTabOptions as o}
            {@const active = $defaultTab === o.id}
            <button class="pressable flex-1 min-h-[52px] rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors"
                    style="background: {active ? 'var(--accent)' : 'transparent'}; color: {active ? 'white' : 'var(--text)'}"
                    on:click={() => defaultTab.set(o.id)}>
              <svelte:component this={o.icon} size={18} />
              <span class="t-footnote {active ? 'font-semibold' : ''}">{o.label}</span>
            </button>
          {/each}
        </div>
      </div>
    </section>

    <section>
      <div class="t-footnote text-muted uppercase tracking-wider font-semibold mb-2.5 px-2">{$t('Dom')}</div>
      <ul class="surface rounded-2xl border border-base overflow-hidden shadow-card">
        <li class="min-h-[60px] px-4 py-3 flex items-center gap-3.5">
          <MapPinned size={20} color="var(--text-muted)" />
          <div class="flex-1">
            <div class="t-body">{$t('Najbližja postajališča')}</div>
            <div class="t-footnote text-muted mt-0.5">{$t('Prikaži postaje v bližini tvoje lokacije')}</div>
          </div>
          <button class="pressable mm-tap44 relative w-12 h-7 rounded-full transition-colors"
                  style="background: {$homeShowNearby ? 'var(--accent)' : 'var(--surface-3)'}"
                  on:click={() => homeShowNearby.update(v => !v)}
                  aria-label={$t('Preklopi bližnja postajališča')}>
            <span class="absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-card transition-all"
                  style="left: {$homeShowNearby ? '1.375rem' : '0.125rem'}"></span>
          </button>
        </li>
        {#if $homeShowNearby}
          <li class="px-4 py-4 border-t border-base">
            <div class="flex items-center gap-3.5 mb-3">
              <Compass size={20} color="var(--text-muted)" />
              <div class="flex-1">
                <div class="t-body">{$t('Radij iskanja')}</div>
                <div class="t-footnote text-muted mt-0.5">{$t('Oddaljenost iskanja bližnjih postaj')}</div>
              </div>
            </div>
            <div class="flex gap-2">
              {#each radiusOptions as r}
                {@const a = $nearbyRadiusM === r.v}
                <button class="pressable flex-1 min-h-[44px] rounded-xl flex flex-col items-center justify-center gap-0.5"
                        style="background: {a ? 'var(--accent)' : 'var(--surface-2)'}; color: {a ? 'white' : 'var(--text)'}"
                        on:click={() => nearbyRadiusM.set(r.v)}>
                  <span class="t-subhead {a ? 'font-semibold' : ''}">{r.label}</span>
                  <span class="t-footnote" style="opacity: 0.85">{r.sub}</span>
                </button>
              {/each}
            </div>
          </li>
        {/if}
        <li class="min-h-[60px] px-4 py-3 flex items-center gap-3.5 border-t border-base">
          <Star size={20} color="var(--status-delay)" fill="var(--status-delay)" />
          <div class="flex-1">
            <div class="t-body">{$t('Priljubljena postajališča')}</div>
            <div class="t-footnote text-muted mt-0.5">{$t('Prikaži shranjene postaje s tvojega seznama')}</div>
          </div>
          <button class="pressable mm-tap44 relative w-12 h-7 rounded-full transition-colors"
                  style="background: {$homeShowFavs ? 'var(--accent)' : 'var(--surface-3)'}"
                  on:click={() => homeShowFavs.update(v => !v)}
                  aria-label={$t('Preklopi priljubljena postajališča')}>
            <span class="absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-card transition-all"
                  style="left: {$homeShowFavs ? '1.375rem' : '0.125rem'}"></span>
          </button>
        </li>
      </ul>
    </section>

    <section>
      <div class="t-footnote text-muted uppercase tracking-wider font-semibold mb-2.5 px-2">{$t('Odhodi')}</div>
      <div class="surface rounded-2xl border border-base overflow-hidden shadow-card p-2">
        <div class="t-footnote text-muted px-2 pt-1 pb-2">{$t('Prikaz časa odhoda')}</div>
        <div class="flex gap-2">
          {#each departureOptions as o}
            {@const active = $departureDisplay === o.id}
            <button class="pressable flex-1 min-h-[56px] rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors"
                    style="background: {active ? 'var(--accent)' : 'transparent'}; color: {active ? 'white' : 'var(--text)'}"
                    on:click={() => departureDisplay.set(o.id)}>
              <svelte:component this={o.icon} size={18} />
              <span class="t-subhead {active ? 'font-semibold' : ''}">{o.label}</span>
              <span class="t-footnote" style="opacity: 0.85">{o.sub}</span>
            </button>
          {/each}
        </div>
      </div>
      <ul class="surface rounded-2xl border border-base overflow-hidden shadow-card mt-4">
        <li class="min-h-[60px] px-4 py-3 flex items-center gap-3.5">
          <Rows3 size={20} color="var(--text-muted)" />
          <div class="flex-1">
            <div class="t-body">{$t('Kompaktni seznami')}</div>
            <div class="t-footnote text-muted mt-0.5">{$t('Manjše vrstice, več vsebine na ekran')}</div>
          </div>
          <button class="pressable mm-tap44 relative w-12 h-7 rounded-full transition-colors"
                  style="background: {$compactLists ? 'var(--accent)' : 'var(--surface-3)'}"
                  on:click={() => compactLists.update(v => !v)}
                  aria-label={$t('Preklopi kompakten prikaz')}>
            <span class="absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-card transition-all"
                  style="left: {$compactLists ? '1.375rem' : '0.125rem'}"></span>
          </button>
        </li>
      </ul>
    </section>

    <section>
      <div class="t-footnote text-muted uppercase tracking-wider font-semibold mb-2.5 px-2">{$t('Karta')}</div>
      <div class="surface rounded-2xl border border-base overflow-hidden shadow-card p-2 flex gap-1.5">
        {#each mapOptions as o}
          {@const active = $mapStyleKind === o.id}
          <button class="pressable flex-1 min-h-[48px] rounded-xl flex items-center justify-center gap-2 t-body transition-colors"
                  style="background: {active ? 'var(--accent)' : 'transparent'}; color: {active ? 'white' : 'var(--text)'}"
                  on:click={() => mapStyleKind.set(o.id)}>
            <svelte:component this={o.icon} size={18} />
            <span class="{active ? 'font-semibold' : ''}">{o.label}</span>
          </button>
        {/each}
      </div>
      <ul class="surface rounded-2xl border border-base overflow-hidden shadow-card mt-4">
        <li class="px-4 py-4">
          <div class="flex items-center gap-3.5 mb-3">
            <Type size={20} color="var(--text-muted)" />
            <div class="flex-1">
              <div class="t-body">{$t('Velikost napisov')}</div>
              <div class="t-footnote text-muted mt-0.5">{$t('Imena cest in naselij na karti')}</div>
            </div>
          </div>
          <div class="flex gap-2">
            {#each labelSizeOptions as o}
              {@const active = $mapLabelSize === o.id}
              <button class="pressable flex-1 min-h-[44px] rounded-xl flex items-center justify-center"
                      style="background: {active ? 'var(--accent)' : 'var(--surface-2)'}; color: {active ? 'white' : 'var(--text)'}"
                      on:click={() => mapLabelSize.set(o.id)}>
                <span class="t-subhead {active ? 'font-semibold' : ''}" style="font-size: {o.id === 'small' ? '0.82rem' : o.id === 'large' ? '1.1rem' : '0.95rem'}">{o.label}</span>
              </button>
            {/each}
          </div>
        </li>
        <li class="min-h-[60px] px-4 py-3 flex items-center gap-3.5 border-t border-base">
          <Navigation size={20} color="var(--text-muted)" />
          <div class="flex-1">
            <div class="t-body">{$t('Sledi moji lokaciji v živo')}</div>
            <div class="t-footnote text-muted mt-0.5">{$t('Porabi več baterije. Ob izklopu se pozicija osveži le ob zagonu aplikacije.')}</div>
          </div>
          <button class="pressable mm-tap44 relative w-12 h-7 rounded-full transition-colors shrink-0"
                  style="background: {$liveLocationWatch ? 'var(--accent)' : 'var(--surface-3)'}"
                  on:click={() => liveLocationWatch.update(v => !v)}
                  aria-label={$t('Preklopi sledenje lokaciji v živo')}>
            <span class="absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-card transition-all"
                  style="left: {$liveLocationWatch ? '1.375rem' : '0.125rem'}"></span>
          </button>
        </li>
      </ul>
    </section>

    <section>
      <div class="t-footnote text-muted uppercase tracking-wider font-semibold mb-2.5 px-2">{$t('Načrtovanje poti')}</div>
      <ul class="surface rounded-2xl border border-base overflow-hidden shadow-card">
        <li class="min-h-[60px] px-4 py-3 flex items-center gap-3.5">
          <Star size={20} color="var(--status-delay)" fill="var(--status-delay)" />
          <div class="flex-1">
            <div class="t-body">{$t('Predlagaj priljubljena')}</div>
            <div class="t-footnote text-muted mt-0.5">{$t('V Od/Do seznamu prikaži priljubljena postajališča')}</div>
          </div>
          <button class="pressable mm-tap44 relative w-12 h-7 rounded-full transition-colors"
                  style="background: {$plannerShowFavs ? 'var(--accent)' : 'var(--surface-3)'}"
                  on:click={() => plannerShowFavs.update(v => !v)}
                  aria-label={$t('Preklopi predlog priljubljenih')}>
            <span class="absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-card transition-all"
                  style="left: {$plannerShowFavs ? '1.375rem' : '0.125rem'}"></span>
          </button>
        </li>
        <li class="px-4 py-4 border-t border-base">
          <div class="t-body">{$t('Hitrost hoje')}</div>
          <div class="t-footnote text-muted mt-0.5 mb-3">{$t('Uporabi se za izračun pešpoti v načrtovalcu')}</div>
          <div class="flex gap-2">
            {#each speedOptions as s}
              {@const a = $walkSpeedKmh === s.v}
              <button class="pressable flex-1 min-h-[44px] rounded-xl flex flex-col items-center justify-center gap-0.5"
                      style="background: {a ? 'var(--accent)' : 'var(--surface-2)'}; color: {a ? 'white' : 'var(--text)'}"
                      on:click={() => walkSpeedKmh.set(s.v)}>
                <span class="t-subhead {a ? 'font-semibold' : ''}">{s.label}</span>
                <span class="t-footnote" style="opacity: 0.85">{s.sub}</span>
              </button>
            {/each}
          </div>
        </li>
      </ul>
    </section>

    <section>
      <div class="t-footnote text-muted uppercase tracking-wider font-semibold mb-2.5 px-2">{$t('Pomoč')}</div>
      <ul class="surface rounded-2xl border border-base overflow-hidden shadow-card">
        <li class="border-b border-base">
          <button class="pressable w-full min-h-[60px] px-4 py-3 flex items-center gap-3.5 text-left"
                  on:click={onOpenFares}>
            <Ticket size={20} color="var(--text-muted)" />
            <div class="flex-1">
              <div class="t-body">{$t('Cene in vozovnice')}</div>
              <div class="t-footnote text-muted mt-0.5">{$t('Cenik Marproma in kje kupiti vozovnico')}</div>
            </div>
            <ChevronRight size={16} color="var(--text-muted)" />
          </button>
        </li>
        <li>
          <button class="pressable w-full min-h-[60px] px-4 py-3 flex items-center gap-3.5 text-left"
                  on:click={restartOnboarding}>
            <GraduationCap size={20} color="var(--text-muted)" />
            <div class="flex-1">
              <div class="t-body">{$t('Vodnik po aplikaciji')}</div>
              <div class="t-footnote text-muted mt-0.5">{$t('Znova pokaži uvodne kartice in namige')}</div>
            </div>
            <ChevronRight size={16} color="var(--text-muted)" />
          </button>
        </li>
      </ul>
    </section>

    <section>
      <div class="t-footnote text-muted uppercase tracking-wider font-semibold mb-2.5 px-2">{$t('Obvestila')}</div>
      <ul class="surface rounded-2xl border border-base overflow-hidden shadow-card">
        <li>
          <button class="pressable w-full min-h-[60px] px-4 py-3 flex items-center gap-3.5 text-left"
                  on:click={onOpenAlarms}
                  aria-label={$t('Odpri opomnike za odhod')}>
            <AlarmClock size={20} color="var(--text-muted)" />
            <div class="flex-1">
              <div class="t-body">{$t('Opomniki za odhod')}</div>
              <div class="t-footnote text-muted mt-0.5">{$t('Opozorilo nekaj minut pred odhodom pripete linije')}</div>
            </div>
            <ChevronRight size={16} color="var(--text-muted)" />
          </button>
        </li>
      </ul>
    </section>

    <section>
      <div class="t-footnote text-muted uppercase tracking-wider font-semibold mb-2.5 px-2">{$t('Podatki')}</div>
      <ul class="surface rounded-2xl border border-base overflow-hidden shadow-card">
        <li class="min-h-[60px] px-4 py-3 flex items-center gap-3.5 border-b border-base">
          <ChartNoAxesColumn size={20} color="var(--text-muted)" />
          <div class="flex-1">
            <div class="t-body">{$t('Anonimno štetje uporabe')}</div>
            <div class="t-footnote text-muted mt-0.5">
              {$t('Koliko ljudi aplikacijo uporablja in kateri zasloni. Brez piškotkov, brez lokacije in brez podatka, ki bi te prepoznal.')}
            </div>
          </div>
          <button class="pressable mm-tap44 relative w-12 h-7 rounded-full transition-colors shrink-0"
                  style="background: {$analyticsEnabled ? 'var(--accent)' : 'var(--surface-3)'}"
                  on:click={() => analyticsEnabled.update(v => !v)}
                  aria-label={$t('Preklopi anonimno štetje uporabe')}
                  aria-pressed={$analyticsEnabled}>
            <span class="absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-card transition-all"
                  style="left: {$analyticsEnabled ? '1.375rem' : '0.125rem'}"></span>
          </button>
        </li>
        <li class="px-4">
          <button class="pressable w-full min-h-[60px] py-3 flex items-center gap-3.5 text-left"
                  on:click={() => clearConfirmOpen = true}>
            <Trash2 size={20} color="var(--status-disrupt)" />
            <div class="flex-1">
              <div class="t-body" style="color: var(--status-disrupt)">{$t('Počisti vse podatke')}</div>
              <div class="t-footnote text-muted mt-0.5">{$t('Odstrani priljubljene, opomnike za odhod, shranjene poti in ponastavi nastavitve')}</div>
            </div>
          </button>
        </li>
      </ul>
    </section>

    <section>
      <div class="t-footnote text-muted uppercase tracking-wider font-semibold mb-2.5 px-2">{$t('Deli in predlagaj')}</div>
      <ul class="surface rounded-2xl border border-base overflow-hidden shadow-card">
        <li class="border-b border-base">
          <button class="pressable w-full min-h-[60px] px-4 py-3 flex items-center gap-3.5 text-left"
                  on:click={shareApp}
                  aria-label={$t('Deli povezavo do aplikacije')}>
            <Share2 size={20} color="var(--text-muted)" />
            <div class="flex-1">
              <div class="t-body">{$t('Deli aplikacijo')}</div>
              <div class="t-footnote text-muted mt-0.5">{$t('Pošlji povezavo prijateljem — aplikacija je brezplačna in brez prijave')}</div>
            </div>
            <ChevronRight size={16} color="var(--text-muted)" />
          </button>
        </li>
        <li>
          <a class="pressable min-h-[60px] px-4 py-3 flex items-center gap-3.5"
             href={feedbackHref}>
            <MessageSquarePlus size={20} color="var(--text-muted)" />
            <div class="flex-1">
              <div class="t-body">{$t('Predlagaj izboljšavo')}</div>
              <div class="t-footnote text-muted mt-0.5">{$t('Odpre sporočilo razvijalcu — napiši, kaj manjka ali ne dela')}</div>
            </div>
            <ExternalLink size={16} color="var(--text-muted)" />
          </a>
        </li>
      </ul>
    </section>

    <section>
      <div class="t-footnote text-muted uppercase tracking-wider font-semibold mb-2.5 px-2">{$t('O aplikaciji')}</div>
      <ul class="surface rounded-2xl border border-base overflow-hidden shadow-card">
        <li class="min-h-[60px] px-4 py-3 flex items-center gap-3.5 border-b border-base">
          <Info size={20} color="var(--text-muted)" />
          <div class="flex-1 t-body">{$t('Različica')}</div>
          <div class="t-footnote text-muted">{APP_VERSION}</div>
        </li>
        <li class="min-h-[60px] px-4 py-3 flex items-center gap-3.5 border-b border-base">
          <Database size={20} color="var(--text-muted)" />
          <div class="flex-1 t-body">{$t('Podatki')}</div>
          <div class="t-footnote text-muted">GTFS Marprom</div>
        </li>
        {#if gtfsMeta}
          <li class="min-h-[60px] px-4 py-3 flex items-center gap-3.5 border-b border-base">
            <CalendarClock size={20} color={gtfsStale ? 'var(--status-delay)' : 'var(--text-muted)'} />
            <div class="flex-1 t-body">{$t('Vozni redi')}</div>
            <div class="t-footnote" style="color: {gtfsStale ? 'var(--status-delay)' : 'var(--text-muted)'}">{gtfsBuiltLabel}</div>
          </li>
        {/if}
        <li>
          <!-- Deset dotikov na ime odpre skriti zaslon s statistiko. Vhod je
               skrit samo zato, da ni na poti; varuje ga ključ, ne skrivanje. -->
          <button type="button"
                  class="w-full min-h-[60px] px-4 py-3 flex items-center gap-3.5 text-left"
                  style="touch-action: manipulation;"
                  on:click={dotikImena}>
            <Building2 size={20} color="var(--text-muted)" />
            <div class="flex-1 t-body">{$t('Razvijalec')}</div>
            <div class="t-footnote text-muted">Matej</div>
          </button>
        </li>
      </ul>
      <p class="mt-3 px-2 t-footnote text-muted leading-relaxed">{$t('Vozni redi: GTFS Marprom. Zemljevidi: © OpenStreetMap, © CARTO. Satelitski posnetki: © Esri. Pešpoti: openrouteservice.org. Vreme: Open-Meteo.')} {$t('Kolesa: MBajk / JCDecaux.')}</p>
    </section>

    <section>
      <div class="t-footnote text-muted uppercase tracking-wider font-semibold mb-2.5 px-2">{$t('Novosti')}</div>
      <div class="surface rounded-2xl border border-base overflow-hidden shadow-card p-4 space-y-2.5">
        <div class="t-subhead font-semibold">{APP_VERSION} · {RELEASE_DATE}</div>
        <ul class="t-footnote text-muted list-disc pl-5 space-y-1">
          {#each RELEASE_NOTES as n}
            <li>{$t(n)}</li>
          {/each}
        </ul>
      </div>
    </section>

  </div>
</Screen>

<ConfirmDialog open={clearConfirmOpen}
               title={$t('Počisti vse shranjene podatke?')}
               body={$t('Odstrani priljubljena postajališča, opomnike za odhod (in odjavi obvestila zanje), shranjene poti in vse nastavitve, vključno s temo. Aplikacija se bo nato osvežila. Tega dejanja ni mogoče razveljaviti.')}
               confirmLabel={$t('Počisti vse')} cancelLabel={$t('Prekliči')} destructive
               onConfirm={clearAllData}
               onCancel={() => clearConfirmOpen = false} />
