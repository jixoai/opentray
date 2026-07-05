<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils.ts";
  import { badgeVariants, type BadgeVariant } from "./variants";

  type Props = {
    variant?: BadgeVariant;
    class?: string;
    children: Snippet;
    title?: string;
  };

  let {
    variant = "default",
    class: className,
    children,
    title,
  }: Props = $props();
</script>

<span class={cn(badgeVariants({ variant }), className)} {title}>
  {@render children()}
</span>
