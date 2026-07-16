<script lang="ts">
  // Orthogonal intents (2026-07-16; original user request: make frameless diagnostics operable):
  // 1. Keep the page titlebar transparent over the native Windows material.
  // 2. Delegate drag and window commands to the existing typed native bridge.
  // 3. Let the diagnostic operator show or hide self-drawn controls.
  import { Copy, Minus, Square, X } from "@lucide/svelte";
  import type { NavigatorWindow } from "$lib/types";
  import { store } from "$lib/components/webview-control/store.svelte";

  type Props = {
    bridge: NavigatorWindow;
    controlsVisible: boolean;
  };

  let { bridge, controlsVisible }: Props = $props();
  const maximized = $derived(store.windowState?.maximized === true);

  function startDrag(event: PointerEvent): void {
    const target = event.target;
    if (target instanceof Element && target.closest("button, input, select, textarea")) {
      return;
    }
    void bridge.startAppRegionDrag({
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    });
  }

  async function minimize(): Promise<void> {
    await bridge.minimize();
  }

  async function toggleMaximized(): Promise<void> {
    if (maximized) {
      await bridge.restore();
      return;
    }
    await bridge.maximize();
  }

  async function close(): Promise<void> {
    await bridge.close();
  }
</script>

<div
  class="grid h-10 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-stretch border-b border-border/25 bg-transparent text-foreground select-none"
  role="group"
  aria-label="Frameless titlebar"
  data-opentray-frameless-titlebar
  onpointerdown={startDrag}
>
  <div class="flex min-w-0 items-center gap-2 px-3">
    <span class="min-w-0 truncate text-xs font-semibold">Windows Composition Diagnostic</span>
    <code class="truncate text-[10px] text-muted-foreground">frameless</code>
  </div>

  {#if controlsVisible}
    <div class="flex items-stretch" aria-label="Window controls" data-opentray-window-controls>
      <button
        type="button"
        class="grid h-10 w-11 place-items-center text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onclick={minimize}
        title="Minimize"
        aria-label="Minimize"
      >
        <Minus size={15} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        class="grid h-10 w-11 place-items-center text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onclick={toggleMaximized}
        title={maximized ? "Restore" : "Maximize"}
        aria-label={maximized ? "Restore" : "Maximize"}
      >
        {#if maximized}
          <Copy size={14} strokeWidth={1.8} />
        {:else}
          <Square size={14} strokeWidth={1.8} />
        {/if}
      </button>
      <button
        type="button"
        class="grid h-10 w-11 place-items-center text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
        onclick={close}
        title="Close"
        aria-label="Close"
      >
        <X size={16} strokeWidth={1.8} />
      </button>
    </div>
  {/if}
</div>
