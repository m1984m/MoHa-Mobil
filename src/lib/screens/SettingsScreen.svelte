<script lang="ts">
  import { Sun, Moon, Monitor, Info, Code2, Database, Star, Map as MapIcon, Satellite, Building2, MapPinned, Home as HomeIcon, CalendarClock, Compass, Trash2, Timer, Clock, Rows3, Type, Contrast, Circle } from 'lucide-svelte';
  import Screen from '../ui/Screen.svelte';
  import { applyTheme, type Theme } from '../theme';
  import { plannerShowFavs, mapStyleKind, walkSpeedKmh, homeShowNearby, homeShowFavs, defaultTab, nearbyRadiusM, departureDisplay, compactLists, mapLabelSize, type MapStyleKind, type DefaultTab, type DepartureDisplay, type MapLabelSize } from '../settings';
  import { APP_VERSION, RELEASE_DATE, RELEASE_NOTES } from '../release';

  export let theme: Theme;
  export let onThemeChange: (t: Theme) => void;

  const options: { id: Theme; label: string; icon: any }[] = [
    { id: 'light',    label: 'Svetla',         icon: Sun },
    { id: 'dark',     label: 'Temna',          icon: Moon },
    { id: 'auto',     label: 'Samodejno',      icon: Monitor },
    { id: 'contrast', label: 'Visoki kontrast', icon: Contrast },
    { id: 'mono',     label: 'Črno-belo',      icon: Circle },
  ];

  const mapOptions: { id: MapStyleKind; label: string; icon: any }[] = [
    { id: 'map', label: 'Zemljevid', icon: MapIcon },
    { id: 'satellite', label: 'Satelit', icon: Satellite },
  ];

  const speedOptions: { v: number; label: string; sub: string }[] = [
    { v: 3, label: '3 km/h', sub: 'počasi' },
    { v: 4, label: '4 km/h', sub: 'povprečno' },
    { v: 5, label: '5 km/h', sub: 'hitro' },
  ];

  const defaultTabOptions: { id: DefaultTab; label: string; icon: any }[] = [
    { id: 'home', label: 'Dom', icon: HomeIcon },
    { id: 'timetables', label: 'Vozni redi', icon: CalendarClock },
    { id: 'map', label: 'Karta', icon: MapIcon },
    { id: 'fav', label: 'Priljub.', icon: Star },
  ];

  const radiusOptions: { v: number; label: string; sub: string }[] = [
    { v: 300,  label: '300 m', sub: 'ozko' },
    { v: 500,  label: '500 m', sub: 'običajno' },
    { v: 1000, label: '1 km',  sub: 'široko' },
  ];

  const departureOptions: { id: DepartureDisplay; label: string; sub: string; icon: any }[] = [
    { id: 'minutes', label: 'Minute', sub: 'do odhoda', icon: Timer },
    { id: 'clock',   label: 'Ura',    sub: 'HH:MM',      icon: Clock },
    { id: 'both',    label: 'Oboje',  sub: 'min + ura',  icon: CalendarClock },
  ];

  const labelSizeOptions: { id: MapLabelSize; label: string }[] = [
    { id: 'small',  label: 'Manjši' },
    { id: 'medium', label: 'Srednji' },
    { id: 'large',  label: 'Večji' },
  ];

  function pick(t: Theme) {
    applyTheme(t);
    onThemeChange(t);
  }

  function clearAllData() {
    if (!confirm('Počisti vse shranjene podatke aplikacije?\n\nTo bo odstranilo priljubljena postajališča, shranjene poti in vse tvoje nastavitve. Aplikacija se bo po tem osvežila.')) return;
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('mm.')) keysToRemove.push(k);
      }
      for (const k of keysToRemove) localStorage.removeItem(k);
      try { sessionStorage.removeItem('mm_tab'); } catch {}
    } catch {}
    location.reload();
  }
</script>

<Screen title="Nastavitve">
  <div class="px-4 max-w-screen-sm mx-auto space-y-6">

    <section>
      <div class="t-footnote text-muted uppercase tracking-wide mb-2 px-1">Izgled</div>
      <ul class="surface rounded-2xl border border-base overflow-hidden shadow-card">
        {#each options as o, i}
          {@const active = theme === o.id}
          <button class="pressable w-full min-h-[56px] px-4 flex items-center gap-3 text-left {i < options.length - 1 ? 'border-b border-base' : ''}"
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
    </section>

    <section>
      <div class="t-footnote text-muted uppercase tracking-wide mb-2 px-1">Zagon</div>
      <div class="surface rounded-2xl border border-base overflow-hidden shadow-card p-1.5">
        <div class="t-footnote text-muted px-2 py-1">Privzeti zavihek ob zagonu</div>
        <div class="flex gap-1.5">
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
      <div class="t-footnote text-muted uppercase tracking-wide mb-2 px-1">Dom</div>
      <ul class="surface rounded-2xl border border-base overflow-hidden shadow-card">
        <li class="min-h-[56px] px-4 flex items-center gap-3">
          <MapPinned size={20} color="var(--text-muted)" />
          <div class="flex-1">
            <div class="t-body">Najbližja postajališča</div>
            <div class="t-footnote text-muted">Prikaži postaje v bližini tvoje lokacije</div>
          </div>
          <button class="pressable relative w-12 h-7 rounded-full transition-colors"
                  style="background: {$homeShowNearby ? 'var(--accent)' : 'var(--surface-3)'}"
                  on:click={() => homeShowNearby.update(v => !v)}
                  aria-label="Preklopi bližnja postajališča">
            <span class="absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-card transition-all"
                  style="left: {$homeShowNearby ? '1.375rem' : '0.125rem'}"></span>
          </button>
        </li>
        {#if $homeShowNearby}
          <li class="px-4 py-3 border-t border-base">
            <div class="flex items-center gap-3 mb-2">
              <Compass size={20} color="var(--text-muted)" />
              <div class="flex-1">
                <div class="t-body">Radij iskanja</div>
                <div class="t-footnote text-muted">Oddaljenost iskanja bližnjih postaj</div>
              </div>
            </div>
            <div class="flex gap-1.5">
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
        <li class="min-h-[56px] px-4 flex items-center gap-3 border-t border-base">
          <Star size={20} color="var(--status-delay)" fill="var(--status-delay)" />
          <div class="flex-1">
            <div class="t-body">Priljubljena postajališča</div>
            <div class="t-footnote text-muted">Prikaži shranjene postaje s tvojega seznama</div>
          </div>
          <button class="pressable relative w-12 h-7 rounded-full transition-colors"
                  style="background: {$homeShowFavs ? 'var(--accent)' : 'var(--surface-3)'}"
                  on:click={() => homeShowFavs.update(v => !v)}
                  aria-label="Preklopi priljubljena postajališča">
            <span class="absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-card transition-all"
                  style="left: {$homeShowFavs ? '1.375rem' : '0.125rem'}"></span>
          </button>
        </li>
      </ul>
    </section>

    <section>
      <div class="t-footnote text-muted uppercase tracking-wide mb-2 px-1">Odhodi</div>
      <div class="surface rounded-2xl border border-base overflow-hidden shadow-card p-1.5">
        <div class="t-footnote text-muted px-2 py-1">Prikaz časa odhoda</div>
        <div class="flex gap-1.5">
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
      <ul class="surface rounded-2xl border border-base overflow-hidden shadow-card mt-3">
        <li class="min-h-[56px] px-4 flex items-center gap-3">
          <Rows3 size={20} color="var(--text-muted)" />
          <div class="flex-1">
            <div class="t-body">Kompaktni seznami</div>
            <div class="t-footnote text-muted">Manjše vrstice, več vsebine na ekran</div>
          </div>
          <button class="pressable relative w-12 h-7 rounded-full transition-colors"
                  style="background: {$compactLists ? 'var(--accent)' : 'var(--surface-3)'}"
                  on:click={() => compactLists.update(v => !v)}
                  aria-label="Preklopi kompakten prikaz">
            <span class="absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-card transition-all"
                  style="left: {$compactLists ? '1.375rem' : '0.125rem'}"></span>
          </button>
        </li>
      </ul>
    </section>

    <section>
      <div class="t-footnote text-muted uppercase tracking-wide mb-2 px-1">Karta</div>
      <div class="surface rounded-2xl border border-base overflow-hidden shadow-card p-1.5 flex gap-1.5">
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
      <ul class="surface rounded-2xl border border-base overflow-hidden shadow-card mt-3">
        <li class="px-4 py-3">
          <div class="flex items-center gap-3 mb-2">
            <Type size={20} color="var(--text-muted)" />
            <div class="flex-1">
              <div class="t-body">Velikost napisov</div>
              <div class="t-footnote text-muted">Imena cest in naselij na karti</div>
            </div>
          </div>
          <div class="flex gap-1.5">
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
      </ul>
    </section>

    <section>
      <div class="t-footnote text-muted uppercase tracking-wide mb-2 px-1">Načrtovanje poti</div>
      <ul class="surface rounded-2xl border border-base overflow-hidden shadow-card">
        <li class="min-h-[56px] px-4 flex items-center gap-3">
          <Star size={20} color="var(--status-delay)" fill="var(--status-delay)" />
          <div class="flex-1">
            <div class="t-body">Predlagaj priljubljena</div>
            <div class="t-footnote text-muted">V Od/Do seznamu prikaži priljubljena postajališča</div>
          </div>
          <button class="pressable relative w-12 h-7 rounded-full transition-colors"
                  style="background: {$plannerShowFavs ? 'var(--accent)' : 'var(--surface-3)'}"
                  on:click={() => plannerShowFavs.update(v => !v)}
                  aria-label="Preklopi predlog priljubljenih">
            <span class="absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-card transition-all"
                  style="left: {$plannerShowFavs ? '1.375rem' : '0.125rem'}"></span>
          </button>
        </li>
        <li class="px-4 py-3 border-t border-base">
          <div class="t-body mb-1">Hitrost hoje</div>
          <div class="t-footnote text-muted mb-2">Uporabi se za izračun pešpoti v načrtovalcu</div>
          <div class="flex gap-1.5">
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
      <div class="t-footnote text-muted uppercase tracking-wide mb-2 px-1">Podatki</div>
      <ul class="surface rounded-2xl border border-base overflow-hidden shadow-card">
        <li class="min-h-[56px] px-4">
          <button class="pressable w-full min-h-[56px] flex items-center gap-3 text-left"
                  on:click={clearAllData}>
            <Trash2 size={20} color="var(--status-disrupt)" />
            <div class="flex-1">
              <div class="t-body" style="color: var(--status-disrupt)">Počisti vse podatke</div>
              <div class="t-footnote text-muted">Odstrani priljubljene, shranjene poti in ponastavi nastavitve</div>
            </div>
          </button>
        </li>
      </ul>
    </section>

    <section>
      <div class="t-footnote text-muted uppercase tracking-wide mb-2 px-1">O aplikaciji</div>
      <ul class="surface rounded-2xl border border-base overflow-hidden shadow-card">
        <li class="min-h-[56px] px-4 flex items-center gap-3 border-b border-base">
          <Info size={20} color="var(--text-muted)" />
          <div class="flex-1 t-body">Različica</div>
          <div class="t-footnote text-muted">{APP_VERSION}</div>
        </li>
        <li class="min-h-[56px] px-4 flex items-center gap-3 border-b border-base">
          <Database size={20} color="var(--text-muted)" />
          <div class="flex-1 t-body">Podatki</div>
          <div class="t-footnote text-muted">GTFS Marprom</div>
        </li>
        <li class="min-h-[56px] px-4 flex items-center gap-3 border-b border-base">
          <Building2 size={20} color="var(--text-muted)" />
          <div class="flex-1 t-body">Razvijalec</div>
          <div class="t-footnote text-muted">Matej</div>
        </li>
        <li class="min-h-[56px] px-4 flex items-center gap-3">
          <Code2 size={20} color="var(--text-muted)" />
          <div class="flex-1 t-body">Odprtokodno</div>
          <div class="t-footnote text-muted">PWA</div>
        </li>
      </ul>
      <p class="mt-3 px-1 t-footnote text-muted">Vozni redi: GTFS Marprom. Zemljevidi: © OpenStreetMap, © CARTO. Pešpoti: openrouteservice.org. Vreme: Open-Meteo.</p>
    </section>

    <section>
      <div class="t-footnote text-muted uppercase tracking-wide mb-2 px-1">Novosti</div>
      <div class="surface rounded-2xl border border-base overflow-hidden shadow-card p-4 space-y-2">
        <div class="t-subhead font-semibold">{APP_VERSION} · {RELEASE_DATE}</div>
        <ul class="t-footnote text-muted list-disc pl-5 space-y-1">
          {#each RELEASE_NOTES as n}
            <li>{n}</li>
          {/each}
        </ul>
      </div>
    </section>

  </div>
</Screen>
