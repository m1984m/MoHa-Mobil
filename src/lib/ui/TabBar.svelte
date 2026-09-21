<script lang="ts">
  import type { ComponentType } from 'svelte';
  export let tabs: { id: string; label: string; icon: ComponentType; iconActive?: ComponentType }[] = [];
  export let active: string;
  export let onChange: (id: string) => void;

  // Lebdeča steklena vrstica (iOS 27). Prej je bila neprosojna ploskev od roba
  // do roba s črto na vrhu — vsebina pod njo je bila skrita. Zdaj vrstica stoji
  // nad vsebino, zato mora vsak zaslon spodaj pustiti --tabbar-space prostora.
</script>

<nav class="mm-tabbar mm-glass absolute z-40 overflow-hidden"
     style="left: 50%; transform: translateX(-50%);
            width: calc(100% - 2 * var(--tabbar-gap));
            max-width: calc(40rem - 2 * var(--tabbar-gap));
            bottom: calc(env(safe-area-inset-bottom) + var(--tabbar-gap));
            border-radius: calc(var(--tabbar-h) / 2 - 2px);">
  <div class="grid" style="grid-template-columns: repeat({tabs.length}, 1fr); height: var(--tabbar-h);">
    {#each tabs as t}
      {@const isActive = t.id === active}
      <button class="mm-tab pressable relative flex flex-col items-center justify-center gap-0.5"
              on:click={() => onChange(t.id)}
              aria-label={t.label}
              aria-current={isActive ? 'page' : undefined}>
        {#if isActive}
          <span class="mm-tab-pill" aria-hidden="true"></span>
        {/if}
        <span class="relative flex flex-col items-center gap-0.5">
          <svelte:component this={(isActive && t.iconActive) || t.icon}
                            size={23}
                            strokeWidth={isActive ? 2.25 : 1.75}
                            color={isActive ? 'var(--accent)' : 'var(--text-muted)'} />
          <span class="t-footnote leading-none" style="color: {isActive ? 'var(--accent)' : 'var(--text-muted)'}; font-weight: {isActive ? 600 : 400};">
            {t.label}
          </span>
        </span>
      </button>
    {/each}
  </div>
</nav>

<style>
  .mm-tab { background: none; border: 0; padding: 0; color: inherit; touch-action: manipulation; }

  /* Kapsula pod aktivnim zavihkom. Absolutna, da ne premakne ikone in napisa. */
  .mm-tab-pill {
    position: absolute;
    top: 3px;
    bottom: 3px;
    left: 50%;
    transform: translateX(-50%);
    width: min(58px, 90%);
    border-radius: 999px;
    background: var(--glass-tint);
    pointer-events: none;
  }
</style>
