<script lang="ts">
  import { onMount } from "svelte";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Card, CardContent, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { resolveBridge, resolveNamespace } from "$lib/bridge";
  import { sendHostIntent, onHostMessage } from "$lib/ipc.svelte";
  import type { WebviewBridge, NavigatorWindow } from "$lib/types";

  // Mirrors the PLACEMENTS list in the launcher.
  const PLACEMENTS = [
    "tray",
    "screen-center",
    "screen-top",
    "screen-right",
    "screen-bottom",
    "screen-left",
    "screen-top-left",
    "screen-top-right",
    "screen-bottom-left",
    "screen-bottom-right",
    "edge",
    "edge-x",
    "edge-y",
    "edge-top",
    "edge-right",
    "edge-bottom",
    "edge-left",
  ] as const;

  let bridge = $state<NavigatorWindow | undefined>(undefined);
  let mode = $state<string>("watch:tray");
  let placement = $state<unknown>("Waiting…");
  let bounds = $state<unknown>("Waiting…");

  onMount(() => {
    bridge = resolveBridge();
    const stop = onHostMessage("placementKitState", (data) => {
      mode = String(data.mode ?? "");
      placement = data.placement ?? null;
      bounds = data.bounds ?? null;
    });
    return stop;
  });

  function watch(placement: string): void {
    sendHostIntent({ type: "watch", placement });
  }
  function once(placement: string): void {
    sendHostIntent({ type: "once", placement });
  }
  function refresh(): void {
    sendHostIntent({ type: "refresh" });
  }
  function stop(): void {
    sendHostIntent({ type: "stop" });
  }
  function hide(): void {
    sendHostIntent({ type: "hide" });
  }
  function startDrag(e: PointerEvent): void {
    if (e.button !== 0) return;
    if (!bridge?.startAppRegionDrag) return;
    void bridge.startAppRegionDrag({ pointerId: e.pointerId }).catch(() => {
      sendHostIntent({ type: "windowInteraction", active: false });
    });
  }
  function stringify(value: unknown): string {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
</script>

<div class="flex h-screen flex-col overflow-hidden">
  <header
    class="flex items-center justify-between gap-3 border-b border-border px-4 py-3 select-none"
    role="button"
    tabindex="0"
    onpointerdown={startDrag}
  >
    <div class="flex items-center gap-2 font-bold">
      <span class="h-2.5 w-2.5 rounded-full bg-gradient-to-br from-emerald-300 to-blue-400"></span>
      <span>Placement Kit</span>
    </div>
    <div class="flex items-center gap-2">
      <Badge variant="muted">{mode}</Badge>
      <Button size="sm" variant="ghost" onclick={refresh}>Refresh</Button>
      <Button size="sm" variant="ghost" onclick={stop}>Stop</Button>
      <Button size="sm" variant="ghost" onclick={hide}>Hide</Button>
    </div>
  </header>
  <main class="grid flex-1 grid-cols-1 gap-3 overflow-hidden p-4 sm:grid-cols-2">
    <Card>
      <CardHeader><CardTitle>Watch</CardTitle></CardHeader>
      <CardContent>
        <div class="flex max-h-[60vh] flex-wrap gap-1.5 overflow-auto">
          {#each PLACEMENTS as p}
            <Button size="sm" variant="secondary" onclick={() => watch(p)}>{p}</Button>
          {/each}
        </div>
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>Apply Once</CardTitle></CardHeader>
      <CardContent>
        <div class="flex max-h-[60vh] flex-wrap gap-1.5 overflow-auto">
          {#each PLACEMENTS as p}
            <Button size="sm" variant="outline" onclick={() => once(p)}>{p}</Button>
          {/each}
        </div>
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>Placement Result</CardTitle></CardHeader>
      <CardContent>
        <pre class="overflow-auto whitespace-pre-wrap break-all text-xs">{stringify(placement)}</pre>
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>Window Bounds</CardTitle></CardHeader>
      <CardContent>
        <pre class="overflow-auto whitespace-pre-wrap break-all text-xs">{stringify(bounds)}</pre>
      </CardContent>
    </Card>
  </main>
</div>
