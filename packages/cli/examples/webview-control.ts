import type { WebviewWindowOptions } from "../../ext-webview/src/index";
import { createExampleLifecycle } from "./_support/example-lifecycle";
import { ensureAppInstalled, startDevServer } from "./_support/dev-server";
import {
  createVisibleTrayIcon,
  createWebviewExampleRuntime,
  mountExampleWebview,
} from "./_support/webview-example-support";

// windowControlsOverlay is a show-time bridge gate; the page can test it, not enable it later.
const overlayEnabled = resolveOverlayEnabled(
  process.argv.slice(2),
  process.env.OPENTRAY_EXAMPLE_WEBVIEW_OVERLAY,
);
console.log(
  `windowControlsOverlay: ${overlayEnabled ? "enabled" : "disabled"}`,
);

ensureAppInstalled();

const runtime = await createWebviewExampleRuntime({
  importMetaUrl: import.meta.url,
  requestIdPrefix: "webview-control",
  homePrefix: "opentray-webview-control",
  tray: {
    id: "com.example.opentray.webview-control",
    tooltip: {
      title: "OpenTray",
      description:
        "Native WebView control demo launched directly from the page",
    },
    menu: {
      items: [{ type: "item", id: 99, title: "Quit Demo" }],
    },
  },
});
const { tray } = runtime;
const icon = createVisibleTrayIcon();

const devServer = await startDevServer("/webview-control");
console.log(`webview-control panel: ${devServer.url}`);

const lifecycle = createExampleLifecycle({
  exitAfterMs: process.env.OPENTRAY_EXAMPLE_EXIT_AFTER_MS,
  onShutdown: async () => {
    await devServer.close();
    await runtime.shutdown();
  },
});

const webview = mountExampleWebview(
  runtime,
  "webview-control-webview",
).createWebviewWindow({
  url: devServer.url,
  width: 960,
  height: 720,
  title: "OpenTray WebView Control Demo",
  icon,
  style: {
    frameless: false,
    keepOnTop: false,
    background: { kind: "opaque" },
    platform: {
      macos: {
        cornerRadius: null,
      },
      windows: {
        cornerPreference: null,
      },
    },
  },
  windowControlsOverlay: overlayEnabled,
  fallbackRect: { x: 0, y: 0, width: 1, height: 1 },
  nativeWindowApi: true,
  bindWindowGlobals: true,
  nativeScreenApi: true,
  bindScreenGlobals: true,
  titleSync: {
    documentToWindow: true,
    windowToDocument: true,
  },
  iconSync: {
    faviconToWindow: true,
    windowToFavicon: true,
  },
  nativeApiPolicy: {
    defaultSrc: ["'local'"],
  },
} satisfies WebviewWindowOptions);
await webview.show();

console.log(
  "Use the page controls to test overlay titlebar geometry, app-region drag, background modes, rounded corners, title, icon, screen, and navigation behavior.",
);

if (process.env.OPENTRAY_EXAMPLE_WEBVIEW_BRIDGE_SMOKE === "1") {
  await webview.evaluate(`
    (async () => {
      const bridge = navigator.opentrayWindow ?? navigator.window;
      const screen = navigator.opentrayScreen ?? navigator.screen;
      if (!bridge) {
        throw new Error("navigator.window bridge is unavailable");
      }
      const capabilities = await bridge.getCapabilities();
      const originalStyle = await bridge.getStyle();
      const originalWindowState = await bridge.getWindowState();
      if (capabilities.platform === "windows") {
        await bridge.maximize();
        const maximizedBeforeMaterial = await bridge.getWindowState();
        if (!maximizedBeforeMaterial.maximized) {
          throw new Error("Windows window did not maximize before material switch");
        }
        await bridge.setBackground("mica");
        const micaStyle = await bridge.getStyle();
        if (micaStyle.background?.kind !== "platformMaterial" || micaStyle.background?.material !== "mica") {
          throw new Error("Windows background material did not apply");
        }
        const maximizedAfterMica = await bridge.getWindowState();
        if (!maximizedAfterMica.maximized) {
          throw new Error("Windows material switch did not preserve maximized state");
        }
        await bridge.setBackground("opaque");
        const clearedStyle = await bridge.getStyle();
        if (clearedStyle.background?.kind !== "opaque") {
          throw new Error("Windows background did not clear");
        }
        const maximizedAfterOpaque = await bridge.getWindowState();
        if (!maximizedAfterOpaque.maximized) {
          throw new Error("Windows opaque switch did not preserve maximized state");
        }
        if (!originalWindowState.maximized) {
          await bridge.restore();
        }
      }
      await bridge.setStyle({ keepOnTop: !originalStyle.keepOnTop });
      await bridge.setStyle({ keepOnTop: originalStyle.keepOnTop });
      await bridge.resizeTo(880, 640);
      await bridge.moveTo(120, 120);
      const state = await bridge.getWindowState();
      const screenDetails = await screen?.getScreenDetails?.();
      document.title = [
        "opentray-bridge-ok",
        capabilities.platform,
        state.state,
        Boolean(screenDetails?.currentScreen)
      ].join(":");
    })().catch((error) => {
      document.title = "opentray-bridge-fail:" + String(error?.message ?? error);
    });
  `);
  console.log("bridge smoke evaluate injected");
}

tray.onMenuClick(({ itemId }) => {
  if (itemId === 99) {
    void lifecycle.shutdown();
  }
});

await lifecycle.wait;

function resolveOverlayEnabled(
  args: readonly string[],
  envValue: string | undefined,
): boolean {
  let enabled = parseBooleanEnv(envValue) ?? true;
  for (const arg of args) {
    if (arg === "--overlay" || arg === "--window-controls-overlay") {
      enabled = true;
    } else if (
      arg === "--no-overlay" ||
      arg === "--no-window-controls-overlay"
    ) {
      enabled = false;
    }
  }
  return enabled;
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      return undefined;
  }
}
