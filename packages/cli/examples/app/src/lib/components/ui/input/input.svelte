<script lang="ts">
  import { cn } from "$lib/utils.ts";

  type Props = {
    id?: string;
    class?: string;
    value?: string | number;
    type?: string;
    placeholder?: string;
    oninput?: (e: Event) => void;
    disabled?: boolean;
    maxlength?: number;
    min?: number | string;
    max?: number | string;
    step?: number | string;
  };

  let {
    id,
    class: className,
    value = "",
    type = "text",
    placeholder,
    oninput,
    disabled = false,
    maxlength,
    min,
    max,
    step,
  }: Props = $props();
</script>

<input
  {id}
  class={cn(
    "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
    className,
  )}
  {type}
  {value}
  {placeholder}
  {oninput}
  {disabled}
  {maxlength}
  {min}
  {max}
  {step}
/>
