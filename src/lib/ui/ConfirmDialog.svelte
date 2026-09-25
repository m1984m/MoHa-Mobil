<script lang="ts">
  import { backdrop, sheet } from '../motion';
  import { AlertTriangle } from 'lucide-svelte';
  import { focusTrap } from '../focusTrap';
  import { tr } from '../i18n';

  // Nadomešča domači confirm() — ta izstopa iz oblikovnega jezika in v PWA
  // standalone načinu izgleda kot sistemska napaka.
  export let open = false;
  export let title: string;
  export let body: string = '';
  export let confirmLabel = tr('Potrdi');
  export let cancelLabel = tr('Prekliči');
  export let destructive = false;
  export let onConfirm: () => void;
  export let onCancel: () => void;
</script>

<svelte:window on:keydown={(e) => { if (open && e.key === 'Escape') onCancel(); }} />

{#if open}
  <div in:backdrop out:backdrop={{ out: true }} class="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-4"
       style="background: rgba(0,0,0,0.45); backdrop-filter: blur(6px);"
       on:click|self={onCancel}
       role="presentation">
    <div in:sheet out:sheet={{ out: true }} class="surface w-full sm:max-w-sm rounded-3xl shadow-float p-5"
         role="alertdialog" aria-modal="true" aria-label={title} tabindex="-1"
         use:focusTrap>
      <div class="flex items-start gap-3 mb-4">
        <div class="shrink-0 w-10 h-10 rounded-xl grid place-items-center"
             style="background: color-mix(in oklab, {destructive ? 'var(--status-disrupt)' : 'var(--accent)'} 14%, transparent); color: {destructive ? 'var(--status-disrupt)' : 'var(--accent)'}">
          <AlertTriangle size={20} />
        </div>
        <div class="min-w-0 flex-1">
          <div class="t-headline font-semibold">{title}</div>
          {#if body}<div class="t-footnote text-muted mt-1">{body}</div>{/if}
        </div>
      </div>
      <div class="flex gap-2">
        <button type="button"
                class="pressable flex-1 min-h-[44px] rounded-xl surface-2 border border-base t-callout font-semibold"
                on:click={onCancel}>{cancelLabel}</button>
        <button type="button"
                class="pressable flex-1 min-h-[44px] rounded-xl t-callout font-semibold"
                style="background: {destructive ? 'var(--status-disrupt)' : 'var(--accent)'}; color: #ffffff;"
                on:click={onConfirm}>{confirmLabel}</button>
      </div>
    </div>
  </div>
{/if}
