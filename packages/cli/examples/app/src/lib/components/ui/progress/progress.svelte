<script lang="ts">
  import { cn } from "$lib/utils.ts";

  // Determinate progress bar. Pass value in [0, 1]; indeterminate when value === null.
  type Props = {
    value: number | null;
    class?: string;
  };

  let { value, class: className }: Props = $props();

  const pct = $derived(
    value === null || value === undefined
      ? null
      : Math.max(0, Math.min(1, value)) * 100,
  );
</script>

<div
  class={cn(
    "relative h-2 w-full overflow-hidden rounded-full bg-primary/15",
    className,
  )}
  role="progressbar"
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={pct ?? undefined}
>
  {#if pct === null}
    <div
      class="absolute inset-y-0 left-0 w-1/3 animate-pulse rounded-full bg-primary/60"
    ></div>
  {:else}
    <div
      class="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-150 ease-out"
      style="width: {pct}%"
    ></div>
  {/if}
</div>
