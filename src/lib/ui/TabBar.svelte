<script lang="ts">
  import type { ComponentType } from 'svelte';
  export let tabs: { id: string; label: string; icon: ComponentType; iconActive?: ComponentType }[] = [];
  export let active: string;
  export let onChange: (id: string) => void;
</script>

<!-- Varovalka nad env(safe-area-inset-bottom): na iPhonu je območje domačega
     indikatorja 34 točk, izmerjeno na posnetku uporabnika (16.09.2026) pa je bil
     pas pod menijem ~90 točk. Dokler vzrok ni pojasnjen (diagnostika v
     Nastavitvah → O aplikaciji), odmik omejimo, da meni sedi ob dnu zaslona. -->
<nav class="absolute left-0 right-0 bottom-0 z-40 surface border-t border-base"
     style="padding-bottom: min(env(safe-area-inset-bottom), 34px);">
  <div class="max-w-screen-sm mx-auto grid" style="grid-template-columns: repeat({tabs.length}, 1fr);">
    {#each tabs as t}
      {@const isActive = t.id === active}
      <button class="pressable h-16 flex flex-col items-center justify-center gap-1"
              on:click={() => onChange(t.id)}
              aria-label={t.label}
              aria-current={isActive ? 'page' : undefined}>
        <svelte:component this={(isActive && t.iconActive) || t.icon}
                          size={24}
                          strokeWidth={isActive ? 2.25 : 1.75}
                          color={isActive ? 'var(--accent)' : 'var(--text-muted)'} />
        <span class="t-footnote" style="color: {isActive ? 'var(--accent)' : 'var(--text-muted)'}; font-weight: {isActive ? 600 : 400};">
          {t.label}
        </span>
      </button>
    {/each}
  </div>
</nav>
