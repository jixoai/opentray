// Orthogonal intents (2026-07-16; original user request: make win32-bug match the native
// material probe except that its centered controls are rendered by a fully transparent WebView):
// 1. Launch the matching source-tree Windows host through its retained tray lifecycle.
// 2. Enable the native-only material/paint probe state for this example process.
// 3. Keep the initial HWND geometry and material aligned with the native probe.
// 4. Prove the retained Show/Hide Example and Quit Demo tray contract.

import type { WebviewWindowOptions } from "../../ext-webview/src/index";
import { createExampleLifecycle, sleep } from "./_support/example-lifecycle";
import { ensureAppInstalled, startDevServer } from "./_support/dev-server";
import {
  createExamplePrimaryMenu,
  createWebviewExampleRuntime,
  EXAMPLE_PRIMARY_ITEM_ID,
  mountExampleWebview,
  requireWindowsExample,
  shutdownWebviewExample,
  syncExamplePrimaryMenu,
} from "./_support/webview-example-support";

requireWindowsExample("example:win32-bug");

process.env.OPENTRAY_WINDOWS_NATIVE_MATERIAL_COMPARATOR = "1";
process.env.OPENTRAY_WINDOWS_NATIVE_MATERIAL_PROBE = "1";
process.env.OPENTRAY_DAEMON_STDIO ??= "inherit";
ensureAppInstalled();

const runtime = await createWebviewExampleRuntime({
  importMetaUrl: import.meta.url,
  requestIdPrefix: "win32-bug",
  homePrefix: "opentray-win32-bug",
  tray: {
    id: "com.example.opentray.win32-bug",
    tooltip: {
      title: "OpenTray Native Material Probe",
      description: "Transparent WebView controls over the native material host",
    },
    menu: createExamplePrimaryMenu({
      visible: false,
      trailingItems: [{ type: "separator" }, { type: "item", id: 99, title: "Quit Demo" }],
    }),
  },
});
const { tray } = runtime;
const devServer = await startDevServer("/win32-bug");
console.log("win32-bug panel: " + devServer.url);
console.log("Windows native material probe: transparent WebView controls enabled");

let stopVisibleChange: (() => void) | undefined;
let primaryMenuVisibility: boolean | undefined;
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
  width: 900,
  height: 620,
  title: "OpenTray Native Material Probe",
  style: {
    frameless: false,
    resizable: true,
    keepOnTop: false,
    background: {
      kind: "platformMaterial",
      material: "acrylic",
      state: "active",
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

if (process.env.OPENTRAY_EXAMPLE_WIN32_BUG_SMOKE === "1") {
  await webview.evaluate(String.raw`
    (async () => {
      const bridge = navigator.opentrayWindow ?? navigator.window;
      if (!bridge) {
        throw new Error("navigator.window bridge is unavailable");
      }
      const root = document.querySelector("[data-native-material-probe]");
      const buttons = document.querySelectorAll("[data-probe-action]");
      if (!(root instanceof HTMLElement) || buttons.length !== 10) {
        throw new Error("native material probe controls did not render");
      }
      const htmlBackground = getComputedStyle(document.documentElement).backgroundColor;
      const bodyBackground = getComputedStyle(document.body).backgroundColor;
      const rootBackground = getComputedStyle(root).backgroundColor;
      if (![htmlBackground, bodyBackground, rootBackground].every((value) => value === "rgba(0, 0, 0, 0)")) {
        throw new Error("probe page substrate is not fully transparent");
      }
      const framelessButton = document.querySelector('[data-probe-action="frameless"]');
      if (!(framelessButton instanceof HTMLButtonElement)) {
        throw new Error("frameless probe control is unavailable");
      }
      framelessButton.click();
      await new Promise((resolve) => window.setTimeout(resolve, 80));
      if ((await bridge.getStyle()).frameless !== true) {
        throw new Error("frameless probe control did not reach the native bridge");
      }
      framelessButton.click();
      await new Promise((resolve) => window.setTimeout(resolve, 80));
      if ((await bridge.getStyle()).frameless === true) {
        throw new Error("framed probe state was not restored");
      }
    })();
  `);
  await toggleExampleVisibility();
  await waitForPrimaryMenuVisibility(false, 2_000);
  if (await webview.isVisible()) {
    throw new Error("hidden win32-bug window must project Show Example");
  }
  await toggleExampleVisibility();
  await waitForPrimaryMenuVisibility(true, 2_000);
  if (!(await webview.isVisible())) {
    throw new Error("revealed win32-bug window must project Hide Example");
  }
  await webview.evaluate(String.raw`
    (() => {
      const root = document.querySelector("[data-native-material-probe]");
      if (!(root instanceof HTMLElement)) {
        throw new Error("retained probe page was rebuilt or lost");
      }
    })();
  `);
  console.log(
    "win32-bug smoke: transparent controls, frameless round-trip, and Show/Hide tray lifecycle verified",
  );
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
  primaryMenuVisibility = visible;
}

async function waitForPrimaryMenuVisibility(
  expected: boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (primaryMenuVisibility === expected) {
      return;
    }
    await sleep(25);
  }
  throw new Error(
    `win32-bug primary menu did not change to ${expected ? "Hide" : "Show"} Example`,
  );
}
