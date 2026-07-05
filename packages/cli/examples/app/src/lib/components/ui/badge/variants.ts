import { tv, type VariantProps } from "tailwind-variants";

export const badgeVariants = tv({
  base: "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none",
  variants: {
    variant: {
      default: "border-transparent bg-primary text-primary-foreground shadow",
      secondary:
        "border-transparent bg-secondary text-secondary-foreground",
      destructive:
        "border-transparent bg-destructive text-destructive-foreground shadow",
      outline: "text-foreground",
      success: "border-transparent bg-emerald-500/15 text-emerald-500",
      warning: "border-transparent bg-amber-500/15 text-amber-500",
      muted: "border-transparent bg-muted text-muted-foreground",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];
