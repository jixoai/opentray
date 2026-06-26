import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient } from "../src/index";
import { connectLocalBroker } from "../src/node";
import { attachWebview, type WebviewShowCommand } from "../../ext-webview/src/index";
import { createVisibleTrayIcon, prepareLocalWebviewExtensionPath } from "./_support/webview-example-support";

const controlPageUrl = new URL("./webview-control.html", import.meta.url);
const controlPageHtml = await readFile(controlPageUrl, "utf8");

const localWebviewExtension = await prepareLocalWebviewExtensionPath(import.meta.url);
const demoHomeDir = process.env.OPENTRAY_HOME ?? join(tmpdir(), `opentray-webview-control-${process.pid}`);
// windowControlsOverlay is a show-time bridge gate; the page can test it, not enable it later.
const overlayEnabled = resolveOverlayEnabled(
  process.argv.slice(2),
  process.env.OPENTRAY_EXAMPLE_WEBVIEW_OVERLAY,
);
const connection = await connectLocalBroker({ homeDir: demoHomeDir });
const client = createClient(connection, { requestIdPrefix: "webview-control" });
console.log(`connected: endpoint=${connection.endpoint} session=${connection.sessionId}`);
console.log(`broker home: ${demoHomeDir}`);
console.log(`windowControlsOverlay: ${overlayEnabled ? "enabled" : "disabled"}`);
if (localWebviewExtension !== undefined) {
  console.log(`webview dylib: ${localWebviewExtension}`);
}

const tray = await client.createTray({
  id: "com.example.opentray.webview-control",
  tooltip: {
    title: "OpenTray",
    description: "Native WebView control demo launched directly from the page",
  },
  icon: createVisibleTrayIcon(),
  menu: {
    items: [{ type: "item", id: 99, title: "Quit Demo" }],
  },
});
console.log(`tray: ${tray.trayId}`);

await tray.loadExtension({
  name: "webview",
  path: "@opentray/ext-webview",
});

const webview = attachWebview(tray);

const showCommand: WebviewShowCommand = {
  type: "show",
  html: controlPageHtml,
  width: 960,
  height: 720,
  title: "OpenTray WebView Control Demo",
  icon: createVisibleTrayIcon(),
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
};
await webview.show(showCommand);

console.log(`control page source: ${controlPageUrl.href}`);
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

let closed = false;
let exitTimer: NodeJS.Timeout | undefined;
let resolveLifecycle: (() => void) | undefined;
const lifecycle = new Promise<void>((resolve) => {
  resolveLifecycle = resolve;
});
const shutdownSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

const exitAfter = process.env.OPENTRAY_EXAMPLE_EXIT_AFTER_MS;
if (exitAfter !== undefined && exitAfter.length > 0) {
  const duration = Number.parseInt(exitAfter, 10);
  if (Number.isInteger(duration) && duration > 0) {
    exitTimer = setTimeout(() => {
      void shutdown();
    }, duration);
  }
}

for (const signal of shutdownSignals) {
  process.once(signal, () => {
    void shutdown();
  });
}

connection.onEvent((frame) => {
  if (frame.type === "event" && frame.event.type === "menuClick" && frame.event.itemId === 99) {
    void shutdown();
  }
});

async function shutdown(): Promise<void> {
  if (closed) {
    return;
  }
  closed = true;
  if (exitTimer !== undefined) {
    clearTimeout(exitTimer);
  }
  await connection.close();
  resolveLifecycle?.();
}

await lifecycle;

function resolveOverlayEnabled(args: readonly string[], envValue: string | undefined): boolean {
  let enabled = parseBooleanEnv(envValue) ?? true;
  for (const arg of args) {
    if (arg === "--overlay" || arg === "--window-controls-overlay") {
      enabled = true;
    } else if (arg === "--no-overlay" || arg === "--no-window-controls-overlay") {
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
