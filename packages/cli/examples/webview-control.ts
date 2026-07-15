// Orthogonal intents (2026-07-15; original user requests: Chrome-PWA-like Windows overlay controls,
// frameless repair, and operational visibility):
// 1. Exercise native window controls, explicit Windows caption-button colors, and bridge capabilities.
// 2. Assert overlay and frameless native/browser geometry, including resizable frameless behavior.
// 3. Smoke operational visibility queries without rebuilding the page session.

import type {
  WebviewWindowControlsOverlay,
  WebviewWindowOptions,
} from "../../ext-webview/src/index";
import { createExampleLifecycle, sleep } from "./_support/example-lifecycle";
import { ensureAppInstalled, startDevServer } from "./_support/dev-server";
import {
  createVisibleTrayIcon,
  createWebviewExampleRuntime,
  mountExampleWebview,
  shutdownWebviewExample,
} from "./_support/webview-example-support";

// windowControlsOverlay is a show-time bridge gate; the page can test it, not enable it later.
const overlayEnabled = resolveOverlayEnabled(
  process.argv.slice(2),
  process.env.OPENTRAY_EXAMPLE_WEBVIEW_OVERLAY,
);
// --frameless strips the native title bar (and with it the native window
// controls), so the page must draw its own. Useful for verifying the
// self-drawn control cluster appears when native controls are gone.
const frameless = resolveFrameless(process.argv.slice(2));
const resizable = resolveResizable(process.argv.slice(2));
const windowControlsOverlay: WebviewWindowControlsOverlay = overlayEnabled
  ? process.platform === "win32"
    ? {
        backgroundColor: "#0F6CBD",
        symbolColor: "#FFFFFF",
      }
    : true
  : false;
console.log(
  `windowControlsOverlay: ${
    overlayEnabled ? "enabled" : "disabled"
  } · frameless: ${frameless} · resizable: ${resizable ?? "default"}`,
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
    try {
      await webview.destroy();
    } catch {
      // Session shutdown remains authoritative if the window is already gone.
    }
    await shutdownWebviewExample(runtime, devServer);
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
    frameless,
    ...(resizable === undefined ? {} : { resizable }),
    keepOnTop: false,
    // Translucent native material so the page's own translucent background
    // (bg-background/80 in the route) composes with the window vibrancy. The
    // web theme tracks prefers-color-scheme so the native tint and the page
    // foreground stay readable together.
    background:
      process.platform === "darwin"
        ? {
            kind: "platformMaterial",
            material: "windowBackground",
            state: "followsWindowActiveState",
          }
        : process.platform === "win32"
          ? {
              kind: "platformMaterial",
              material: "mica",
              state: "followsWindowActiveState",
            }
          : { kind: "opaque" },
    platform:
      process.platform === "darwin"
        ? {
            macos: {
              // Verify the cornerRadius fix: this now rounds the native window
              // frame, not the page content.
              cornerRadius: 12,
            },
          }
        : process.platform === "win32"
          ? {
              windows: {
                cornerPreference: "round",
              },
            }
          : {},
  },
  windowControlsOverlay,
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
  "Use the page controls to test overlay titlebar geometry, app-region drag, background modes, rounded corners, title, icon, devtools, screen, and navigation behavior.",
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
      if (!capabilities.devtools) {
        throw new Error("devtools capability is unavailable for the example window");
      }
      await bridge.devtools.open();
      let devtoolsOpen = null;
      if (capabilities.devtoolsStateQueryable) {
        devtoolsOpen = await bridge.devtools.isOpen();
      }
      if (capabilities.devtoolsClosable) {
        await bridge.devtools.close();
      }
      const originalStyle = await bridge.getStyle();
      if (${frameless}) {
        const expectedResizable = ${JSON.stringify(resizable ?? false)};
        if (originalStyle.resizable !== expectedResizable) {
          throw new Error(
            "frameless resizable style did not match effective default: " +
              JSON.stringify({ expectedResizable, actual: originalStyle.resizable })
          );
        }
        if (!capabilities.resizable) {
          throw new Error("user resize capability is unavailable for the example window");
        }
      }
      const originalWindowState = await bridge.getWindowState();
      if (await bridge.isClosed()) {
        throw new Error("newly shown example window must not report closed");
      }
      if (!(await bridge.isVisible())) {
        throw new Error("newly shown example window must report visible");
      }
      await bridge.toVisible();
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
      const bounds = await bridge.getBounds();
      const widthGap = Math.abs(bounds.width - window.outerWidth);
      const heightGap = Math.abs(bounds.height - window.outerHeight);
      if (widthGap > 4 || heightGap > 4) {
        throw new Error(
          "native/browser outer bounds diverged: " +
            JSON.stringify({ bounds, outerWidth: window.outerWidth, outerHeight: window.outerHeight })
        );
      }
      let overlayRect = null;
      if (capabilities.overlay) {
        overlayRect = await bridge.overlay?.getTitlebarAreaRect?.();
        if (!overlayRect || overlayRect.width <= 0 || overlayRect.height <= 0) {
          throw new Error("Windows overlay titlebar geometry is unavailable");
        }
      }
      document.title = [
        "opentray-bridge-ok",
        capabilities.platform,
        state.state,
        Boolean(screenDetails?.currentScreen),
        "gap=" + widthGap + "x" + heightGap,
        "overlay=" + (overlayRect ? overlayRect.width + "x" + overlayRect.height : "off")
      ].join(":");
      await navigator.opentray?.ipc?.postMessage?.({
        type: "bridgeSmoke",
        ok: true,
        title: document.title,
        devtoolsOpen
      });
    })().catch((error) => {
      document.title = "opentray-bridge-fail:" + String(error?.message ?? error);
      void navigator.opentray?.ipc?.postMessage?.({
        type: "bridgeSmoke",
        ok: false,
        title: document.title
      });
    });
  `);
  console.log("bridge smoke evaluate injected");
  const bridgeSmoke = await waitForBridgeSmoke(webview, 5_000);
  if (bridgeSmoke?.ok !== true) {
    throw new Error(
      `bridge smoke failed: ${bridgeSmoke?.title ?? "missing result"}`,
    );
  }
  console.log(`bridge smoke result: ${bridgeSmoke.title}`);
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

function resolveFrameless(args: readonly string[]): boolean {
  return args.some((arg) => arg === "--frameless");
}

function resolveResizable(args: readonly string[]): boolean | undefined {
  let value: boolean | undefined;
  for (const arg of args) {
    if (arg === "--resizable") {
      value = true;
    } else if (arg === "--no-resizable") {
      value = false;
    }
  }
  return value;
}

type BridgeSmokePayload = {
  type: "bridgeSmoke";
  ok: boolean;
  title: string;
};

type BridgeSmokeWindow = {
  drainIpcMessages(): Promise<readonly { payload: unknown }[]>;
};

async function waitForBridgeSmoke(
  window: BridgeSmokeWindow,
  timeoutMs: number,
): Promise<BridgeSmokePayload | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const bridgeSmoke = (await window.drainIpcMessages())
      .map((message) => message.payload)
      .find(isBridgeSmokePayload);
    if (bridgeSmoke) {
      return bridgeSmoke;
    }
    await sleep(100);
  }
  return undefined;
}

function isBridgeSmokePayload(payload: unknown): payload is BridgeSmokePayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "type" in payload &&
    "ok" in payload &&
    "title" in payload &&
    payload.type === "bridgeSmoke" &&
    typeof payload.ok === "boolean" &&
    typeof payload.title === "string"
  );
}
