<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils.ts";

  type Props = {
    id?: string;
    class?: string;
    value?: string;
    onchange?: (e: Event) => void;
    children: Snippet;
  };

  let { id, class: className, value, onchange, children }: Props = $props();
</script>

<select
  {id}
  class={cn(
    "flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
    className,
  )}
  {value}
  {onchange}
>
  {@render children()}
</select>
