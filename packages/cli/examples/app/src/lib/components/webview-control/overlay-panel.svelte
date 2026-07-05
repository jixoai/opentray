<script lang="ts">
  import { Card, CardContent, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { store, formatError } from "./store.svelte";
  import type { NavigatorWindow } from "$lib/types";

  type Props = { bridge: NavigatorWindow };
  let { bridge }: Props = $props();

  let overlayEnabled = $state(false);
  let overlayRect = $state<unknown>(null);
  let listenActive = $state(false);
  let unlisten: (() => void) | null = null;

  // Check overlay availability on mount.
  $effect(() => {
    overlayEnabled = Boolean((bridge as { overlay?: unknown }).overlay);
  });

  async function refreshGeometry(): Promise<void> {
    try {
      const overlay = (bridge as { overlay?: { getTitlebarAreaRect(): Promise<unknown> } }).overlay;
      if (!overlay) return;
      const rect = await overlay.getTitlebarAreaRect();
      overlayRect = rect;
      store.appendEvent("overlay.geometry", rect);
      applyInsets(rect);
    } catch (error) {
      store.appendEvent("overlay.geometry:error", { error: formatError(error) });
    }
  }
  function applyInsets(rect: unknown): void {
    const r = rect as { x?: number; width?: number; height?: number } | null;
    if (!r) return;
    const w = typeof r.width === "number" ? r.width : 0;
    const h = typeof r.height === "number" ? r.height : 44;
    store.setOverlayInsets({ left: 0, right: 0, height: h });
    store.setOverlayStatusText(`w=${Math.round(w)} h=${Math.round(h)}`);
  }
  async function toggleListen(): Promise<void> {
    if (listenActive && unlisten) {
      unlisten();
      unlisten = null;
      listenActive = false;
      return;
    }
    try {
      const overlay = (bridge as { overlay?: { listen(e: string, cb: (e: unknown) => void): Promise<() => void> } }).overlay;
      if (!overlay) return;
      const stop = await overlay.listen("geometrychange", (event) => {
        const rect = (event as { titlebarAreaRect?: unknown }).titlebarAreaRect;
        overlayRect = rect;
        applyInsets(rect);
        store.appendEvent("overlay.geometrychange", event);
      });
      unlisten = () => void stop();
      listenActive = true;
    } catch (error) {
      store.appendEvent("overlay.listen:error", { error: formatError(error) });
    }
  }
  function startDrag(e: PointerEvent): void {
    void bridge.startAppRegionDrag({ x: e.clientX, y: e.clientY, pointerId: e.pointerId });
  }
</script>

<Card>
  <CardHeader>
    <div class="flex items-center justify-between gap-2">
      <CardTitle>Overlay</CardTitle>
      <Badge variant={overlayEnabled ? "success" : "muted"}>
        {overlayEnabled ? "enabled" : "disabled"}
      </Badge>
    </div>
  </CardHeader>
  <CardContent class="flex flex-col gap-3">
    <div class="flex flex-wrap gap-2">
      <Button size="sm" onclick={refreshGeometry} disabled={!overlayEnabled}>Geometry</Button>
      <Button size="sm" variant={listenActive ? "secondary" : "outline"} onclick={toggleListen} disabled={!overlayEnabled}>
        {listenActive ? "Stop listening" : "Listen geometrychange"}
      </Button>
    </div>
    <div
      class="flex items-center justify-center rounded-md border border-dashed border-border p-6 text-xs text-muted-foreground"
      role="button"
      tabindex="0"
      onpointerdown={startDrag}
    >
      Drag test area (startAppRegionDrag)
    </div>
    {#if overlayRect}
      <pre class="overflow-auto rounded-md bg-muted/40 p-2 text-[11px] whitespace-pre-wrap break-all">{JSON.stringify(overlayRect, null, 2)}</pre>
    {/if}
  </CardContent>
</Card>
