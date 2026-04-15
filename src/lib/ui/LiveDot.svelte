<script lang="ts">
  export let label: string = 'V živo';
</script>

<div class="inline-flex items-center gap-1.5">
  <span class="relative inline-flex h-2 w-2">
    <span class="absolute inset-0 rounded-full live-pulse" style="background: var(--status-ontime)"></span>
    <span class="relative inline-flex h-2 w-2 rounded-full" style="background: var(--status-ontime)"></span>
  </span>
  <span class="t-footnote font-medium" style="color: var(--status-ontime)">{label}</span>
</div>
