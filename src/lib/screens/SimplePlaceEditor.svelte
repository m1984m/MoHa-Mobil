<script lang="ts">
  import { page } from '../motion';
  import { tick } from 'svelte';
  import { ArrowLeft, LocateFixed, MapPin, Check, Search } from 'lucide-svelte';
  import { simplePlaces, type SimplePlace } from '../simple';
  import { focusTrap } from '../focusTrap';
  import { t, tr } from '../i18n';

  // Nastavitev doma ali kraja. Dve poti do lege: "Sem tukaj" (najlažje — doma
  // pritisneš en gumb) ali vpis naslova. Ime kraja se lahko izbere med predlogi,
  // da ni treba tipkati.
  export let target: { kind: 'home' | 'place'; place: SimplePlace | null } | null;
  export let origin: { lat: number; lon: number };
  export let hasGeo: boolean;
  export let onClose: () => void;
  export let onRequestLocation: () => Promise<void>;

  type Loc = { name: string; lat: number; lon: number };

  let label = '';
  let loc: Loc | null = null;
  let query = '';
  let results: Loc[] = [];
  let searching = false;
  let searched = false;
  let locating = false;
  let denied = false;
  // Med iskanjem naslova za "Sem tukaj" se ne shranjuje — sicer bi ostalo začasno ime.
  let naming = false;
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let openedFor: typeof target = null;

  const LABELS = ['K zdravniku', 'V trgovino', 'Na tržnico', 'K družini'];

  // Ob vsakem odprtju začni iz shranjenega zapisa (ali praznega).
  $: if (target && target !== openedFor) {
    openedFor = target;
    label = target.place?.label ?? '';
    loc = target.place ? { name: target.place.name, lat: target.place.lat, lon: target.place.lon } : null;
    query = ''; results = []; searched = false; denied = false; naming = false;
  }
  $: if (!target && openedFor) {
    openedFor = null;
    if (timer) { clearTimeout(timer); timer = null; }
    seq++;
  }

  $: isHome = target?.kind === 'home';
  $: title = isHome
    ? (target?.place ? $t('Spremeni dom') : $t('Nastavi dom'))
    : (target?.place ? $t('Spremeni kraj') : $t('Nov kraj'));
  $: canSave = !!loc && !naming && (isHome || label.trim().length > 0);

  function onQuery(q: string) {
    if (timer) clearTimeout(timer);
    const s = q.trim();
    if (s.length < 3) { seq++; results = []; searched = false; searching = false; return; }
    searching = true;
    timer = setTimeout(async () => {
      const my = ++seq;
      const r = await geocode(s);
      if (my !== seq) return;
      results = r; searching = false; searched = true;
    }, 400);
  }
  $: onQuery(query);

  async function geocode(q: string): Promise<Loc[]> {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + ', Maribor, Slovenija')}&format=json&countrycodes=si&limit=5`,
        { headers: { 'Accept-Language': 'sl' } });
      if (!r.ok) return [];
      const j = await r.json();
      if (!Array.isArray(j)) return [];
      return j.map((it: any) => ({
        lat: parseFloat(it.lat), lon: parseFloat(it.lon),
        name: String(it.display_name).split(',').slice(0, 2).join(',').trim(),
      })).filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lon));
    } catch { return []; }
  }

  async function reverse(lat: number, lon: number): Promise<string | null> {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=18`,
        { headers: { 'Accept-Language': 'sl' } });
      if (!r.ok) return null;
      const j = await r.json();
      return j?.display_name ? String(j.display_name).split(',').slice(0, 2).join(',').trim() : null;
    } catch { return null; }
  }

  async function useHere() {
    // Vedno sveža lega: shranjeno mesto se uporablja mesece, stara lega bi bila napačen dom.
    locating = true;
    try { await onRequestLocation(); } finally { locating = false; }
    await tick(); // lega iz App pride v props šele v naslednjem izrisu
    if (!hasGeo) { denied = true; return; }
    denied = false;
    const here = { lat: origin.lat, lon: origin.lon };
    loc = { ...here, name: tr('Trenutna lokacija') };
    query = ''; results = [];
    naming = true;
    const name = await reverse(here.lat, here.lon);
    if (loc && loc.lat === here.lat && loc.lon === here.lon) {
      // Brez naslova ime ne sme ostati "Trenutna lokacija" — čez teden dni to ni več res.
      loc = { ...loc, name: name ?? (isHome ? tr('Dom') : (label.trim() || tr('Shranjeno mesto'))) };
    }
    naming = false;
  }

  function pick(r: Loc) { loc = r; query = ''; results = []; searched = false; }

  function save() {
    if (!target || !loc) return;
    if (target.kind === 'home') simplePlaces.setHome(loc);
    else simplePlaces.savePlace({ id: target.place?.id, label: label.trim(), ...loc });
    onClose();
  }
</script>

{#if target}
  <div in:page out:page={{ out: true }} class="fixed inset-0 z-[66] flex flex-col surface"
       style="padding-top: env(safe-area-inset-top);"
       role="dialog" aria-modal="true" aria-label={title} tabindex="-1" use:focusTrap>
    <div class="px-4 pt-3 pb-2 max-w-screen-sm mx-auto w-full">
      <button type="button" class="pressable mm-pe-btn" style="padding-left: 14px" on:click={onClose}>
        <ArrowLeft size={26} strokeWidth={2.25} /> {$t('Nazaj')}
      </button>
    </div>

    <div class="flex-1 overflow-y-auto scrollbox">
      <div class="px-4 max-w-screen-sm mx-auto space-y-6"
           style="padding-bottom: calc(env(safe-area-inset-bottom) + 2rem);">
        <h1 class="t-title1">{title}</h1>

        {#if !isHome}
          <section class="space-y-3">
            <label class="block t-headline" for="mm-pe-label">{$t('Ime kraja')}</label>
            <input id="mm-pe-label" class="mm-pe-input" type="text" bind:value={label}
                   placeholder={$t('npr. K zdravniku')} autocomplete="off" maxlength="40" />
            <div class="flex flex-wrap gap-2">
              {#each LABELS as l}
                <button type="button" class="pressable mm-pe-chip" aria-pressed={label === tr(l)}
                        on:click={() => label = tr(l)}>{$t(l)}</button>
              {/each}
            </div>
          </section>
        {/if}

        <section class="space-y-3">
          <h2 class="t-headline">{isHome ? $t('Kje je dom?') : $t('Kje je?')}</h2>

          <button type="button" class="pressable mm-pe-btn w-full" disabled={locating} on:click={useHere}>
            <LocateFixed size={26} color="var(--accent)" />
            {locating ? $t('Čakam na dovoljenje…') : (isHome ? $t('Sem doma — shrani to mesto') : $t('Sem tukaj — shrani to mesto'))}
          </button>
          {#if denied}
            <p class="t-callout" style="color: var(--status-delay)">{$t('Lokacija je zavrnjena. Vklopi jo v nastavitvah telefona ali brskalnika za to stran ali vpiši naslov.')}</p>
          {/if}

          <div class="t-callout text-muted text-center">{$t('ali vpiši naslov')}</div>

          <div class="relative">
            <Search size={24} color="var(--text-muted)" class="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input class="mm-pe-input" style="padding-left: 52px" type="search" bind:value={query}
                   placeholder={$t('Ulica in hišna številka')} autocomplete="off"
                   aria-label={$t('Vpiši naslov')} />
          </div>

          {#if searching}
            <div class="t-callout text-muted" aria-live="polite">{$t('Iščem…')}</div>
          {:else if searched && results.length === 0}
            <div class="t-callout text-muted" aria-live="polite">{$t('Naslova nisem našel. Preveri zapis.')}</div>
          {/if}
          {#each results as r}
            <button type="button" class="pressable mm-pe-result w-full" on:click={() => pick(r)}>
              <MapPin size={24} color="var(--accent)" />
              <span class="flex-1 text-left t-body">{r.name}</span>
            </button>
          {/each}

          {#if loc}
            <div class="mm-pe-chosen" aria-live="polite">
              <Check size={26} color="var(--status-ontime)" strokeWidth={2.5} />
              <div class="min-w-0">
                <div class="t-footnote text-muted">{naming ? $t('Iščem naslov…') : $t('Izbrano')}</div>
                <div class="t-body font-semibold">{loc.name}</div>
              </div>
            </div>
          {/if}
        </section>

        <button type="button" class="pressable mm-pe-btn mm-pe-accent w-full" disabled={!canSave} on:click={save}>
          <Check size={26} strokeWidth={2.5} /> {$t('Shrani')}
        </button>
        {#if !canSave}
          <div class="t-callout text-muted text-center">
            {#if !loc}{$t('Najprej izberi, kje je.')}{:else}{$t('Vpiši ali izberi ime kraja.')}{/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .mm-pe-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 10px;
    min-height: 64px; padding: 0 20px; border-radius: 18px;
    background: var(--surface-2); border: 2px solid var(--border); color: var(--text);
    font-weight: 600; font-size: calc(16px * var(--ui-scale)); touch-action: manipulation;
    text-align: center;
  }
  .mm-pe-btn:disabled { opacity: 0.55; }
  .mm-pe-accent { background: var(--accent); border-color: var(--accent); color: #ffffff; min-height: 72px; }
  .mm-pe-input {
    width: 100%; min-height: 64px; padding: 0 16px; border-radius: 16px;
    background: var(--surface); border: 2px solid var(--border); color: var(--text);
    font-size: calc(17px * var(--ui-scale));
  }
  .mm-pe-input:focus { outline: 3px solid var(--accent); outline-offset: 1px; }
  .mm-pe-chip {
    min-height: 64px; padding: 0 18px; border-radius: 999px;
    background: var(--surface-2); border: 2px solid var(--border); color: var(--text);
    font-size: calc(15px * var(--ui-scale)); font-weight: 600; touch-action: manipulation;
  }
  .mm-pe-chip[aria-pressed='true'] { background: var(--accent); border-color: var(--accent); color: #ffffff; }
  .mm-pe-result {
    display: flex; align-items: center; gap: 12px;
    min-height: 64px; padding: 10px 16px; border-radius: 16px;
    background: var(--surface); border: 2px solid var(--border); color: var(--text);
    touch-action: manipulation;
  }
  .mm-pe-chosen {
    display: flex; align-items: center; gap: 12px;
    padding: 14px 16px; border-radius: 16px;
    background: color-mix(in oklab, var(--status-ontime) 10%, var(--surface));
    border: 2px solid var(--status-ontime);
  }
</style>
