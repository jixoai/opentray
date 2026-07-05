<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils.ts";
  import { buttonVariants, type ButtonVariant, type ButtonSize } from "./variants";

  type Props = {
    variant?: ButtonVariant;
    size?: ButtonSize;
    class?: string;
    children: Snippet;
    onclick?: (e: MouseEvent) => void;
    disabled?: boolean;
    title?: string;
  };

  let {
    variant = "default",
    size = "default",
    class: className,
    children,
    onclick,
    disabled = false,
    title,
  }: Props = $props();
</script>

<button
  class={cn(buttonVariants({ variant, size }), className)}
  {onclick}
  {disabled}
  {title}
  type="button"
>
  {@render children()}
</button>
