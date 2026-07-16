<script lang="ts">
  // Orthogonal intents (2026-07-16; original user request: reproduce the native probe with WebView
  // controls while leaving every non-control page pixel transparent):
  // 1. Render the native probe's centered 3x3+1 control geometry.
  // 2. Route material/paint actions to the environment-gated native probe state.
  // 3. Route frameless and close actions through the typed window bridge.
  // 4. Preserve the native probe keyboard command surface.
  import { onMount } from "svelte";
  import { resolveWindowBridge } from "$lib/components/webview-control/store.svelte";
  import type { NavigatorWindow } from "$lib/types";

  type ProbeAction =
    | "paint-none"
    | "paint-black"
    | "paint-gray"
    | "acrylic"
    | "mica"
    | "backdrop-none"
    | "frameless"
    | "reproject"
    | "invalidate"
    | "exit";

  type ProbeControl = {
    action: ProbeAction;
    label: string;
    shortcut: string;
    column: number;
    row: number;
  };

  const controls: readonly ProbeControl[] = [
    { action: "paint-none", label: "No host paint [1]", shortcut: "1", column: 1, row: 1 },
    { action: "paint-black", label: "Black host paint [2]", shortcut: "2", column: 2, row: 1 },
    { action: "paint-gray", label: "Gray host paint [3]", shortcut: "3", column: 3, row: 1 },
    { action: "acrylic", label: "Acrylic [A]", shortcut: "a", column: 1, row: 2 },
    { action: "mica", label: "Mica [M]", shortcut: "m", column: 2, row: 2 },
    { action: "backdrop-none", label: "No backdrop [N]", shortcut: "n", column: 3, row: 2 },
    { action: "frameless", label: "Toggle frameless [F]", shortcut: "f", column: 1, row: 3 },
    { action: "reproject", label: "Reset native backdrop [R]", shortcut: "r", column: 2, row: 3 },
    { action: "invalidate", label: "Invalidate + UpdateWindow [P]", shortcut: "p", column: 3, row: 3 },
    { action: "exit", label: "Exit [Esc]", shortcut: "escape", column: 2, row: 4 },
  ];

  const shortcutActions = new Map(controls.map((control) => [control.shortcut, control.action]));
  let bridge = $state<NavigatorWindow | null>(resolveWindowBridge() ?? null);
  let activeAction = $state<ProbeAction | null>(null);

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const action = shortcutActions.get(event.key.toLowerCase());
      if (!action || event.repeat) return;
      event.preventDefault();
      void runProbeAction(action);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  async function runProbeAction(action: ProbeAction): Promise<void> {
    if (!bridge || activeAction) return;
    activeAction = action;
    try {
      if (action === "frameless") {
        const style = await bridge.getStyle();
        await bridge.setStyle({ frameless: style.frameless !== true });
        return;
      }
      if (action === "exit") {
        await bridge.close();
        return;
      }
      execNativeProbeCommand(
        {
          "paint-none": "win32ProbeNoHostPaint",
          "paint-black": "win32ProbeBlackHostPaint",
          "paint-gray": "win32ProbeGrayHostPaint",
          acrylic: "win32ProbeAcrylic",
          mica: "win32ProbeMica",
          "backdrop-none": "win32ProbeNoBackdrop",
          reproject: "win32ProbeReproject",
          invalidate: "win32ProbeInvalidate",
        }[action],
      );
    } catch (error) {
      console.error(`native material probe action failed: ${action}`, error);
    } finally {
      activeAction = null;
    }
  }

  function execNativeProbeCommand(command: string): void {
    const nav = navigator as Navigator & {
      opentray?: { execCommand(command: string): void };
    };
    nav.opentray?.execCommand(command);
  }
</script>

<main class="probe-root" data-native-material-probe>
  {#if bridge}
    <div class="probe-grid" role="group" aria-label="Native material host paint probe">
      {#each controls as control (control.action)}
        <button
          type="button"
          data-probe-action={control.action}
          disabled={activeAction !== null}
          style:grid-column={control.column}
          style:grid-row={control.row}
          onclick={() => runProbeAction(control.action)}
        >
          {control.label}
        </button>
      {/each}
    </div>
  {:else}
    <button type="button" class="bridge-error" disabled>Native window bridge unavailable</button>
  {/if}
</main>

<style>
  :global(html),
  :global(body),
  :global(body > div) {
    background: transparent !important;
  }

  .probe-root {
    display: grid;
    min-height: 100dvh;
    place-items: center;
    overflow: hidden;
    background: transparent;
    color-scheme: light dark;
  }

  .probe-grid {
    display: grid;
    grid-template-columns: repeat(3, 180px);
    grid-template-rows: repeat(4, 34px);
    gap: 10px;
    width: 560px;
    height: 166px;
  }

  button {
    box-sizing: border-box;
    width: 180px;
    height: 34px;
    padding: 0 4px;
    border: 1px solid color-mix(in srgb, ButtonText 36%, ButtonFace);
    border-radius: 2px;
    background: ButtonFace;
    color: ButtonText;
    overflow: hidden;
    font: 12px "Segoe UI", system-ui, sans-serif;
    letter-spacing: 0;
    white-space: nowrap;
    cursor: default;
  }

  button:hover:not(:disabled) {
    border-color: Highlight;
  }

  button:active:not(:disabled) {
    background: color-mix(in srgb, ButtonFace 82%, ButtonText);
  }

  button:focus-visible {
    outline: 2px solid Highlight;
    outline-offset: 1px;
  }

  button:disabled {
    color: GrayText;
  }

  .bridge-error {
    width: 240px;
  }

</style>
