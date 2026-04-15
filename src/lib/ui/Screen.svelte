<script lang="ts">
  export let title: string = '';
  export let scrollable: boolean = true;
  export let onRefresh: (() => Promise<void> | void) | null = null;

  let refreshing = false;
  let pullY = 0;
  let startY = 0;
  let pulling = false;
  let scrollEl: HTMLDivElement;

  function onTouchStart(e: TouchEvent) {
    if (!onRefresh || refreshing) return;
    if (scrollEl.scrollTop > 0) return;
    startY = e.touches[0].clientY;
    pulling = true;
  }
  function onTouchMove(e: TouchEvent) {
    if (!pulling) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0) { pullY = 0; return; }
    // Rubber-band
    pullY = Math.min(80, dy * 0.55);
  }
  async function onTouchEnd() {
    if (!pulling) return;
    pulling = false;
    if (pullY > 55 && onRefresh) {
      refreshing = true;
      pullY = 48;
      try { await onRefresh(); } finally { refreshing = false; pullY = 0; }
    } else {
      pullY = 0;
    }
  }
</script>

<section class="absolute inset-0 flex flex-col surface"
         style="padding-top: env(safe-area-inset-top);">
  {#if title}
    <header class="shrink-0 px-4 pt-2 pb-3">
      <h1 class="t-largeTitle">{title}</h1>
    </header>
  {/if}
  <div class="flex-1 relative overflow-hidden">
    {#if onRefresh}
      <div class="absolute left-0 right-0 flex justify-center pointer-events-none"
           style="top: {pullY - 32}px; transition: {pulling ? 'none' : 'top var(--dur-base) var(--ease-ios)'};">
        <div class="w-8 h-8 rounded-full surface-2 shadow-card grid place-items-center {refreshing ? 'animate-spin' : ''}"
             style="opacity: {Math.min(1, pullY / 50)}">
          <div class="w-4 h-4 rounded-full border-2" style="border-color: var(--accent); border-top-color: transparent;"></div>
        </div>
      </div>
    {/if}
    <div bind:this={scrollEl}
         class="absolute inset-0 {scrollable ? 'overflow-y-auto scrollbox' : 'overflow-hidden'}"
         style="padding-bottom: calc(env(safe-area-inset-bottom) + 5rem); transform: translateY({pullY}px); transition: {pulling ? 'none' : 'transform var(--dur-base) var(--ease-ios)'};"
         on:touchstart={onTouchStart}
         on:touchmove={onTouchMove}
         on:touchend={onTouchEnd}
         on:touchcancel={onTouchEnd}>
      <slot />
    </div>
  </div>
</section>
