import * as React from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

const Accordion = AccordionPrimitive.Root;

const AccordionItem = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>
>(({ className, ...props }, ref) => (
  <AccordionPrimitive.Item
    className={cn("border-b border-border", className)}
    {...props}
    ref={ref}
  />
));
AccordionItem.displayName = "AccordionItem";

const AccordionTrigger = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <AccordionPrimitive.Header className="flex">
    <AccordionPrimitive.Trigger
      className={cn(
        "flex flex-1 items-center justify-between gap-2 py-3 text-left text-sm font-semibold transition-all hover:underline [&[data-state=open]>svg]:rotate-180",
        className,
      )}
      {...props}
      ref={ref}
    >
      {children}
      <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-200" />
    </AccordionPrimitive.Trigger>
  </AccordionPrimitive.Header>
));
AccordionTrigger.displayName = AccordionPrimitive.Trigger.displayName;

const AccordionContent = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <AccordionPrimitive.Content
    // Height:auto animation via grid-template-rows interpolation (0fr ↔ 1fr):
    // forceMount keeps the element alive so CLOSING animates too. The direct
    // grid child must be padding-free (padding would floor the collapsed
    // height); spacing lives one level deeper.
    forceMount
    className="grid overflow-hidden text-sm transition-[grid-template-rows] duration-300 ease-out data-[state=closed]:grid-rows-[0fr] data-[state=open]:grid-rows-[1fr]"
    {...props}
    ref={ref}
  >
    <div className="min-h-0 overflow-hidden">
      <div className={cn("pb-4 pt-0", className)}>{children}</div>
    </div>
  </AccordionPrimitive.Content>
));
AccordionContent.displayName = AccordionPrimitive.Content.displayName;

export { Accordion, AccordionContent, AccordionItem, AccordionTrigger };
