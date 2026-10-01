<script lang="ts">
  import { t } from '../i18n';

  // Kratko navodilo za zvok obvestil (čarovnik opomnikov in Opomniki v nastavitvah).
  // Aplikacija zvoka ne more vklopiti sama: odloča telefon.
  export let big = false;
</script>

<details class="mm-nh rounded-2xl surface-2 border border-base" class:mm-nh-big={big}>
  <summary class="pressable">{$t('Kako vklopim zvok obvestil')}</summary>
  <div class="mm-nh-body space-y-2">
    <p><b>iPhone:</b> {$t('aplikacija mora biti dodana na začetni zaslon in odprta s te ikone. Nato Nastavitve, Obvestila, MoHa Mobil in vklopi Zvoki. Fokus ali tihi način obvestila utišata.')}</p>
    <p><b>Android:</b> {$t('v nastavitvah telefona odpri Obvestila za aplikacijo MoHa Mobil ali za brskalnik in dovoli zvok.')}</p>
    <p class="text-muted">{$t('Opomnik pride kot obvestilo na telefon. Aplikacija ne pošilja SMS sporočil.')}</p>
  </div>
</details>

<style>
  .mm-nh summary {
    min-height: 48px; padding: 12px 16px; font-weight: 600; cursor: pointer;
    font-size: calc(15px * var(--ui-scale));
  }
  .mm-nh-body { padding: 0 16px 14px; font-size: calc(14px * var(--ui-scale)); line-height: 1.45; }
  .mm-nh-big summary { min-height: 64px; font-size: calc(17px * var(--ui-scale)); }
  .mm-nh-big .mm-nh-body { font-size: calc(17px * var(--ui-scale)); }
</style>
