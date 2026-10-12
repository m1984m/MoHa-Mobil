<script lang="ts">
  import { backdrop, sheet } from '../motion';
  import { onMount } from 'svelte';
  import { X, Sunrise, Sunset, Wind, Droplets, Sun } from 'lucide-svelte';
  import { fetchDayWeather, type DayWeather } from '../weather';
  import { t, locale } from '../i18n';
  import { focusTrap } from '../focusTrap';
  import ReadAloud from '../ui/ReadAloud.svelte';
  import { weatherSpeech } from '../readAloud';

  export let open = false;
  export let lat: number;
  export let lon: number;
  export let onClose: () => void;

  let data: DayWeather | null = null;
  let loading = false;
  let loadedAt = 0;
  // En poskus na odprtje. Prej je ob napaki reaktivni blok klical load() znova in znova
  // (`loading` pade na false, `data` ostane null): 858 zahtev Open-Meteo v 3 s, brez
  // povezave pa vroča zanka, ki prazni baterijo (pregled 12.10.2026). Znova poskusi
  // gumb »Poskusi znova« ali naslednje odprtje; podatki, starejši od pol ure, se osvežijo.
  let tried = false;
  const STALE_MS = 30 * 60_000;

  async function load() {
    tried = true;
    loading = true;
    const d = await fetchDayWeather(lat, lon);
    if (d) { data = d; loadedAt = Date.now(); }
    loading = false;
  }

  $: if (!open) tried = false;
  $: if (open && !loading && !tried && (!data || Date.now() - loadedAt > STALE_MS)) load();

  const num = (v: number, digits = 1) => v.toLocaleString(locale(), { maximumFractionDigits: digits });

  onMount(() => {});

  function close() {
    onClose();
  }
</script>

<!-- Escape na <svelte:window>: overlay div nikoli ne dobi fokusa, zato se okno s tipko
     ni zaprlo (enako kot pri ostalih oknih od 0.9.0). -->
<svelte:window on:keydown={(e) => { if (open && e.key === 'Escape') close(); }} />

{#if open}
  <div in:backdrop out:backdrop={{ out: true }} class="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
       style="background: rgba(0,0,0,0.45); backdrop-filter: blur(6px);"
       on:click|self={close}
       on:keydown={(e) => { if (e.key === 'Escape') close(); }}
       role="dialog"
       aria-modal="true"
       aria-label={$t('Vreme danes')}
       tabindex="-1">
    <div in:sheet out:sheet={{ out: true }} class="w-full sm:max-w-md surface rounded-t-3xl sm:rounded-3xl shadow-float overflow-hidden"
         style="padding-bottom: env(safe-area-inset-bottom);"
         use:focusTrap>
      <div class="flex items-center justify-between px-5 pt-4 pb-2">
        <div class="t-title2">{$t('Vreme danes')}</div>
        <div class="flex items-center gap-2">
          {#if data}
            {@const d = data}
            <ReadAloud text={() => weatherSpeech(d)} />
          {/if}
          <button class="pressable w-11 h-11 rounded-full surface-2 grid place-items-center"
                  on:click={close} aria-label={$t('Zapri')}>
            <X size={18} />
          </button>
        </div>
      </div>

      {#if loading && !data}
        <div class="px-5 pb-6 t-body text-muted">{$t('Nalagam…')}</div>
      {:else if !data}
        <div class="px-5 pb-6 flex items-center justify-between gap-3">
          <div class="t-body text-muted">{$t('Podatki niso na voljo.')}</div>
          <button class="pressable min-h-[44px] px-4 rounded-xl surface-2 border border-base t-callout font-medium shrink-0"
                  on:click={load} disabled={loading}>{$t('Poskusi znova')}</button>
        </div>
      {:else}
        <div class="px-5 pt-2 pb-5">
          <div class="flex items-center gap-4">
            <div class="text-6xl leading-none">{data.emoji}</div>
            <div class="flex-1 min-w-0">
              <div class="flex items-baseline gap-2">
                <div class="t-largeTitle font-bold">{data.tempC}°</div>
                <div class="t-subhead text-muted">{data.label}</div>
              </div>
              <div class="t-footnote text-muted">
                {$t('Najvišja {max}° · Najnižja {min}°', { max: data.tempMax, min: data.tempMin })}
              </div>
            </div>
          </div>
        </div>

        <div class="px-5 pb-4 grid grid-cols-2 gap-2">
          <div class="surface-2 rounded-xl p-3 flex items-center gap-2">
            <Sunrise size={18} color="var(--status-delay)" />
            <div>
              <div class="t-footnote text-muted">{$t('Sončni vzhod')}</div>
              <div class="t-body font-semibold">{data.sunrise}</div>
            </div>
          </div>
          <div class="surface-2 rounded-xl p-3 flex items-center gap-2">
            <Sunset size={18} color="var(--status-delay)" />
            <div>
              <div class="t-footnote text-muted">{$t('Sončni zahod')}</div>
              <div class="t-body font-semibold">{data.sunset}</div>
            </div>
          </div>
          <div class="surface-2 rounded-xl p-3 flex items-center gap-2">
            <Droplets size={18} color="var(--accent)" />
            <div>
              <div class="t-footnote text-muted">{$t('Padavine')}</div>
              <div class="t-body font-semibold">{num(data.precipSumMm)} mm</div>
            </div>
          </div>
          <div class="surface-2 rounded-xl p-3 flex items-center gap-2">
            <Wind size={18} color="var(--text-muted)" />
            <div>
              <div class="t-footnote text-muted">{$t('Veter (maks.)')}</div>
              <div class="t-body font-semibold">{data.windMaxKmh} km/h</div>
            </div>
          </div>
          <div class="surface-2 rounded-xl p-3 flex items-center gap-2 col-span-2">
            <Sun size={18} color="var(--status-delay)" />
            <div>
              <div class="t-footnote text-muted">{$t('UV indeks')}</div>
              <div class="t-body font-semibold">{data.uvMax}</div>
            </div>
          </div>
        </div>

        {#if data.hourly.length > 0}
          <div class="px-5 pb-5">
            <div class="t-footnote text-muted uppercase tracking-wide mb-2">{$t('Po urah')}</div>
            <div class="surface-2 rounded-xl overflow-x-auto">
              <div class="flex gap-3 px-3 py-3 min-w-max">
                {#each data.hourly as h}
                  <div class="flex flex-col items-center min-w-[44px]">
                    <div class="t-footnote text-muted">{String(h.hour).padStart(2, '0')}</div>
                    <div class="text-xl leading-none my-1">{h.emoji}</div>
                    <div class="t-subhead font-semibold">{h.tempC}°</div>
                    {#if h.precipMm > 0}
                      <div class="t-footnote" style="color: var(--accent)">{num(h.precipMm)}</div>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          </div>
        {/if}
      {/if}
    </div>
  </div>
{/if}
