<script lang="ts">
  import { onMount } from "svelte";
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { resolveBridge, resolveNamespace } from "$lib/bridge";

  let navigatorStatus = $state<unknown>("Waiting for navigator.window bootstrap");
  let globalsStatus = $state<string>("Waiting for global override bootstrap");
  let eventStatus = $state<unknown>("Waiting for navigator.window events");
  let trayStatus = $state<unknown>("Waiting for navigator.opentray.tray");
  let hasBridge = $state(false);
  let bridge: ReturnType<typeof resolveBridge> = undefined;

  onMount(() => {
    bridge = resolveBridge();
    hasBridge = bridge !== undefined;
    if (!bridge) {
      navigatorStatus = "navigator.window is disabled";
      globalsStatus = "window.close / window.resizeTo are using browser defaults";
      return;
    }
    navigatorStatus = "navigator.window is ready";
    globalsStatus = "window.close / window.resizeTo are delegated to the extension for this demo";
    void bridge.getCapabilities().then((caps) => {
      navigatorStatus = caps;
    });
    const onEvent = (payload: unknown): void => {
      eventStatus = payload;
    };
    const stop1 = bridge.listen("moved", onEvent);
    const stop2 = bridge.listen("resized", onEvent);
    const stop3 = bridge.listen("stylechange", onEvent);
    const stop4 = bridge.listen("closed", onEvent);
    return () => {
      void Promise.resolve(stop1).then((fn) => fn?.());
      void Promise.resolve(stop2).then((fn) => fn?.());
      void Promise.resolve(stop3).then((fn) => fn?.());
      void Promise.resolve(stop4).then((fn) => fn?.());
    };
  });

  async function refreshCapabilities(): Promise<void> {
    if (!bridge) return;
    navigatorStatus = await bridge.getCapabilities();
  }
  async function toggleFrameless(): Promise<void> {
    if (!bridge?.getStyle || !bridge.setStyle) return;
    const style = (await bridge.getStyle()) as { frameless?: boolean };
    await bridge.setStyle({ frameless: !style.frameless });
    navigatorStatus = await bridge.getStyle();
  }
  async function toggleOpacity(): Promise<void> {
    if (!bridge?.getStyle || !bridge.setStyle) return;
    const style = (await bridge.getStyle()) as { opacity?: number };
    await bridge.setStyle({ opacity: (style.opacity ?? 1) < 1 ? 1 : 0.72 });
    navigatorStatus = await bridge.getStyle();
  }
  function navigatorResize(): void {
    void bridge?.resizeTo(520, 320);
  }
  function navigatorMove(): void {
    void bridge?.moveTo(140, 120);
  }
  function globalResize(): void {
    if (typeof window !== "undefined" && typeof window.resizeTo === "function") {
      window.resizeTo(560, 360);
    }
  }
  function globalClose(): void {
    if (typeof window !== "undefined" && typeof window.close === "function") {
      window.close();
    }
  }
  function stringify(value: unknown): string {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  // Resolve tray bounds on mount.
  $effect(() => {
    const trayApi = resolveNamespace()?.tray as { getBounds?(): Promise<unknown> } | undefined;
    if (!trayApi) {
      trayStatus = "navigator.opentray.tray is disabled";
      return;
    }
    void trayApi.getBounds?.().then((b) => {
      trayStatus = b;
    });
  });
</script>

<main class="min-h-screen bg-gradient-to-br from-amber-50 to-lime-50 p-6 text-foreground">
  <h1 class="mb-2 text-2xl font-semibold tracking-tight">OpenTray WebView</h1>
  <p class="mb-4 text-sm text-muted-foreground">
    This window was opened by the single primary tray action. Use the buttons below to exercise the extension-owned WebView bridge.
  </p>
  <div class="grid gap-3">
    <Card>
      <CardHeader><CardTitle>primary event</CardTitle></CardHeader>
      <CardContent>
        <code class="text-xs">macOS single primary item direct-triggered menuClick → WebView show</code>
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>navigator.window</CardTitle></CardHeader>
      <CardContent class="flex flex-col gap-3">
        <pre class="overflow-auto whitespace-pre-wrap break-all text-xs">{stringify(navigatorStatus)}</pre>
        <div class="flex flex-wrap gap-2">
          <Button size="sm" onclick={refreshCapabilities} disabled={!hasBridge}>Capabilities</Button>
          <Button size="sm" variant="outline" onclick={toggleFrameless} disabled={!hasBridge}>Toggle Frameless</Button>
          <Button size="sm" variant="outline" onclick={toggleOpacity} disabled={!hasBridge}>Opacity</Button>
          <Button size="sm" variant="outline" onclick={navigatorResize} disabled={!hasBridge}>Grow via navigator.window</Button>
          <Button size="sm" variant="outline" onclick={navigatorMove} disabled={!hasBridge}>Move via navigator.window</Button>
        </div>
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>window globals</CardTitle></CardHeader>
      <CardContent class="flex flex-col gap-3">
        <p class="text-xs text-muted-foreground">{globalsStatus}</p>
        <div class="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onclick={globalResize}>Grow via window.resizeTo</Button>
          <Button size="sm" variant="destructive" onclick={globalClose}>Close via window.close</Button>
        </div>
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>events</CardTitle></CardHeader>
      <CardContent>
        <pre class="overflow-auto whitespace-pre-wrap break-all text-xs">{stringify(eventStatus)}</pre>
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>tray bounds</CardTitle></CardHeader>
      <CardContent>
        <pre class="overflow-auto whitespace-pre-wrap break-all text-xs">{stringify(trayStatus)}</pre>
      </CardContent>
    </Card>
  </div>
</main>
