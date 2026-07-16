<script lang="ts">
  // Orthogonal intents (2026-07-16; original user request: prove whether a minimal resize clears
  // residue that clearWhiteBlock leaves behind):
  // 1. Preserve a manual shell-state clear as the comparison baseline.
  // 2. Pulse trusted native bounds by one pixel and restore them without claiming pixel success.
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Label } from "$lib/components/ui/label";
  import { execCommand, formatError, store } from "$lib/components/webview-control/store.svelte";
  import type { NavigatorWindow } from "$lib/types";

  type Props = { bridge: NavigatorWindow };
  type Bounds = { width: number; height: number };
  let { bridge }: Props = $props();
  let lastOperation = $state("idle");
  let busy = $state(false);

  async function toggleFrameless(): Promise<void> {
    await run("frameless-toggle", async () => {
      const style = await bridge.getStyle();
      await bridge.setStyle({ frameless: style.frameless !== true });
    });
  }

  async function manualClear(): Promise<void> {
    await run("manual-clear", async () => {
      execCommand("clearWhiteBlock");
    });
  }

  async function onePixelPulse(): Promise<void> {
    await run("one-pixel-pulse", async () => {
      const bounds = readBounds(await bridge.getBounds());
      await bridge.resizeTo(bounds.width + 1, bounds.height);
      await wait(48);
      await bridge.resizeTo(bounds.width, bounds.height);
    });
  }

  async function run(label: string, action: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    lastOperation = label;
    store.appendEvent(`win32-bug:${label}:requested`, { at: Date.now() });
    try {
      await action();
      store.appendEvent(`win32-bug:${label}:dispatched`, { at: Date.now() });
    } catch (error) {
      lastOperation = `${label}:error`;
      store.appendEvent(`win32-bug:${label}:error`, { error: formatError(error) });
    } finally {
      busy = false;
    }
  }

  function readBounds(value: unknown): Bounds {
    if (!isRecord(value) || typeof value.width !== "number" || typeof value.height !== "number") {
      throw new Error("native bounds are unavailable for the resize pulse");
    }
    const width = Math.round(value.width);
    const height = Math.round(value.height);
    if (width < 1 || height < 1) {
      throw new Error("native bounds are invalid for the resize pulse");
    }
    return { width, height };
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }
</script>

<Card>
  <CardHeader>
    <div class="flex items-center justify-between gap-2">
      <CardTitle>Residue Probe</CardTitle>
      <Badge variant={busy ? "warning" : "muted"}>{busy ? "running" : lastOperation}</Badge>
    </div>
  </CardHeader>
  <CardContent class="flex flex-col gap-4">
    <div class="grid gap-2">
      <Label>Transition</Label>
      <div class="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy} onclick={toggleFrameless}>Toggle frameless</Button>
        <Button size="sm" variant="outline" disabled={busy} onclick={manualClear}>clearWhiteBlock</Button>
        <Button size="sm" variant="secondary" disabled={busy} onclick={onePixelPulse}>Pulse width +1px</Button>
      </div>
    </div>
    <code class="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">{lastOperation}</code>
  </CardContent>
</Card>
