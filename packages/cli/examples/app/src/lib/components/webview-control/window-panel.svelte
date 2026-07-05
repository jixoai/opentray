<script lang="ts">
  import { Card, CardContent, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { NativeSelect } from "$lib/components/ui/select";
  import {
    store,
    execCommand,
    formatError,
    backgroundOptionsForPlatform,
    backgroundStateOptions,
    isWindowsStyle,
    normalizeOpacityInput,
    formatOpacity,
  } from "./store.svelte";
  import type { NavigatorWindow } from "$lib/types";

  type Props = { bridge: NavigatorWindow };
  let { bridge }: Props = $props();

  let opacityInput = $state(1);
  let backgroundValue = $state("opaque");
  let backgroundStateValue = $state("followsWindowActiveState");
  let cornerRadiusInput = $state(0);
  let windowsCornerValue = $state("default");

  // Sync selects when style/capabilities change.
  const bgOptions = $derived(backgroundOptionsForPlatform(store.platform));
  const bgStateOptions = $derived(backgroundStateOptions(store.style));

  async function refreshCapabilities(): Promise<void> {
    try {
      const caps = (await bridge.getCapabilities()) as Record<string, unknown>;
      store.setCapabilities(caps);
      store.appendEvent("capabilities", caps);
    } catch (error) {
      store.appendEvent("capabilities:error", { error: formatError(error) });
    }
  }
  async function refreshStyle(): Promise<void> {
    try {
      const style = (await bridge.getStyle()) as Record<string, unknown>;
      store.setStyle(style);
      store.appendEvent("style", style);
      syncControlsFromStyle(style);
    } catch (error) {
      store.appendEvent("style:error", { error: formatError(error) });
    }
  }
  async function refreshWindowState(): Promise<void> {
    try {
      const [state, isMax, isMin] = await Promise.all([
        bridge.getWindowState(),
        bridge.isMaximized(),
        bridge.isMinimized(),
      ]);
      const merged = { ...(state as object), maximized: isMax, minimized: isMin };
      store.setWindowState(merged as never);
      store.appendEvent("windowstate", merged);
    } catch (error) {
      store.appendEvent("windowstate:error", { error: formatError(error) });
    }
  }
  function syncControlsFromStyle(style: Record<string, unknown>): void {
    const opacity = typeof style.opacity === "number" ? style.opacity : 1;
    opacityInput = opacity;
    const bg = style.background as Record<string, unknown> | undefined;
    if (bg?.kind === "opaque") backgroundValue = "opaque";
    else if (bg?.kind === "transparent") backgroundValue = "transparent";
    else if (bg?.kind === "platformMaterial")
      backgroundValue = String(bg.material ?? "");
    else if (bg?.kind === "semantic") backgroundValue = "blur";
    if (bg && "state" in bg && typeof bg.state === "string") {
      backgroundStateValue = bg.state;
    }
    const platform = style.platform as Record<string, unknown> | undefined;
    const macos = platform?.macos as Record<string, unknown> | undefined;
    if (typeof macos?.cornerRadius === "number") cornerRadiusInput = macos.cornerRadius;
    const windows = platform?.windows as Record<string, unknown> | undefined;
    if (typeof windows?.cornerPreference === "string") windowsCornerValue = windows.cornerPreference;
  }

  async function toggleFrameless(): Promise<void> {
    const style = (await bridge.getStyle()) as Record<string, unknown>;
    await bridge.setStyle({ frameless: !style.frameless });
    await refreshStyle();
  }
  async function toggleTopmost(): Promise<void> {
    const style = (await bridge.getStyle()) as Record<string, unknown>;
    await bridge.setStyle({ keepOnTop: !style.keepOnTop });
    await refreshStyle();
  }
  async function applyOpacity(): Promise<void> {
    await bridge.setStyle({ opacity: normalizeOpacityInput(String(opacityInput)) });
    await refreshStyle();
  }
  function backgroundPayload(
    value: string,
    state: string,
  ): Record<string, unknown> {
    if (value === "opaque") return { kind: "opaque" };
    if (value === "transparent") return { kind: "transparent" };
    if (value === "blur") return { kind: "semantic", token: "blur", state };
    return { kind: "platformMaterial", material: value, state };
  }
  async function applyBackground(): Promise<void> {
    await bridge.setBackground(
      backgroundPayload(backgroundValue, backgroundStateValue) as never,
    );
    await refreshStyle();
  }
  async function applyCorner(): Promise<void> {
    if (store.platform === "windows") {
      await bridge.setStyle({
        platform: { windows: { cornerPreference: windowsCornerValue } },
      });
    } else {
      await bridge.setStyle({
        platform: { macos: { cornerRadius: cornerRadiusInput } },
      });
    }
    await refreshStyle();
  }
  async function clearCorner(): Promise<void> {
    if (store.platform === "windows") {
      await bridge.setStyle({ platform: { windows: { cornerPreference: null } } });
    } else {
      await bridge.setStyle({ platform: { macos: { cornerRadius: null } } });
    }
    await refreshStyle();
  }
  async function resize(): Promise<void> {
    await bridge.resizeTo(680, 520);
    await refreshWindowState();
  }
  async function move(): Promise<void> {
    await bridge.moveTo(120, 120);
    await refreshWindowState();
  }
  async function minimize(): Promise<void> {
    await bridge.minimize();
    await refreshWindowState();
  }
  async function maximize(): Promise<void> {
    await bridge.maximize();
    await refreshWindowState();
  }
  async function restore(): Promise<void> {
    await bridge.restore();
    await refreshWindowState();
  }
  async function nativeClose(): Promise<void> {
    await bridge.close();
  }
</script>

<Card>
  <CardHeader>
    <div class="flex items-center justify-between gap-2">
      <CardTitle>Window</CardTitle>
      <Badge variant="muted">{store.platform}</Badge>
    </div>
  </CardHeader>
  <CardContent class="flex flex-col gap-4">
    <div class="flex flex-wrap gap-2">
      <Button size="sm" onclick={refreshCapabilities}>Capabilities</Button>
      <Button size="sm" variant="outline" onclick={refreshStyle}>Refresh style</Button>
      <Button size="sm" variant="outline" onclick={toggleFrameless}>Toggle frameless</Button>
      <Button size="sm" variant="outline" onclick={toggleTopmost}>Toggle topmost</Button>
    </div>

    <div class="grid gap-2">
      <Label>Opacity</Label>
      <div class="flex items-center gap-2">
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={opacityInput}
          oninput={(e) => (opacityInput = Number((e.target as HTMLInputElement).value))}
          class="h-2 flex-1 accent-primary"
        />
        <code class="w-12 text-right text-xs text-muted-foreground">{formatOpacity(opacityInput)}</code>
        <Button size="sm" onclick={applyOpacity}>Apply</Button>
        <Button size="sm" variant="ghost" onclick={async () => { opacityInput = 1; await applyOpacity(); }}>100%</Button>
      </div>
    </div>

    <div class="grid gap-2">
      <Label>Background</Label>
      <div class="flex items-center gap-2">
        <NativeSelect value={backgroundValue} onchange={(e) => (backgroundValue = (e.target as HTMLSelectElement).value)} class="min-w-0 flex-1">
          <option value="opaque">opaque</option>
          <option value="transparent">transparent</option>
          <option value="blur">semantic: blur</option>
          {#each bgOptions as mat}
            <option value={mat}>{mat}</option>
          {/each}
        </NativeSelect>
        <NativeSelect value={backgroundStateValue} onchange={(e) => (backgroundStateValue = (e.target as HTMLSelectElement).value)} class="min-w-0 flex-1">
          {#each bgStateOptions as st}
            <option value={st}>{st}</option>
          {/each}
        </NativeSelect>
        <Button size="sm" onclick={applyBackground}>Apply</Button>
        <Button size="sm" variant="ghost" onclick={async () => { await bridge.setBackground("opaque" as never); await refreshStyle(); }}>Opaque</Button>
      </div>
    </div>

    {#if store.platform === "macos"}
      <div class="grid gap-2">
        <Label>macOS corner radius</Label>
        <div class="flex items-center gap-2">
          <input
            type="range"
            min="0"
            max="48"
            step="1"
            value={cornerRadiusInput}
            oninput={(e) => (cornerRadiusInput = Number((e.target as HTMLInputElement).value))}
            class="h-2 flex-1 accent-primary"
          />
          <code class="w-12 text-right text-xs text-muted-foreground">{cornerRadiusInput}px</code>
          <Button size="sm" onclick={applyCorner}>Apply</Button>
          <Button size="sm" variant="ghost" onclick={clearCorner}>System</Button>
        </div>
      </div>
    {:else if store.platform === "windows"}
      <div class="grid gap-2">
        <Label>Windows corner preference</Label>
        <div class="flex items-center gap-2">
          <NativeSelect value={windowsCornerValue} onchange={(e) => (windowsCornerValue = (e.target as HTMLSelectElement).value)} class="min-w-0 flex-1">
            {#each ["default", "doNotRound", "round", "roundSmall"] as c}
              <option value={c}>{c}</option>
            {/each}
          </NativeSelect>
          <Button size="sm" onclick={applyCorner}>Apply</Button>
          <Button size="sm" variant="ghost" onclick={clearCorner}>System</Button>
        </div>
      </div>
    {/if}

    <div class="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" onclick={minimize}>Minimize</Button>
      <Button size="sm" variant="secondary" onclick={maximize}>Maximize</Button>
      <Button size="sm" variant="secondary" onclick={restore}>Restore</Button>
      <Button size="sm" variant="outline" onclick={resize}>Resize 680×520</Button>
      <Button size="sm" variant="outline" onclick={move}>Move 120,120</Button>
      <Button size="sm" variant="outline" onclick={() => execCommand("clearWhiteBlock")}>clearWhiteBlock</Button>
      <Button size="sm" variant="destructive" onclick={nativeClose}>Close</Button>
    </div>

    {#if store.capabilities}
      <pre class="overflow-auto rounded-md bg-muted/40 p-2 text-[11px] whitespace-pre-wrap break-all">{JSON.stringify(store.capabilities, null, 2)}</pre>
    {/if}
    {#if store.windowState}
      <pre class="overflow-auto rounded-md bg-muted/40 p-2 text-[11px] whitespace-pre-wrap break-all">{JSON.stringify(store.windowState, null, 2)}</pre>
    {/if}
    {#if store.style}
      <pre class="overflow-auto rounded-md bg-muted/40 p-2 text-[11px] whitespace-pre-wrap break-all">{JSON.stringify(store.style, null, 2)}</pre>
    {/if}
  </CardContent>
</Card>
