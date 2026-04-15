<script lang="ts">
  import { routeColor } from '../gtfs';
  export let short: string;
  export let routeId: number;
  export let size: 'sm' | 'md' | 'lg' = 'md';
  const s = {
    sm: 'h-7 min-w-[2rem] px-2 text-[13px]',
    md: 'h-9 min-w-[2.5rem] px-2.5 text-[16px]',
    lg: 'h-11 min-w-[3rem] px-3 text-[18px]',
  }[size];
</script>

<span class="inline-flex items-center justify-center rounded-lg text-white font-bold {s}"
      style="background-color: {routeColor(routeId)}">
  {short}
</span>
