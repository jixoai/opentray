<script lang="ts">
  import { Badge, type BadgeVariant } from "$lib/components/ui/badge";

  type Props = { event: string };
  let { event }: Props = $props();

  const variant = $derived<BadgeVariant>(
    event === "downloadcompleted"
      ? "success"
      : event === "downloadfailed"
        ? "destructive"
        : event === "downloadcanceled"
          ? "warning"
          : event === "downloadprogress"
            ? "secondary"
            : "default",
  );
</script>

<Badge {variant}>{event}</Badge>
