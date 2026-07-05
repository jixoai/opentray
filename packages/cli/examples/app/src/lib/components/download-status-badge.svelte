<script lang="ts">
  import { Badge } from "$lib/components/ui/badge";
  import type { ActiveDownload } from "$lib/download/event-log.svelte";

  type Props = {
    status: ActiveDownload["status"];
    success?: boolean;
  };
  let { status, success }: Props = $props();
</script>

{#if status === "completed"}
  <Badge variant={success ? "success" : "warning"}>
    {success ? "completed" : "completed (no success)"}
  </Badge>
{:else if status === "failed"}
  <Badge variant="destructive">failed</Badge>
{:else if status === "canceled"}
  <Badge variant="warning">canceled</Badge>
{:else if status === "progress"}
  <Badge variant="secondary">in progress</Badge>
{:else}
  <Badge variant="muted">started</Badge>
{/if}
