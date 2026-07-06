<script lang="ts">
  import { onMount } from "svelte";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Card, CardContent, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { NativeSelect } from "$lib/components/ui/select";
  import Separator from "$lib/components/ui/separator/separator.svelte";
  import { resolveBridge } from "$lib/bridge";
  import { sendHostIntent, onHostMessage } from "$lib/ipc.svelte";
  import { page } from "$app/state";
  import type { NavigatorWindow } from "$lib/types";

  // Platform is passed via query string by the launcher (?platform=darwin).
  const platform = $derived(String(page.url.searchParams.get("platform") ?? "unknown"));

  let bridge = $state<NavigatorWindow | undefined>(undefined);
  let mode = $state<string>("pending");
  let badgeText = $state("");
  let progress = $state(0);
  let progressState = $state("none");
  let progressSupported = $state(true);
  let snapshot = $state<unknown>("Waiting…");
  // Summary mirrors.
  let summaryBadge = $state("none");
  let summaryProgress = $state("0/100");
  let summaryOverlay = $state("none");
  let summaryAttention = $state("off");

  onMount(() => {
    bridge = resolveBridge();
    const stop = onHostMessage("badgePanelState", (data) => {
      const snap = (data.snapshot ?? {}) as Record<string, unknown>;
      mode = String(snap.mode ?? "");
      const caps = snap.capabilities as Record<string, unknown> | undefined;
      progressSupported = String(caps?.progress ?? "") !== "unsupported";
      const state = (snap.state ?? {}) as Record<string, unknown>;
      badgeText = String(state.badgeText ?? "");
      progress = Number(state.progressValue ?? 0);
      progressState = String(state.progressState ?? "none");
      summaryBadge = state.badgeText ? String(state.badgeText) : "none";
      const max = Number(state.progressMax ?? 100);
      summaryProgress = `${Number(state.progressValue ?? 0)}/${max}`;
      summaryOverlay = state.overlayIcon ? String(state.overlayIcon) : "none";
      summaryAttention = state.attention ? "on" : "off";
      snapshot = snap;
    });
    return stop;
  });

  function setBadge(): void {
    sendHostIntent({ type: "badge:set", value: badgeText });
  }
  function clearBadge(): void {
    badgeText = "";
    sendHostIntent({ type: "badge:clear" });
  }
  function setProgress(): void {
    sendHostIntent({ type: "progress:set", value: progress });
  }
  function setProgressState(): void {
    sendHostIntent({ type: "progress:state", value: progressState });
  }
  function setOverlay(value: string): void {
    sendHostIntent({ type: "overlay:set", value });
  }
  function toggleAttention(): void {
    sendHostIntent({ type: "attention:toggle" });
  }
  function refresh(): void {
    sendHostIntent({ type: "refresh" });
  }
  function reset(): void {
    sendHostIntent({ type: "reset" });
  }
  function hide(): void {
    sendHostIntent({ type: "hide" });
  }
  function startDrag(e: PointerEvent): void {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, input, select, textarea")) return;
    if (!bridge?.startAppRegionDrag) return;
    void bridge.startAppRegionDrag({ pointerId: e.pointerId });
  }
  function stringify(value: unknown): string {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
</script>

<div class="flex h-screen flex-col overflow-hidden bg-background/70 backdrop-blur-xl">
  <header
    class="flex items-center justify-between gap-3 border-b border-border px-4 py-3 select-none"
    role="button"
    tabindex="0"
    onpointerdown={startDrag}
  >
    <div class="flex items-center gap-2 font-bold">
      <span class="h-2.5 w-2.5 rounded-full bg-gradient-to-br from-pink-300 to-blue-400"></span>
      <span>Badge Debug Panel</span>
    </div>
    <div class="flex items-center gap-2">
      <Badge variant="muted">{platform}</Badge>
      <Badge variant="muted">{mode}/{platform}</Badge>
      <Button size="sm" variant="ghost" onclick={refresh}>Refresh</Button>
      <Button size="sm" variant="ghost" onclick={reset}>Reset</Button>
      <Button size="sm" variant="ghost" onclick={hide}>Hide</Button>
    </div>
  </header>

  <div class="grid grid-cols-2 gap-3 px-4 pt-4 sm:grid-cols-4">
    <Card><CardContent class="p-3"><div class="text-xs text-muted-foreground">Badge</div><div class="font-medium">{summaryBadge}</div></CardContent></Card>
    <Card><CardContent class="p-3"><div class="text-xs text-muted-foreground">Progress</div><div class="font-medium">{summaryProgress}</div></CardContent></Card>
    <Card><CardContent class="p-3"><div class="text-xs text-muted-foreground">Overlay</div><div class="font-medium">{summaryOverlay}</div></CardContent></Card>
    <Card><CardContent class="p-3"><div class="text-xs text-muted-foreground">Attention</div><div class="font-medium">{summaryAttention}</div></CardContent></Card>
  </div>

  <main class="grid flex-1 grid-cols-1 gap-3 overflow-hidden p-4 lg:grid-cols-2">
    <Card>
      <CardHeader><CardTitle>Badge Controls</CardTitle></CardHeader>
      <CardContent class="flex flex-col gap-4">
        <div class="grid gap-2">
          <Label for="badge-text">Badge text</Label>
          <div class="flex gap-2">
            <Input id="badge-text" maxlength={8} value={badgeText} oninput={(e) => (badgeText = (e.target as HTMLInputElement).value)} placeholder="≤ 8 chars" />
            <Button size="sm" onclick={setBadge}>Set</Button>
            <Button size="sm" variant="ghost" onclick={clearBadge}>Clear</Button>
          </div>
        </div>
        <div class="grid gap-2">
          <Label for="progress">Progress (0–100)</Label>
          <div class="flex gap-2">
            <Input id="progress" type="number" min="0" max="100" value={progress} oninput={(e) => (progress = Number((e.target as HTMLInputElement).value))} disabled={!progressSupported} />
            <Button size="sm" onclick={setProgress} disabled={!progressSupported}>Set</Button>
          </div>
        </div>
        <div class="grid gap-2">
          <Label for="progress-state">Progress state</Label>
          <div class="flex gap-2">
            <NativeSelect id="progress-state" value={progressState} onchange={(e) => (progressState = (e.target as HTMLSelectElement).value)} disabled={!progressSupported}>
              {#each ["none", "indeterminate", "normal", "paused", "error"] as s}
                <option value={s}>{s}</option>
              {/each}
            </NativeSelect>
            <Button size="sm" onclick={setProgressState} disabled={!progressSupported}>Set</Button>
          </div>
          {#if !progressSupported}
            <p class="text-xs text-muted-foreground">Progress is unsupported on this platform.</p>
          {/if}
        </div>
        <Separator />
        <div class="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onclick={() => setOverlay("none")}>Overlay none</Button>
          <Button size="sm" variant="secondary" onclick={() => setOverlay("dot")}>Overlay dot</Button>
          <Button size="sm" variant="secondary" onclick={() => setOverlay("alert")}>Overlay alert</Button>
          <Button size="sm" variant="outline" onclick={toggleAttention}>Toggle attention</Button>
        </div>
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>Contract State</CardTitle></CardHeader>
      <CardContent>
        <pre class="h-full overflow-auto whitespace-pre-wrap break-all text-xs">{stringify(snapshot)}</pre>
      </CardContent>
    </Card>
  </main>
</div>
