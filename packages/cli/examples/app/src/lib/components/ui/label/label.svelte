<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils.ts";

  type Props = { class?: string; for?: string; children: Snippet };
  let { class: className, for: htmlFor, children }: Props = $props();
</script>

<label
  class={cn(
    "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
    className,
  )}
  for={htmlFor}
>
  {@render children()}
</label>
