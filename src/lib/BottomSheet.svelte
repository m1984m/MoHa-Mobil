<script lang="ts">
  import { onMount } from 'svelte';
  import { spring } from 'svelte/motion';

  // Height fractions of viewport that the sheet occupies at each snap
  export let snaps: number[] = [0.12, 0.55, 0.92];
  export let snapIndex = 1;

  let vh = 800;
  let sheetH = 720;
  // translateY in px: 0 = fully visible (full snap). Positive = pushed down (less visible).
  const y = spring(0, { stiffness: 0.2, damping: 0.75 });

  let content: HTMLDivElement;

  function recompute() {
    vh = window.innerHeight;
    sheetH = vh * snaps[snaps.length - 1];
  }
  function target(i: number) {
    const visible = vh * snaps[i];
    return Math.max(0, sheetH - visible);
  }
  function setSnap(i: number) {
    snapIndex = Math.max(0, Math.min(snaps.length - 1, i));
    y.set(target(snapIndex));
  }

  onMount(() => {
    recompute();
    y.set(target(snapIndex), { hard: true });
    const onResize = () => { recompute(); y.set(target(snapIndex), { hard: true }); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  // Gesture state
  type Mode = 'idle' | 'sheet' | 'scroll';
  let mode: Mode = 'idle';
  let startY = 0;
  let lastY = 0;
  let lastT = 0;
  let vy = 0; // px/ms, positive = moving down
  let startVal = 0;
  let startScroll = 0;
  let pointerEl: HTMLElement | null = null;
  let pointerId = -1;

  const SWIPE_VY = 1.1;      // px/ms threshold for quick swipe
  const MOVE_THRESHOLD = 6;  // px before deciding sheet vs scroll

  function onDown(e: PointerEvent) {
    // Only primary pointer; ignore inputs/buttons to preserve native behavior
    const tgt = e.target as HTMLElement;
    if (tgt.closest('input, textarea, select, [data-sheet-no-drag]')) return;

    pointerEl = e.currentTarget as HTMLElement;
    pointerId = e.pointerId;
    startY = e.clientY;
    lastY = e.clientY;
    lastT = performance.now();
    vy = 0;
    startVal = $y;
    startScroll = content?.scrollTop ?? 0;
    mode = 'idle';
  }

  function onMove(e: PointerEvent) {
    if (pointerId !== e.pointerId) return;
    const now = performance.now();
    const dy = e.clientY - startY;
    const dt = Math.max(1, now - lastT);
    vy = (e.clientY - lastY) / dt;
    lastY = e.clientY;
    lastT = now;

    if (mode === 'idle') {
      if (Math.abs(dy) < MOVE_THRESHOLD) return;
      const pullingDown = dy > 0;
      const atMaxSnap = snapIndex === snaps.length - 1;
      // Decide: if at max snap with scrolled content and pulling up → let content scroll
      // If content scrollTop > 0 and pulling down → content scrolls first
      if (atMaxSnap && startScroll > 0) {
        mode = 'scroll';
      } else if (atMaxSnap && !pullingDown) {
        mode = 'scroll';
      } else {
        mode = 'sheet';
        if (pointerEl) pointerEl.setPointerCapture(pointerId);
      }
    }

    if (mode === 'sheet') {
      e.preventDefault?.();
      const minT = target(snaps.length - 1);
      const maxT = target(0);
      const next = Math.max(minT, Math.min(maxT, startVal + dy));
      y.set(next, { hard: true });
    } else if (mode === 'scroll' && content) {
      content.scrollTop = startScroll - dy;
      // If user scrolled to top and keeps pulling down, flip into sheet mode
      if (content.scrollTop <= 0 && dy > 0 && (e.clientY - lastY) >= 0) {
        // re-anchor drag origin so sheet doesn't jump
        startY = e.clientY;
        startVal = $y;
        mode = 'sheet';
        if (pointerEl) pointerEl.setPointerCapture(pointerId);
      }
    }
  }

  function onUp(e: PointerEvent) {
    if (pointerId !== e.pointerId) return;
    const wasMode = mode;
    mode = 'idle';
    pointerId = -1;
    if (pointerEl) {
      try { pointerEl.releasePointerCapture(e.pointerId); } catch {}
      pointerEl = null;
    }
    if (wasMode !== 'sheet') return;

    // Quick swipe: honor velocity
    if (vy > SWIPE_VY) {
      setSnap(findSnapBelow($y));
      return;
    }
    if (vy < -SWIPE_VY) {
      setSnap(findSnapAbove($y));
      return;
    }
    // Snap to nearest
    const cur = $y;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < snaps.length; i++) {
      const d = Math.abs(cur - target(i));
      if (d < bestD) { bestD = d; best = i; }
    }
    setSnap(best);
  }

  function findSnapBelow(yVal: number): number {
    // Snap smaller/lower than current position (more hidden = larger y)
    for (let i = 0; i < snaps.length; i++) {
      if (target(i) > yVal + 1) return i;
    }
    return 0;
  }
  function findSnapAbove(yVal: number): number {
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (target(i) < yVal - 1) return i;
    }
    return snaps.length - 1;
  }

  export function cycle() { setSnap((snapIndex + 1) % snaps.length); }
  export function collapse() { setSnap(0); }
  export function expand() { setSnap(snaps.length - 1); }
  export { setSnap };
</script>

<div
  class="fixed left-0 right-0 bottom-0 z-30 rounded-t-3xl shadow-[0_-10px_40px_rgba(0,0,0,0.18)] surface border-t border-base flex flex-col pointer-events-auto"
  style="height: {sheetH}px; transform: translateY({$y}px); touch-action: none;"
  on:pointerdown={onDown}
  on:pointermove={onMove}
  on:pointerup={onUp}
  on:pointercancel={onUp}>
  <div class="pt-2 pb-2 flex justify-center select-none shrink-0" role="presentation">
    <div class="w-12 h-1.5 rounded-full" style="background: var(--border);"></div>
  </div>
  <div bind:this={content} class="flex-1 overflow-y-auto overscroll-contain">
    <slot {snapIndex} />
  </div>
</div>
