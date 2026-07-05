<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils.ts";

  type Props = { class?: string; children: Snippet };
  let { class: className, children }: Props = $props();
</script>

<div class={cn("p-6 pt-0", className)}>
  {@render children()}
</div>
