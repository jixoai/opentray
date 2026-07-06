<script lang="ts">
  import { onMount } from "svelte";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Card, CardContent, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { resolveBridge } from "$lib/bridge";
  import { sendHostIntent, onHostMessage } from "$lib/ipc.svelte";
  import type { NavigatorWindow } from "$lib/types";

  const SIZES = [
    { label: "Compact", width: 360, height: 260 },
    { label: "Comfort", width: 480, height: 300 },
    { label: "Wide", width: 640, height: 340 },
    { label: "Tall", width: 460, height: 430 },
  ] as const;

  let bridge = $state<NavigatorWindow | undefined>(undefined);
  let mode = $state<string>("pending");
  let matchedState = $state<unknown>("Waiting…");
  let bounds = $state<unknown>("Waiting…");

  onMount(() => {
    bridge = resolveBridge();
    const stop = onHostMessage("mediaQueryKitState", (data) => {
      const widthMode = String(data.widthMode ?? "");
      const heightMode = String(data.heightMode ?? "");
      mode = `${widthMode}/${heightMode}`;
      matchedState = {
        widthMode,
        heightMode,
        watchActive: data.watchActive,
      };
      bounds = data.bounds ?? null;
    });
    return stop;
  });

  function resize(width: number, height: number): void {
    sendHostIntent({ type: "resize", width, height });
  }
  function refresh(): void {
    sendHostIntent({ type: "refresh" });
  }
  function hide(): void {
    sendHostIntent({ type: "hide" });
  }
  function startDrag(e: PointerEvent): void {
    if (e.button !== 0) return;
    sendHostIntent({ type: "windowInteraction", active: true });
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
      <span class="h-2.5 w-2.5 rounded-full bg-gradient-to-br from-amber-300 to-blue-400"></span>
      <span>Media Query Kit</span>
    </div>
    <div class="flex items-center gap-2">
      <Badge variant="muted">{mode}</Badge>
      <Button size="sm" variant="ghost" onclick={refresh}>Refresh</Button>
      <Button size="sm" variant="ghost" onclick={hide}>Hide</Button>
    </div>
  </header>
  <main class="flex flex-1 flex-col gap-3 overflow-hidden p-4">
    <div class="flex flex-wrap gap-2">
      {#each SIZES as s}
        <Button size="sm" variant="secondary" onclick={() => resize(s.width, s.height)}>{s.label}</Button>
      {/each}
    </div>
    <section class="grid flex-1 gap-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
      <Card>
        <CardHeader><CardTitle>Matched State</CardTitle></CardHeader>
        <CardContent>
          <pre class="overflow-auto whitespace-pre-wrap break-all text-xs">{stringify(matchedState)}</pre>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Native Bounds</CardTitle></CardHeader>
        <CardContent>
          <pre class="overflow-auto whitespace-pre-wrap break-all text-xs">{stringify(bounds)}</pre>
        </CardContent>
      </Card>
    </section>
  </main>
</div>
