<script lang="ts">
  import type { NavigatorWindow } from "$lib/types";
  import { store } from "./store.svelte";

  type Props = {
    bridge: NavigatorWindow;
    /** True when windowControlsOverlay is on — the titlebar pads around native controls. */
    overlayActive?: boolean;
    /** True when the page must draw its own window controls (frameless window). */
    showWindowControls?: boolean;
  };
  let { bridge, overlayActive = false, showWindowControls = false }: Props =
    $props();

  // Inset style driven by overlay geometry. left avoids the macOS traffic
  // lights; right avoids the Windows caption buttons. Both come from
  // getTitlebarAreaRect() + overlay.geometrychange, fetched automatically by
  // the page (not gated on a button click).
  const style = $derived(
    `padding-left: ${store.overlayInsets.left}px; padding-right: ${store.overlayInsets.right}px; min-height: ${store.overlayInsets.height}px;`,
  );

  function startDrag(e: PointerEvent): void {
    // Don't start a native drag when the user clicks an actual control.
    const target = e.target as HTMLElement;
    if (target.closest("button, input, select, textarea")) return;
    void bridge.startAppRegionDrag({ x: e.clientX, y: e.clientY, pointerId: e.pointerId });
  }
  async function minimize(): Promise<void> {
    await bridge.minimize();
  }
  async function maximize(): Promise<void> {
    await bridge.maximize();
  }
  async function restore(): Promise<void> {
    await bridge.restore();
  }
  async function close(): Promise<void> {
    await bridge.close();
  }
</script>

<div
  class="sticky top-0 z-20 grid grid-cols-[minmax(0,1fr)_auto] items-center border-b border-border bg-[var(--titlebar-bg)] backdrop-blur-md select-none"
  style={style}
  role="button"
  tabindex="0"
  onpointerdown={startDrag}
>
  <div class="flex h-full min-w-0 items-center gap-3 px-3 py-2">
    <span class="min-w-0 truncate text-xs font-semibold">{store.title}</span>
    {#if store.overlayStatusText}
      <code class="truncate text-[10px] text-muted-foreground">{store.overlayStatusText}</code>
    {/if}
  </div>
  {#if showWindowControls}
    <!-- Native window controls are gone (frameless window), so the page owns
         close/min/max/restore. On a framed window the native controls remain
         visible (even with overlay), so we don't draw our own. -->
    <div class="flex items-center gap-1 px-2" aria-label="Window controls">
      <button
        type="button"
        class="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-accent"
        onclick={minimize}
        title="Minimize"
        aria-label="Minimize"
      >
        <svg width="12" height="12" viewBox="0 0 12 12"><rect y="5.5" width="12" height="1.2" fill="currentColor" /></svg>
      </button>
      <button
        type="button"
        class="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-accent"
        onclick={maximize}
        title="Maximize"
        aria-label="Maximize"
      >
        <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.2" /></svg>
      </button>
      <button
        type="button"
        class="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-accent"
        onclick={restore}
        title="Restore"
        aria-label="Restore"
      >
        <svg width="12" height="12" viewBox="0 0 12 12"><rect x="3" y="1" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.2" /><rect x="1" y="3" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.2" /></svg>
      </button>
      <button
        type="button"
        class="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
        onclick={close}
        title="Close"
        aria-label="Close"
      >
        <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" stroke-width="1.4" /></svg>
      </button>
    </div>
  {/if}
</div>
