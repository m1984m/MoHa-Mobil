<script lang="ts">
  import { Volume2 } from 'lucide-svelte';
  import { t, tr } from '../i18n';
  import ReadAloud from './ReadAloud.svelte';

  // Predstavitev glasu Petra: ena kartica, uporabljena v vodiču ob prvem zagonu
  // (WelcomeModal) in enkrat po posodobitvi za obstoječe uporabnike (PetraCard).
  // Gumb "Poslušaj Petro" pusti, da se predstavi sama; pozdrav po uri dneva doda
  // speak(). Zapis je stalen (tri različice), zato ga Worker po prvem klicu streže
  // iz predpomnilnika in ne porabi kvote.
</script>

<div class="mm-pi-icon"><Volume2 size={40} strokeWidth={1.75} /></div>
<h1 class="t-title1 font-bold text-center">{$t('Spoznaj Petro')}</h1>
<p class="t-body text-muted text-center max-w-sm">
  {$t('Petra je naš novi glas. Ko pritisneš »Preberi na glas«, ti v naravni slovenščini prebere prihode avtobusov, pot po korakih, vozni red in cene.')}
</p>
<p class="t-footnote text-muted text-center max-w-sm">
  {$t('Gumb z zvočnikom je na vseh oknih z odhodi. Brez povezave bere glas tvojega telefona.')}
</p>
<div class="w-full max-w-sm mt-2">
  <ReadAloud variant="big" wide caption={$t('Poslušaj Petro')}
             text={() => tr('Jaz sem Petra. Ko pritisneš Preberi na glas, ti povem, kdaj pripelje tvoj avtobus, kako prideš do cilja in koliko stane vozovnica.')} />
</div>

<style>
  /* Enako kot ikone kartic v vodiču (mm-wl-icon). */
  .mm-pi-icon {
    width: 88px; height: 88px; border-radius: 26px;
    display: grid; place-items: center; margin-bottom: 8px;
    color: var(--accent);
    background: color-mix(in oklab, var(--accent) 12%, transparent);
  }
</style>
