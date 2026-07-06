<script lang="ts">
  import { onMount, tick } from "svelte";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Card, CardContent, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { resolveBridge, resolveNamespace, type ScreenApi } from "$lib/bridge";
  import type { NavigatorWindow } from "$lib/types";

  let bridge = $state<NavigatorWindow | undefined>(undefined);
  let trayApi = $state<{ getBounds?(): Promise<unknown> } | undefined>(undefined);
  let screenApi = $state<ScreenApi | undefined>(undefined);
  let trayStatus = $state<unknown>("Waiting for navigator.opentray.tray…");
  let screenStatus = $state<unknown>("Waiting for navigator.opentrayScreen…");
  let sessionStatus = $state<unknown>("Waiting for page session marker…");
  let styleStatus = $state<unknown>("Waiting for navigator.window style…");

  // Session-reuse markers. bootId stays stable across hide/show; it only
  // changes after destroy or content replacement. openCount increments on every
  // page (re)load. Mirrors the original window.__OPENTRAY_TRAY_PANEL_* globals.
  const bootId =
    (globalThis as { __OPENTRAY_TRAY_PANEL_BOOT_ID__?: string }).__OPENTRAY_TRAY_PANEL_BOOT_ID__ ??=
    Math.random().toString(36).slice(2, 10);
  const openCount = ((globalThis as { __OPENTRAY_TRAY_PANEL_OPEN_COUNT__?: number }).__OPENTRAY_TRAY_PANEL_OPEN_COUNT__ ??= 0) + 1;
  (globalThis as { __OPENTRAY_TRAY_PANEL_OPEN_COUNT__?: number }).__OPENTRAY_TRAY_PANEL_OPEN_COUNT__ = openCount;

  onMount(() => {
    bridge = resolveBridge();
    trayApi = resolveNamespace()?.tray as { getBounds?(): Promise<unknown> } | undefined;
    if (typeof navigator !== "undefined") {
      const nav = navigator as Navigator & { opentrayScreen?: ScreenApi; screen?: ScreenApi };
      screenApi = nav.opentrayScreen ?? (nav.screen?.getScreenDetails ? nav.screen : undefined);
    }
    refreshSession();
    void refreshAnchor();
    void refreshStyle();
    const stop = bridge?.listen?.("stylechange", () => {
      void refreshStyle();
    });
    // Fit once at bootstrap; after that, user resize owns the window size.
    void tick().then(() => placePanel(true));
    return () => {
      void Promise.resolve(stop).then((fn) => fn?.());
    };
  });

  async function refreshAnchor(): Promise<void> {
    try {
      const bounds = await trayApi?.getBounds?.();
      trayStatus = bounds ?? null;
    } catch {
      trayStatus = { error: "tray.getBounds failed" };
    }
  }
  async function refreshStyle(): Promise<void> {
    if (!bridge?.getStyle) {
      styleStatus = "navigator.window.getStyle() unavailable";
      return;
    }
    try {
      const style = (await bridge.getStyle()) as Record<string, unknown>;
      const bg = style.background as Record<string, unknown> | undefined;
      styleStatus = {
        ...style,
        effectiveClearBackground:
          bg?.kind === "transparent" ||
          bg?.kind === "platformMaterial" ||
          bg?.kind === "semantic",
      };
    } catch {
      styleStatus = { error: "getStyle failed" };
    }
  }
  function refreshSession(): void {
    sessionStatus = {
      bootId,
      openCount,
      note: "bootId stays stable across hide/show; it only changes after destroy or content replacement",
    };
  }
  async function toggleTransparent(): Promise<void> {
    if (!bridge?.setBackground || !bridge.getStyle) return;
    const style = (await bridge.getStyle()) as Record<string, unknown>;
    const bg = style.background as Record<string, unknown> | undefined;
    await bridge.setBackground(bg?.kind === "transparent" ? "opaque" : "transparent");
    await refreshStyle();
  }
  async function toggleMaterial(): Promise<void> {
    if (!bridge?.setBackground || !bridge.getStyle) return;
    const style = (await bridge.getStyle()) as Record<string, unknown>;
    const bg = style.background as Record<string, unknown> | undefined;
    const hasMaterial = bg?.kind === "platformMaterial" || bg?.kind === "semantic";
    const platform = style.platform as Record<string, unknown> | undefined;
    if (platform?.windows) {
      await bridge.setBackground(hasMaterial ? "opaque" : "mica");
    } else {
      await bridge.setBackground(
        hasMaterial ? "opaque" : { kind: "platformMaterial", material: "hudWindow", state: "active" },
      );
    }
    await refreshStyle();
  }
  async function placePanel(resizeToContent = false): Promise<void> {
    const win = bridge;
    const screen = screenApi;
    if (!win || !screen) return;
    const panelEl = document.querySelector<HTMLElement>(".tray-panel-root");
    const measure = (): { width: number; height: number } => {
      if (!panelEl) return { width: 388, height: 286 };
      const rect = panelEl.getBoundingClientRect();
      return { width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
    };
    const currentSize = async (): Promise<{ width: number; height: number }> => {
      if (!win.getBounds) return measure();
      try {
        const bounds = (await win.getBounds()) as { width?: number; height?: number };
        return {
          width: Math.ceil(bounds.width ?? 0),
          height: Math.ceil(bounds.height ?? 0),
        };
      } catch {
        return measure();
      }
    };
    const size = resizeToContent ? measure() : await currentSize();
    const [details, bounds] = await Promise.all([
      screen.getScreenDetails() as Promise<{
        currentScreen?: { visibleFrame: { x: number; y: number; width: number; height: number } };
        screens?: Array<{ visibleFrame: { x: number; y: number; width: number; height: number } }>;
      }>,
      (trayApi?.getBounds?.() ?? Promise.resolve(null)) as Promise<
        { rect?: { x: number; y: number; width: number; height: number } } | null
      >,
    ]);
    const cur = details.currentScreen ?? details.screens?.[0];
    if (!cur) return;
    const trayRect = bounds?.rect ?? null;
    const { width, height } = size;
    const margin = 12;
    const trayCenterX = trayRect
      ? trayRect.x + trayRect.width / 2
      : cur.visibleFrame.x + cur.visibleFrame.width / 2;
    const targetX = Math.round(
      Math.min(
        cur.visibleFrame.x + cur.visibleFrame.width - width - margin,
        Math.max(cur.visibleFrame.x + margin, trayCenterX - width / 2),
      ),
    );
    const targetY = Math.round(
      Math.min(
        cur.visibleFrame.y + cur.visibleFrame.height - height - margin,
        Math.max(
          cur.visibleFrame.y + margin,
          trayRect ? trayRect.y - height - 8 : cur.visibleFrame.y + cur.visibleFrame.height - height - 24,
        ),
      ),
    );
    if (resizeToContent) {
      await win.resizeTo(width, height);
    }
    await win.moveTo(targetX, targetY);
    screenStatus = { targetX, targetY, visibleFrame: cur.visibleFrame };
  }
  function startDrag(e: PointerEvent): void {
    if (e.button !== 0) return;
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

<section class="tray-panel-root flex h-screen flex-col overflow-hidden bg-transparent">
  <header
    class="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 select-none"
    role="button"
    tabindex="0"
    onpointerdown={startDrag}
  >
    <div class="flex items-center gap-2 font-bold">
      <span class="h-2.5 w-2.5 rounded-full bg-gradient-to-br from-emerald-300 to-blue-400"></span>
      <span>TrayPanel</span>
    </div>
    <div class="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" onclick={toggleTransparent}>Toggle Transparent</Button>
      <Button size="sm" variant="outline" onclick={toggleMaterial}>Toggle Backdrop</Button>
      <Button size="sm" variant="outline" onclick={() => placePanel(false)}>Reposition</Button>
      <Button size="sm" variant="destructive" onclick={() => bridge?.close()}>Close</Button>
    </div>
  </header>
  <div class="grid flex-1 grid-cols-1 gap-3 overflow-auto p-4 sm:grid-cols-2">
    <Card>
      <CardHeader><CardTitle>Scenario</CardTitle></CardHeader>
      <CardContent>
        <div class="flex flex-wrap gap-1.5">
          {#each ["primaryEvent", "tray.getBounds()", "screen.getScreenDetails()", "frameless glass", "keepOnTop"] as chip}
            <Badge variant="muted">{chip}</Badge>
          {/each}
        </div>
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>Tray anchor</CardTitle></CardHeader>
      <CardContent><pre class="overflow-auto whitespace-pre-wrap break-all text-xs">{stringify(trayStatus)}</pre></CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>Screen placement</CardTitle></CardHeader>
      <CardContent><pre class="overflow-auto whitespace-pre-wrap break-all text-xs">{stringify(screenStatus)}</pre></CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>Session reuse</CardTitle></CardHeader>
      <CardContent><pre class="overflow-auto whitespace-pre-wrap break-all text-xs">{stringify(sessionStatus)}</pre></CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>Window style</CardTitle></CardHeader>
      <CardContent><pre class="overflow-auto whitespace-pre-wrap break-all text-xs">{stringify(styleStatus)}</pre></CardContent>
    </Card>
  </div>
</section>
