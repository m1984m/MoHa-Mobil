<script lang="ts">
  import { onMount } from 'svelte';
  import { X, Sunrise, Sunset, Wind, Droplets, Sun } from 'lucide-svelte';
  import { fetchDayWeather, type DayWeather } from '../weather';

  export let open = false;
  export let lat: number;
  export let lon: number;
  export let onClose: () => void;

  let data: DayWeather | null = null;
  let loading = false;

  async function load() {
    loading = true;
    data = await fetchDayWeather(lat, lon);
    loading = false;
  }

  $: if (open && !data && !loading) load();

  onMount(() => {});

  function close() {
    onClose();
  }
</script>

{#if open}
  <div class="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
       style="background: rgba(0,0,0,0.45); backdrop-filter: blur(6px);"
       on:click|self={close}
       role="dialog"
       aria-modal="true">
    <div class="w-full sm:max-w-md surface rounded-t-3xl sm:rounded-3xl shadow-float overflow-hidden"
         style="padding-bottom: env(safe-area-inset-bottom);">
      <div class="flex items-center justify-between px-5 pt-4 pb-2">
        <div class="t-title2">Vreme danes</div>
        <button class="pressable w-9 h-9 rounded-full surface-2 grid place-items-center"
                on:click={close} aria-label="Zapri">
          <X size={18} />
        </button>
      </div>

      {#if loading && !data}
        <div class="px-5 pb-6 t-body text-muted">Nalagam…</div>
      {:else if !data}
        <div class="px-5 pb-6 t-body text-muted">Podatki niso na voljo.</div>
      {:else}
        <div class="px-5 pt-2 pb-5">
          <div class="flex items-center gap-4">
            <div class="text-6xl leading-none">{data.emoji}</div>
            <div class="flex-1 min-w-0">
              <div class="flex items-baseline gap-2">
                <div class="t-largetitle font-bold">{data.tempC}°</div>
                <div class="t-subhead text-muted">{data.label}</div>
              </div>
              <div class="t-footnote text-muted">
                Najvišja {data.tempMax}° · Najnižja {data.tempMin}°
              </div>
            </div>
          </div>
        </div>

        <div class="px-5 pb-4 grid grid-cols-2 gap-2">
          <div class="surface-2 rounded-xl p-3 flex items-center gap-2">
            <Sunrise size={18} color="var(--status-delay)" />
            <div>
              <div class="t-footnote text-muted">Sončni vzhod</div>
              <div class="t-body font-semibold">{data.sunrise}</div>
            </div>
          </div>
          <div class="surface-2 rounded-xl p-3 flex items-center gap-2">
            <Sunset size={18} color="var(--status-delay)" />
            <div>
              <div class="t-footnote text-muted">Sončni zahod</div>
              <div class="t-body font-semibold">{data.sunset}</div>
            </div>
          </div>
          <div class="surface-2 rounded-xl p-3 flex items-center gap-2">
            <Droplets size={18} color="var(--accent)" />
            <div>
              <div class="t-footnote text-muted">Padavine</div>
              <div class="t-body font-semibold">{data.precipSumMm} mm</div>
            </div>
          </div>
          <div class="surface-2 rounded-xl p-3 flex items-center gap-2">
            <Wind size={18} color="var(--text-muted)" />
            <div>
              <div class="t-footnote text-muted">Veter (maks.)</div>
              <div class="t-body font-semibold">{data.windMaxKmh} km/h</div>
            </div>
          </div>
          <div class="surface-2 rounded-xl p-3 flex items-center gap-2 col-span-2">
            <Sun size={18} color="var(--status-delay)" />
            <div>
              <div class="t-footnote text-muted">UV indeks</div>
              <div class="t-body font-semibold">{data.uvMax}</div>
            </div>
          </div>
        </div>

        {#if data.hourly.length > 0}
          <div class="px-5 pb-5">
            <div class="t-footnote text-muted uppercase tracking-wide mb-2">Po urah</div>
            <div class="surface-2 rounded-xl overflow-x-auto">
              <div class="flex gap-3 px-3 py-3 min-w-max">
                {#each data.hourly as h}
                  <div class="flex flex-col items-center min-w-[44px]">
                    <div class="t-footnote text-muted">{String(h.hour).padStart(2, '0')}</div>
                    <div class="text-xl leading-none my-1">{h.emoji}</div>
                    <div class="t-subhead font-semibold">{h.tempC}°</div>
                    {#if h.precipMm > 0}
                      <div class="t-footnote" style="color: var(--accent)">{h.precipMm.toFixed(1)}</div>
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
