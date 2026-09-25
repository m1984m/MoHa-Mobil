<script lang="ts">
  import { backdrop, sheet } from '../motion';
  import { X, CreditCard, Smartphone, Globe, Store, ExternalLink } from 'lucide-svelte';
  import { focusTrap } from '../focusTrap';
  import ReadAloud from '../ui/ReadAloud.svelte';
  import { faresSpeech } from '../readAloud';
  import { t } from '../i18n';

  // Cenik mestnega prometa Marprom in kje se vozovnico kupi. Aplikacija vozovnic ne
  // prodaja (Marprom za to nima javnega vmesnika) — samo pove, koliko stane in kam po njo.
  //
  // Vir: https://www.marprom.si/ceniki-in-vozovnice/mestni-promet/ (»Velja od 1. junija
  // 2026«), preverjeno 22.09.2026. Subvencionirane šolske: dopolnitev cenika »Velja od
  // 1. avgusta 2024«. Brezplačen prevoz za starejše je potrdil operater (22.09.2026); vloga za
  // vozovnico IJPP je na marprom.si/vloge-in-obrazci.
  // Ob spremembi cenika posodobi tabele in VALID_FROM.
  export let open = false;
  export let onClose: () => void;

  const SOURCE = 'https://www.marprom.si/ceniki-in-vozovnice/mestni-promet/';
  const VALID_FROM = '1. 6. 2026';

  type Row = { label: string; note?: string; price: string };

  $: single = [
    { label: $t('Ena vožnja pri vozniku'), note: $t('z bančno kartico, brez prestopa'), price: '1,50 €' },
    { label: $t('Ena vožnja v predprodaji'), note: $t('s prestopom v 75 minutah'), price: '1,50 €' },
    { label: $t('Ena vožnja, otroci 6–14 let'), note: $t('s prestopom v 75 minutah'), price: '1,00 €' },
    { label: $t('10 voženj'), note: $t('s prestopom v 75 minutah'), price: '13,00 €' },
    { label: $t('10 voženj, otroci 6–14 let'), note: $t('s prestopom v 75 minutah'), price: '4,00 €' },
  ] as Row[];
  $: days = [
    { label: $t('Dnevna'), note: $t('neomejeno število voženj'), price: '6,00 €' },
    { label: $t('Dnevna omejena'), note: $t('9–13 h in od 17 h dalje'), price: '4,00 €' },
    { label: $t('Dvodnevna'), price: '10,00 €' },
    { label: $t('Tridnevna'), price: '14,00 €' },
  ] as Row[];
  $: passes = [
    { label: $t('Mesečna'), price: '36,00 €' },
    { label: $t('Polletna'), price: '180,00 €' },
    { label: $t('Letna'), price: '300,00 €' },
    { label: $t('Mesečna šolska'), note: $t('osnovnošolci, dijaki, študenti'), price: '19,20 €' },
    { label: $t('Mesečna subvencionirana'), note: $t('dijaki in študenti, na kartici IJPP'), price: '16,00 €' },
    { label: $t('Letna šolska'), note: $t('za šolsko leto'), price: '192,00 €' },
    { label: $t('P+R mesečna'), note: $t('parkiranje + avtobus; ob središču / na obrobju'), price: '49 / 39 €' },
  ] as Row[];
  $: groups = [
    { title: $t('Posamične vožnje'), rows: single },
    { title: $t('Dnevne vozovnice'), rows: days },
    { title: $t('Terminske vozovnice'), rows: passes },
  ];

  // Vse, kar okno kaže, v istem vrstnem redu (brez povezav).
  function readText(): string {
    return faresSpeech(
      $t('Če vozovnico kupiš vnaprej, lahko v 75 minutah brezplačno prestopiš na drug avtobus. Na avtobusu plačaš samo z bančno kartico, gotovine ne sprejemajo.'),
      groups,
      [
        $t('Kje kupiti') + ': ' + [
          $t('Na avtobusu: brezstično z bančno kartico (Visa, Mastercard) — 1,50 € za vožnjo.'),
          $t('Aplikacija Marprom Shop: nakup vozovnic in polnjenje kartice, plačilo z bančno kartico.'),
          $t('Spletna prodaja: vozovnica za tisk ali polnjenje kartice Marprom.'),
          $t('Prodajna mesta: Avtobusna postaja (Mlinska 1), Center mobilnosti (Partizanska 21), TIC in trafike 3DVA. Kartica Marprom stane 3 €.'),
        ].join(' '),
        $t('Brezplačno') + ': ' + $t('Starejši in upokojenci') + '. '
          + $t('Vozijo se brezplačno s kartico IJPP. Vlogo zanjo oddaš pri Marpromu.') + ' '
          + $t('Brezplačno se vozijo tudi invalidi s prebivališčem v Mariboru (z odločbo MOM).'),
      ],
    );
  }
</script>

<svelte:window on:keydown={(e) => { if (open && e.key === 'Escape') onClose(); }} />

{#if open}
  <div in:backdrop out:backdrop={{ out: true }} class="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
       style="background: rgba(0,0,0,0.45); backdrop-filter: blur(6px);"
       on:click|self={onClose}
       role="presentation">
    <div in:sheet out:sheet={{ out: true }} class="w-full sm:max-w-md surface rounded-t-3xl sm:rounded-3xl shadow-float flex flex-col"
         style="max-height: calc(100dvh - env(safe-area-inset-top) - 1rem); padding-bottom: env(safe-area-inset-bottom);"
         role="dialog" aria-modal="true" aria-label={$t('Cene in vozovnice')} tabindex="-1"
         use:focusTrap>
      <div class="flex items-center justify-between px-5 pt-4 pb-2 shrink-0">
        <div class="t-title2">{$t('Cene in vozovnice')}</div>
        <div class="flex items-center gap-2">
          <ReadAloud text={readText} />
          <button class="pressable w-11 h-11 rounded-full surface-2 grid place-items-center"
                  on:click={onClose} aria-label={$t('Zapri')}>
            <X size={18} />
          </button>
        </div>
      </div>

      <div class="overflow-y-auto px-5 pb-6 space-y-5">
        <div class="rounded-2xl px-4 py-3 t-callout"
             style="background: color-mix(in oklab, var(--accent) 9%, var(--surface));">
          {$t('Če vozovnico kupiš vnaprej, lahko v 75 minutah brezplačno prestopiš na drug avtobus. Na avtobusu plačaš samo z bančno kartico, gotovine ne sprejemajo.')}
        </div>

        {#each groups as { title, rows }}
          <section>
            <h3 class="t-footnote text-muted uppercase tracking-wider font-semibold mb-2 px-1">{title}</h3>
            <ul class="surface-2 rounded-2xl overflow-hidden">
              {#each rows as r, i}
                <li class="flex items-center gap-3 px-4 py-2.5 {i ? 'border-t border-base' : ''}">
                  <div class="flex-1 min-w-0">
                    <div class="t-callout">{r.label}</div>
                    {#if r.note}<div class="t-footnote text-muted">{r.note}</div>{/if}
                  </div>
                  <div class="t-callout font-semibold tabular-nums shrink-0">{r.price}</div>
                </li>
              {/each}
            </ul>
          </section>
        {/each}

        <section>
          <h3 class="t-footnote text-muted uppercase tracking-wider font-semibold mb-2 px-1">{$t('Kje kupiti')}</h3>
          <ul class="space-y-2">
            <li class="flex items-start gap-3 surface-2 rounded-2xl px-4 py-3">
              <CreditCard size={20} class="shrink-0 mt-0.5" color="var(--accent)" />
              <div class="t-callout">{$t('Na avtobusu: brezstično z bančno kartico (Visa, Mastercard) — 1,50 € za vožnjo.')}</div>
            </li>
            <li>
              <a class="pressable flex items-start gap-3 surface-2 rounded-2xl px-4 py-3"
                 href="https://www.marprom.si/e-storitve/marprom-shop/" target="_blank" rel="noopener">
                <Smartphone size={20} class="shrink-0 mt-0.5" color="var(--accent)" />
                <div class="flex-1 t-callout">{$t('Aplikacija Marprom Shop: nakup vozovnic in polnjenje kartice, plačilo z bančno kartico.')}</div>
                <ExternalLink size={16} class="shrink-0 mt-1" color="var(--text-muted)" />
              </a>
            </li>
            <li>
              <a class="pressable flex items-start gap-3 surface-2 rounded-2xl px-4 py-3"
                 href="https://mestnaprod.marprom.si/" target="_blank" rel="noopener">
                <Globe size={20} class="shrink-0 mt-0.5" color="var(--accent)" />
                <div class="flex-1 t-callout">{$t('Spletna prodaja: vozovnica za tisk ali polnjenje kartice Marprom.')}</div>
                <ExternalLink size={16} class="shrink-0 mt-1" color="var(--text-muted)" />
              </a>
            </li>
            <li>
              <a class="pressable flex items-start gap-3 surface-2 rounded-2xl px-4 py-3"
                 href="https://www.marprom.si/prodajna-mesta/" target="_blank" rel="noopener">
                <Store size={20} class="shrink-0 mt-0.5" color="var(--accent)" />
                <div class="flex-1 t-callout">{$t('Prodajna mesta: Avtobusna postaja (Mlinska 1), Center mobilnosti (Partizanska 21), TIC in trafike 3DVA. Kartica Marprom stane 3 €.')}</div>
                <ExternalLink size={16} class="shrink-0 mt-1" color="var(--text-muted)" />
              </a>
            </li>
          </ul>
        </section>

        <section>
          <h3 class="t-footnote text-muted uppercase tracking-wider font-semibold mb-2 px-1">{$t('Brezplačno')}</h3>
          <div class="surface-2 rounded-2xl px-4 py-3 space-y-1.5">
            <div class="flex items-center gap-3">
              <div class="flex-1 t-callout">{$t('Starejši in upokojenci')}</div>
              <div class="t-callout font-semibold shrink-0" style="color: var(--status-ontime)">0,00 €</div>
            </div>
            <div class="t-footnote text-muted">
              {$t('Vozijo se brezplačno s kartico IJPP. Vlogo zanjo oddaš pri Marpromu.')}
              <a class="underline" href="https://www.marprom.si/vloge-in-obrazci/" target="_blank" rel="noopener">{$t('Obrazci')}</a>
            </div>
            <div class="t-footnote text-muted">{$t('Brezplačno se vozijo tudi invalidi s prebivališčem v Mariboru (z odločbo MOM).')}</div>
          </div>
        </section>

        <section class="t-footnote text-muted space-y-2 px-1">
          <p>
            {$t('Cenik velja od {datum}. Cene se lahko spremenijo — velja', { datum: VALID_FROM })}
            <a class="underline" href={SOURCE} target="_blank" rel="noopener">{$t('uradni cenik Marproma')}</a>.
          </p>
        </section>
      </div>
    </div>
  </div>
{/if}
