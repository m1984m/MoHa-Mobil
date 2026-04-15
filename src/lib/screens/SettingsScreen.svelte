<script lang="ts">
  import { Sun, Moon, Monitor, Info, Code2, Database, Star, Map as MapIcon, Satellite, Building2 } from 'lucide-svelte';
  import Screen from '../ui/Screen.svelte';
  import { applyTheme, type Theme } from '../theme';
  import { plannerShowFavs, mapStyleKind, walkSpeedKmh, type MapStyleKind } from '../settings';

  export let theme: Theme;
  export let onThemeChange: (t: Theme) => void;

  const options: { id: Theme; label: string; icon: any }[] = [
    { id: 'light', label: 'Svetla', icon: Sun },
    { id: 'dark',  label: 'Temna', icon: Moon },
    { id: 'auto',  label: 'Samodejno', icon: Monitor },
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

  function pick(t: Theme) {
    applyTheme(t);
    onThemeChange(t);
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
      <div class="t-footnote text-muted uppercase tracking-wide mb-2 px-1">O aplikaciji</div>
      <ul class="surface rounded-2xl border border-base overflow-hidden shadow-card">
        <li class="min-h-[56px] px-4 flex items-center gap-3 border-b border-base">
          <Info size={20} color="var(--text-muted)" />
          <div class="flex-1 t-body">Različica</div>
          <div class="t-footnote text-muted">0.2.0</div>
        </li>
        <li class="min-h-[56px] px-4 flex items-center gap-3 border-b border-base">
          <Database size={20} color="var(--text-muted)" />
          <div class="flex-1 t-body">Podatki</div>
          <div class="t-footnote text-muted">GTFS Marprom, Poligram</div>
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
      <p class="mt-3 px-1 t-footnote text-muted">Vozni redi: GTFS Marprom. Zemljevidi: © OpenStreetMap, © CARTO. Pešpoti: OSRM. Vreme: Open-Meteo.</p>
    </section>

  </div>
</Screen>
