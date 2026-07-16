// Orthogonal intents (2026-07-16; original user request: reproduce Windows WebView residue
// where clearWhiteBlock fails but a tiny resize succeeds):
// 1. Launch the real source-tree Windows WebView host through its normal tray lifecycle.
// 2. Load a focused page that reuses the Window control surface and adds residue probes.
// 3. Enable opt-in native composition evidence without claiming a repair.

import type { WebviewWindowOptions } from "../../ext-webview/src/index";
import { createExampleLifecycle } from "./_support/example-lifecycle";
import { ensureAppInstalled, startDevServer } from "./_support/dev-server";
import {
  createExamplePrimaryMenu,
  createVisibleTrayIcon,
  createWebviewExampleRuntime,
  EXAMPLE_PRIMARY_ITEM_ID,
  mountExampleWebview,
  requireWindowsExample,
  shutdownWebviewExample,
  syncExamplePrimaryMenu,
} from "./_support/webview-example-support";

requireWindowsExample("example:win32-bug");

process.env.OPENTRAY_WINDOWS_COMPOSITION_DIAGNOSTICS ??= "1";
// The pulse must exercise geometry alone. Manual clear remains the explicit shell-state control.
process.env.OPENTRAY_WINDOWS_AUTO_CLEAR_WHITE_BLOCK = "0";
process.env.OPENTRAY_DAEMON_STDIO ??= 'inherit';
ensureAppInstalled();

const runtime = await createWebviewExampleRuntime({
  importMetaUrl: import.meta.url,
  requestIdPrefix: "win32-bug",
  homePrefix: "opentray-win32-bug",
  tray: {
    id: "com.example.opentray.win32-bug",
    tooltip: {
      title: "OpenTray Windows Composition",
      description: "WebView2 residue reproduction harness",
    },
    menu: createExamplePrimaryMenu({
      visible: false,
      trailingItems: [{ type: "separator" }, { type: "item", id: 99, title: "Quit Demo" }],
    }),
  },
});
const { tray } = runtime;
const devServer = await startDevServer("/win32-bug");
console.log(`win32-bug panel: ${devServer.url}`);
console.log("Windows composition diagnostics: enabled; automatic recovery: disabled");

let stopVisibleChange: (() => void) | undefined;
const lifecycle = createExampleLifecycle({
  exitAfterMs: process.env.OPENTRAY_EXAMPLE_EXIT_AFTER_MS,
  onShutdown: async () => {
    stopVisibleChange?.();
    try {
      await webview.destroy();
    } catch {
      // Session shutdown remains authoritative if the window is already gone.
    }
    await shutdownWebviewExample(runtime, devServer);
  },
});

const webview = mountExampleWebview(runtime, "win32-bug-webview").createWebviewWindow({
  url: devServer.url,
  width: 960,
  height: 720,
  title: "OpenTray Windows Composition Diagnostic",
  icon: createVisibleTrayIcon(),
  style: {
    frameless: false,
    resizable: true,
    keepOnTop: false,
    background: {
      kind: "platformMaterial",
      material: "mica",
      state: "active",
    },
    platform: {
      windows: {
        cornerPreference: "round",
      },
    },
  },
  fallbackRect: { x: 0, y: 0, width: 1, height: 1 },
  nativeWindowApi: true,
  bindWindowGlobals: true,
  nativeApiPolicy: {
    defaultSrc: ["'local'"],
  },
} satisfies WebviewWindowOptions);

await webview.show();
stopVisibleChange = webview.listen("visibleChange", ({ payload }) => {
  void syncPrimaryMenu(payload.visible).catch((error: unknown) => {
    console.error("failed to synchronize win32-bug primary menu:", error);
  });
});
await syncPrimaryMenu(true);

if (process.env.OPENTRAY_EXAMPLE_WIN32_BUG_SMOKE === '1') {
  const bounds = await webview.getBounds();
  await webview.resizeTo(bounds.width + 1, bounds.height);
  await new Promise<void>((resolve) => setTimeout(resolve, 48));
  await webview.resizeTo(bounds.width, bounds.height);
  await webview.evaluate('navigator.opentray?.execCommand(\'clearWhiteBlock\')');
  await new Promise<void>((resolve) => setTimeout(resolve, 100));
  console.log('win32-bug smoke: one-pixel pulse and manual clear dispatched');
}

tray.onMenuClick(({ itemId }) => {
  if (itemId === EXAMPLE_PRIMARY_ITEM_ID) {
    void toggleExampleVisibility();
    return;
  }
  if (itemId === 99) {
    void lifecycle.shutdown();
  }
});

await lifecycle.wait;

async function toggleExampleVisibility(): Promise<void> {
  if (await webview.isVisible()) {
    await webview.close();
    return;
  }
  await webview.toVisible();
}

async function syncPrimaryMenu(visible: boolean): Promise<void> {
  await syncExamplePrimaryMenu(tray, {
    visible,
    trailingItems: [{ type: "separator" }, { type: "item", id: 99, title: "Quit Demo" }],
  });
}
