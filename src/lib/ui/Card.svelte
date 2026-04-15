<script lang="ts">
  export let padding: 'none' | 'sm' | 'md' | 'lg' = 'md';
  export let elevation: 0 | 1 | 2 = 1;
  const pad = { none: '', sm: 'p-3', md: 'p-4', lg: 'p-5' }[padding];
  const shadow = [ '', 'shadow-card', 'shadow-elev' ][elevation];
</script>

<div class="surface rounded-2xl border border-base {shadow} {pad}">
  <slot />
</div>
