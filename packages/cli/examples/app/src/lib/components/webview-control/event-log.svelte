<script lang="ts">
  import { Card, CardContent, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Button } from "$lib/components/ui/button";
  import { store, type EventLogEntry } from "./store.svelte";

  function formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, { hour12: false });
  }
  function stringify(value: unknown): string {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
</script>

<Card>
  <CardHeader>
    <div class="flex items-center justify-between gap-3">
      <CardTitle>Events</CardTitle>
      <Button variant="ghost" size="sm" onclick={() => store.clearEvents()}>Clear</Button>
    </div>
  </CardHeader>
  <CardContent>
    {#if store.events.length === 0}
      <p class="text-sm text-muted-foreground">Waiting for native events.</p>
    {:else}
      <ol class="flex flex-col gap-1.5 font-mono text-xs">
        {#each store.events as entry (entry.id)}
          <li class="rounded-md border p-2">
            <div class="flex items-center gap-2">
              <span class="text-muted-foreground">{formatTime(entry.ts)}</span>
              <span class="font-semibold">{entry.label}</span>
            </div>
            <pre class="mt-1 whitespace-pre-wrap break-all text-[11px] leading-relaxed text-foreground/90">{stringify(entry.payload)}</pre>
          </li>
        {/each}
      </ol>
    {/if}
  </CardContent>
</Card>
