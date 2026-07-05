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

  const origin = $derived(typeof location !== "undefined" ? location.origin : "");
</script>

<div class="flex h-screen flex-col overflow-hidden">
  {#if bridge}
    <Titlebar {bridge} />
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
