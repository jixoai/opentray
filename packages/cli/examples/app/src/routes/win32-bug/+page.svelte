<script lang="ts">
  // Orthogonal intents (2026-07-16; original user request: compare the failed clearWhiteBlock
  // path against a tiny native resize in the real Windows OpenTray host):
  // 1. Reuse the complete Window control card without creating another style authority.
  // 2. Keep page observations separate from native composition diagnostics.
  import { onMount } from "svelte";
  import { Badge } from "$lib/components/ui/badge";
  import EventLog from "$lib/components/webview-control/event-log.svelte";
  import WindowPanel from "$lib/components/webview-control/window-panel.svelte";
  import ResidueProbe from "$lib/components/win32-bug/residue-probe.svelte";
  import {
    formatError,
    resolveWindowBridge,
    store,
  } from "$lib/components/webview-control/store.svelte";

  let bridge = $state(resolveWindowBridge());

  onMount(() => {
    if (!bridge) return;
    const unlistens: Array<() => void> = [];
    const subscribe = (event: string, handler: (payload: unknown) => void): void => {
      const stop = bridge!.listen(event, (raw) => handler(raw.payload));
      unlistens.push(() => void Promise.resolve(stop).then((fn) => fn?.()));
    };

    subscribe("stylechange", (payload) => {
      store.setStyle(payload as Record<string, unknown>);
      store.appendEvent("stylechange", payload);
    });
    subscribe("windowstatechange", (payload) => {
      store.setWindowState(payload as Record<string, unknown>);
      store.appendEvent("windowstatechange", payload);
    });
    subscribe("resized", (payload) => store.appendEvent("resized", payload));
    subscribe("closed", (payload) => store.appendEvent("closed", payload));

    void refreshNativeSnapshot();
    return () => unlistens.forEach((unlisten) => unlisten());
  });

  async function refreshNativeSnapshot(): Promise<void> {
    if (!bridge) return;
    try {
      const [capabilities, style, state] = await Promise.all([
        bridge.getCapabilities(),
        bridge.getStyle(),
        bridge.getWindowState(),
      ]);
      store.setCapabilities(capabilities);
      store.setStyle(style);
      store.setWindowState({ ...state });
      store.appendEvent("win32-bug:ready", { capabilities, style, state });
    } catch (error) {
      store.appendEvent("win32-bug:ready:error", { error: formatError(error) });
    }
  }
</script>

<div class="flex min-h-screen flex-col bg-transparent p-4 text-foreground">
  <header class="mb-4 flex flex-wrap items-center gap-3">
    <div>
      <h1 class="text-lg font-semibold">Windows Composition Diagnostic</h1>
      <p class="text-xs text-muted-foreground">OpenTray HWND, WebView2, and DWM residue probe.</p>
    </div>
    <div class="ml-auto flex items-center gap-2">
      <Badge variant={bridge ? "success" : "destructive"}>
        bridge {bridge ? "ready" : "unavailable"}
      </Badge>
      <Badge variant={store.platform === "windows" ? "success" : "warning"}>
        {store.platform}
      </Badge>
    </div>
  </header>

  {#if !bridge}
    <p class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
      Windows native window bridge is unavailable.
    </p>
  {:else}
    <main class="grid flex-1 gap-4 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
      <WindowPanel {bridge} />
      <ResidueProbe {bridge} />
      <EventLog />
    </main>
  {/if}
</div>
