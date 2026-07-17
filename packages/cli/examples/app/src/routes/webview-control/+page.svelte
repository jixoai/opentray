<script lang="ts">
  import { onMount } from "svelte";
  import { Badge } from "$lib/components/ui/badge";
  import Titlebar from "$lib/components/webview-control/titlebar.svelte";
  import WindowPanel from "$lib/components/webview-control/window-panel.svelte";
  import OverlayPanel from "$lib/components/webview-control/overlay-panel.svelte";
  import MetadataPanel from "$lib/components/webview-control/metadata-panel.svelte";
  import NavigationPanel from "$lib/components/webview-control/navigation-panel.svelte";
  import ScreenPanel from "$lib/components/webview-control/screen-panel.svelte";
  import EventLog from "$lib/components/webview-control/event-log.svelte";
  import {
    resolveWindowBridge,
    resolveScreenApi,
    store,
    formatError,
    type ScreenApi,
  } from "$lib/components/webview-control/store.svelte";

  let bridge = $state(resolveWindowBridge());
  let screenApi = $state<ScreenApi | undefined>(resolveScreenApi());

  onMount(() => {
    if (!bridge) return;
    // Bridge event wiring (bindWindowEvents in the original).
    const unlistens: Array<() => void> = [];
    const subscribe = (event: string, handler: (payload: unknown) => void): void => {
      const stop = bridge!.listen(event, (raw) => handler(raw.payload));
      unlistens.push(() => void Promise.resolve(stop).then((fn) => fn?.()));
    };

    subscribe("moved", (p) => store.appendEvent("moved", p));
    subscribe("resized", (p) => store.appendEvent("resized", p));
    subscribe("stylechange", (p) => {
      store.appendEvent("stylechange", p);
      store.setStyle(p as Record<string, unknown>);
    });
    subscribe("titlechange", (p) => {
      const title = (p as { title?: string }).title ?? "";
      store.setTitle(title);
      store.appendEvent("titlechange", p);
    });
    subscribe("iconchange", (p) => store.appendEvent("iconchange", p));
    subscribe("windowstatechange", (p) => {
      store.setWindowState(p as never);
      store.appendEvent("windowstatechange", p);
    });
    subscribe("closed", (p) => store.appendEvent("closed", p));

    // Window-level listeners.
    const onMessage = (e: MessageEvent): void => store.appendEvent("message", e.data);
    const onError = (e: ErrorEvent): void =>
      store.appendEvent("error", { message: e.message, source: e.filename, line: e.lineno, column: e.colno });
    const onRejection = (e: PromiseRejectionEvent): void =>
      store.appendEvent("unhandledrejection", { reason: formatError(e.reason) });
    window.addEventListener("message", onMessage);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    // Initial refresh.
    void refreshCapabilities();
    void refreshWindowState();
    // Overlay geometry: auto-fetch on mount + subscribe to changes so the
    // titlebar avoids the native window controls (macOS traffic lights on the
    // left, Windows caption buttons on the right) without waiting for a user
    // to click the "Geometry" button.
    void refreshOverlayGeometry();
    const overlayBridge = (bridge as { overlay?: { listen?: (e: string, cb: (e: unknown) => void) => Promise<() => void> } }).overlay;
    if (overlayBridge?.listen) {
      void overlayBridge.listen("geometrychange", (event) => {
        const rect = (event as { titlebarAreaRect?: RectLike })?.titlebarAreaRect;
        if (rect) applyOverlayInsets(rect);
        store.appendEvent("overlay.geometrychange", event);
      });
    }

    return () => {
      unlistens.forEach((u) => u());
      window.removeEventListener("message", onMessage);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  });

  async function refreshCapabilities(): Promise<void> {
    if (!bridge) return;
    try {
      const caps = (await bridge.getCapabilities()) as Record<string, unknown>;
      store.setCapabilities(caps);
    } catch (error) {
      store.appendEvent("capabilities:error", { error: formatError(error) });
    }
  }
  async function refreshWindowState(): Promise<void> {
    if (!bridge) return;
    try {
      const state = await bridge.getWindowState();
      store.setWindowState(state as never);
    } catch (error) {
      store.appendEvent("windowstate:error", { error: formatError(error) });
    }
  }

  // titlebarAreaRect is the safe/draggable region the page may own; native
  // window controls are excluded from it. x = right edge of macOS traffic lights
  // (or Windows left inset); x + width = left edge of Windows caption buttons.
  type RectLike = { x?: number; y?: number; width?: number; height?: number };
  function applyOverlayInsets(rect: RectLike): void {
    const x = typeof rect.x === "number" ? rect.x : 0;
    const w = typeof rect.width === "number" ? rect.width : 0;
    const h = typeof rect.height === "number" ? rect.height : 44;
    const innerW = typeof window !== "undefined" ? window.innerWidth : 0;
    // left inset avoids the macOS traffic lights; right inset avoids the
    // Windows caption-button cluster. On the platform that has no controls on
    // a side, that side's inset resolves to 0.
    store.setOverlayInsets({
      left: Math.max(0, x),
      right: Math.max(0, innerW - (x + w)),
      height: Math.max(28, h),
    });
    store.setOverlayStatusText(`x=${Math.round(x)} w=${Math.round(w)} h=${Math.round(h)}`);
  }
  async function refreshOverlayGeometry(): Promise<void> {
    const overlay = (bridge as { overlay?: { getTitlebarAreaRect?: () => Promise<RectLike> } }).overlay;
    if (!overlay?.getTitlebarAreaRect) return;
    try {
      const rect = await overlay.getTitlebarAreaRect();
      applyOverlayInsets(rect);
      store.appendEvent("overlay.geometry", rect);
    } catch (error) {
      store.appendEvent("overlay.geometry:error", { error: formatError(error) });
    }
  }

  const origin = $derived(typeof location !== "undefined" ? location.origin : "");
  // The overlay object is exposed only when windowControlsOverlay is on, which
  // means native controls are still visible (FullSizeContentView on macOS) and
  // the titlebar must pad around them.
  const overlayActive = $derived(
    Boolean((bridge as { overlay?: unknown } | undefined)?.overlay),
  );
  // Self-drawn window controls (close/min/max/restore) must appear when the
  // native controls are GONE — i.e. on a frameless (Borderless) window. On a
  // framed window (with or without overlay) the native controls are still
  // visible, so drawing our own would duplicate them. This is distinct from
  // overlayActive: a framed+overlay window has native controls AND an overlay
  // object; a frameless window has neither native controls nor (typically) an
  // overlay object.
  // NOTE: capabilities.frameless is a capability flag (always true on macOS that
  // supports frameless), NOT the current window state. The current frameless
  // state lives in getStyle().frameless — use that to decide whether native
  // controls are gone and self-drawn controls must appear.
  const frameless = $derived(
    Boolean((store.style as { frameless?: boolean } | null)?.frameless),
  );
  const showWindowControls = $derived(frameless);
</script>

<div class="flex h-screen flex-col overflow-hidden bg-background/10">
  {#if bridge}
    <Titlebar {bridge} {overlayActive} {showWindowControls} />
  {/if}
  <main class="flex-1 overflow-auto p-4">
    <header class="mb-4 flex flex-wrap items-center gap-3">
      <div>
        <h1 class="text-lg font-semibold tracking-tight">WebView Control</h1>
        <p class="text-xs text-muted-foreground">
          Window, style, overlay, screen, and navigation bridge surface.
        </p>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <Badge variant={bridge ? "success" : "destructive"}>
          bridge {bridge ? "ready" : "unavailable"}
        </Badge>
        <Badge variant={screenApi ? "success" : "muted"}>
          screen {screenApi ? "ready" : "unavailable"}
        </Badge>
        <Badge variant="muted" title={origin}>{origin}</Badge>
      </div>
    </header>

    {#if !bridge}
      <p class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
        <code>navigator.opentrayWindow</code> / <code>navigator.window</code> is unavailable.
        Ensure the page is loaded from a <code>Local</code> origin (loopback) and
        <code>nativeWindowApi</code> is enabled on the window.
      </p>
    {:else}
      <div class="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
        <WindowPanel {bridge} />
        <OverlayPanel {bridge} />
        <MetadataPanel {bridge} />
        <NavigationPanel />
        <ScreenPanel {screenApi} />
        <EventLog />
      </div>
    {/if}
  </main>
</div>
