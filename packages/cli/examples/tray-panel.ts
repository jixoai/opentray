import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient } from "../src/index";
import { connectLocalBroker } from "../src/node";
import { attachWebview } from "../../ext-webview/src/index";
import type { WebviewWindowStylePatch } from "../../ext-webview/src/index";
import { createVisibleTrayIcon, prepareLocalWebviewExtensionPath } from "./_support/webview-example-support";

const localWebviewExtension = await prepareLocalWebviewExtensionPath(import.meta.url);

const demoHomeDir = process.env.OPENTRAY_HOME ?? join(tmpdir(), `opentray-tray-panel-${process.pid}`);
const connection = await connectLocalBroker({ homeDir: demoHomeDir });
const client = createClient(connection, { requestIdPrefix: "tray-panel" });
console.log(`connected: endpoint=${connection.endpoint} session=${connection.sessionId}`);
console.log(`broker home: ${demoHomeDir}`);
if (localWebviewExtension !== undefined) {
  console.log(`webview dylib: ${localWebviewExtension}`);
}

const space = await client.createSpace({
  id: "com.example.opentray.tray-panel",
  title: "OpenTray Tray Panel Demo",
  default: true,
});
console.log(`space: ${JSON.stringify(space.space)}`);

const tray = await space.createTray({
  trayId: "tray-panel",
  title: "OpenTray",
  tooltip: {
    title: "OpenTray",
    description: "Single primary tray action launching a custom WebView tray panel",
  },
  icon: createVisibleTrayIcon(),
  menu: {
    items: [{ type: "item", id: 1, title: "Open Tray Panel", primaryEvent: true }],
  },
});
console.log(`tray: ${tray.trayId}`);

await connection.request({
  type: "load-ext",
  requestId: "tray-panel-load-webview",
  spaceId: space.space.spaceId,
  name: "webview",
  path: "@opentray/ext-webview",
});

const webview = attachWebview(tray);
console.log("click the tray icon: platforms with primary tray events should open the WebView panel");
console.log("press Ctrl-C to exit the tray demo");

let closed = false;
let exitTimer: NodeJS.Timeout | undefined;
let resolveLifecycle: (() => void) | undefined;
const lifecycle = new Promise<void>((resolve) => {
  resolveLifecycle = resolve;
});
const shutdownSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

connection.onEvent((frame) => {
  console.log(`broker -> client ${JSON.stringify(frame)}`);
  if (frame.type === "event" && frame.event.type === "menuClick" && frame.event.itemId === 1) {
    void openTrayPanel();
  }
});

const exitAfter = process.env.OPENTRAY_EXAMPLE_EXIT_AFTER_MS;
if (exitAfter !== undefined && exitAfter.length > 0) {
  const duration = Number.parseInt(exitAfter, 10);
  if (Number.isInteger(duration) && duration > 0) {
    exitTimer = setTimeout(() => {
      void shutdown();
    }, duration);
  }
}

const webviewSmoke = process.env.OPENTRAY_EXAMPLE_WEBVIEW_SMOKE;
if (webviewSmoke === "show" || webviewSmoke === "1") {
  await openTrayPanel();
}
if (webviewSmoke === "reopen") {
  await openTrayPanel();
  await sleep(250);
  await webview.hide();
  await sleep(250);
  await openTrayPanel();
}
if (webviewSmoke === "set-content") {
  await openTrayPanel();
  await sleep(250);
  await webview.setContent({
    type: "setContent",
    html: createTrayPanelHtml("content-set"),
  });
}
if (webviewSmoke === "destroy-reopen") {
  await openTrayPanel();
  await sleep(250);
  await webview.destroy();
  await sleep(250);
  await openTrayPanel();
}
if (webviewSmoke === "1") {
  if (exitTimer !== undefined) {
    clearTimeout(exitTimer);
    exitTimer = undefined;
  }
  await sleep(300);
  await shutdown();
}
if (webviewSmoke === "reopen") {
  if (exitTimer !== undefined) {
    clearTimeout(exitTimer);
    exitTimer = undefined;
  }
  await sleep(400);
  await shutdown();
}
if (webviewSmoke === "set-content" || webviewSmoke === "destroy-reopen") {
  if (exitTimer !== undefined) {
    clearTimeout(exitTimer);
    exitTimer = undefined;
  }
  await sleep(400);
  await shutdown();
}

for (const signal of shutdownSignals) {
  process.once(signal, () => {
    void shutdown();
  });
}

async function openTrayPanel(): Promise<void> {
  const trayBounds = await tray.getBounds();
  console.log(`tray bounds: ${JSON.stringify(trayBounds)}`);

  await webview.show({
    type: "show",
    html: createTrayPanelHtml(),
    width: 388,
    height: 286,
    title: "OpenTray Tray Panel",
    fallbackRect: trayBounds.rect ?? { x: 0, y: 0, width: 1, height: 1 },
    style: {
      ...createTrayPanelWindowStyle(),
    },
    nativeWindowApi: true,
    bindWindowGlobals: true,
    nativeScreenApi: true,
    bindScreenGlobals: true,
    nativeTrayApi: true,
    titleSync: {
      documentToWindow: true,
      windowToDocument: true,
    },
    iconSync: true,
    nativeApiPolicy: {
      defaultSrc: ["'local'"],
    },
  });
  console.log("tray panel command: show");
}

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


function createTrayPanelWindowStyle(): WebviewWindowStylePatch {
  const common = {
    frameless: true,
    keepOnTop: true,
  } satisfies Pick<WebviewWindowStylePatch, "frameless" | "keepOnTop">;

  if (process.platform === "win32") {
    return {
      ...common,
      background: "mica",
      platform: {
        windows: {
          cornerPreference: "round",
        },
      },
    };
  }

  if (process.platform === "darwin") {
    return {
      ...common,
      background: {
        kind: "platformMaterial",
        material: "hudWindow",
        state: "active",
      },
      platform: {
        macos: {
          cornerRadius: 22,
        },
      },
    };
  }

  return {
    ...common,
    background: "transparent",
  };
}

function createTrayPanelHtml(mode: "default" | "content-set" = "default"): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>OpenTray Tray Panel</title>
    <meta
      name="viewport"
      content="width=device-width,initial-scale=1,viewport-fit=cover"
    />
    <style>
      :root {
        color: rgba(247, 249, 248, 0.96);
        background: transparent;
        font: 13px/1.4 ui-rounded, "SF Pro Rounded", "Avenir Next", sans-serif;
      }
      * {
        box-sizing: border-box;
      }
      html,
      body {
        margin: 0;
        padding: 0;
        width: 100%;
        min-height: 100%;
        background: transparent;
        overflow: hidden;
      }
      .panel {
        position: relative;
        display: grid;
        gap: 10px;
        width: 388px;
        padding: 14px;
        background: transparent;
      }
      .drag {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-height: 40px;
        padding: 0 2px;
        user-select: none;
      }
      .drag-title {
        display: flex;
        align-items: center;
        gap: 10px;
        font-weight: 600;
        letter-spacing: 0;
      }
      .dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: linear-gradient(135deg, #76ffd8, #89b0ff);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
      }
      button {
        appearance: none;
        border: 0;
        border-radius: 999px;
        padding: 8px 12px;
        color: inherit;
        background: rgba(255, 255, 255, 0.08);
        font: inherit;
      }
      button.secondary {
        background: rgba(255, 255, 255, 0.04);
      }
      .body {
        display: grid;
        gap: 10px;
      }
      .card {
        border-radius: 12px;
        padding: 12px 13px;
        background: rgba(255, 255, 255, 0.08);
      }
      .label {
        margin-bottom: 6px;
        color: rgba(207, 219, 214, 0.78);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      code,
      pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font: 12px/1.5 "SFMono-Regular", ui-monospace, monospace;
        color: rgba(246, 249, 248, 0.9);
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .chip {
        border-radius: 999px;
        padding: 6px 10px;
        background: rgba(255, 255, 255, 0.06);
        font-size: 12px;
      }
      .panel-sizing-probe {
        position: fixed;
        inset: auto;
        width: 0;
        height: 0;
        overflow: hidden;
        opacity: 0;
        pointer-events: none;
      }
    </style>
  </head>
  <body>
    <section class="panel">
      <header class="drag" id="drag-region">
        <div class="drag-title">
          <span class="dot"></span>
          <span>TrayPanel</span>
        </div>
        <div class="actions">
          <button class="secondary" id="toggle-transparent-button">Toggle Transparent</button>
          <button class="secondary" id="toggle-material-button">Toggle Backdrop</button>
          <button class="secondary" id="reposition-button">Reposition</button>
          <button id="close-button">Close</button>
        </div>
      </header>
      <div class="body">
        <div class="card">
          <div class="label">Scenario</div>
          <div class="chips">
            <span class="chip">primaryEvent</span>
            <span class="chip">tray.getBounds()</span>
            <span class="chip">screen.getScreenDetails()</span>
            <span class="chip">frameless glass</span>
            <span class="chip">keepOnTop</span>
            ${
              mode === "content-set"
                ? '<span class="chip">setContent()</span>'
                : ""
            }
          </div>
        </div>
        <div class="card">
          <div class="label">Tray anchor</div>
          <pre id="tray-status">Waiting for navigator.opentray.tray...</pre>
        </div>
        <div class="card">
          <div class="label">Screen placement</div>
          <pre id="screen-status">Waiting for navigator.opentrayScreen...</pre>
        </div>
        <div class="card">
          <div class="label">Session reuse</div>
          <pre id="session-status">Waiting for page session marker...</pre>
        </div>
        <div class="card">
          <div class="label">Window style</div>
          <pre id="style-status">Waiting for navigator.window style...</pre>
        </div>
      </div>
    </section>
    <script>
      const pageWindow = navigator.window ?? navigator.opentrayWindow;
      const trayApi = navigator.opentray?.tray;
      const screenApi =
        navigator.opentrayScreen ??
        (typeof navigator.screen?.getScreenDetails === "function" ? navigator.screen : undefined);
      const trayStatus = document.getElementById("tray-status");
      const screenStatus = document.getElementById("screen-status");
      const sessionStatus = document.getElementById("session-status");
      const styleStatus = document.getElementById("style-status");
      const panel = document.querySelector(".panel");
      const dragRegion = document.getElementById("drag-region");
      let fitted = false;
      const bootId =
        window.__OPENTRAY_TRAY_PANEL_BOOT_ID__ ??
        (window.__OPENTRAY_TRAY_PANEL_BOOT_ID__ = Math.random().toString(36).slice(2, 10));
      const openCount =
        window.__OPENTRAY_TRAY_PANEL_OPEN_COUNT__ =
          (window.__OPENTRAY_TRAY_PANEL_OPEN_COUNT__ ?? 0) + 1;

      function setText(id, value) {
        const element = document.getElementById(id);
        if (element) {
          element.textContent = value;
        }
      }

      function measurePanelSize() {
        if (!panel) {
          return { width: 388, height: 286 };
        }
        const rect = panel.getBoundingClientRect();
        return {
          width: Math.ceil(rect.width),
          height: Math.ceil(rect.height),
        };
      }

      async function placePanel() {
        if (!pageWindow || !screenApi) return;
        const size = measurePanelSize();
        const [details, bounds] = await Promise.all([
          screenApi.getScreenDetails(),
          trayApi?.getBounds?.() ?? Promise.resolve(null),
        ]);
        const screen = details.currentScreen ?? details.screens[0];
        const trayRect = bounds?.rect ?? null;
        const width = size.width;
        const height = size.height;
        const margin = 12;
        const trayCenterX = trayRect
          ? trayRect.x + trayRect.width / 2
          : screen.visibleFrame.x + screen.visibleFrame.width / 2;
        const targetX = Math.round(
          Math.min(
            screen.visibleFrame.x + screen.visibleFrame.width - width - margin,
            Math.max(screen.visibleFrame.x + margin, trayCenterX - width / 2),
          ),
        );
        const targetY = Math.round(
          Math.min(
            screen.visibleFrame.y + screen.visibleFrame.height - height - margin,
            Math.max(
              screen.visibleFrame.y + margin,
              trayRect
                ? trayRect.y - height - 8
                : screen.visibleFrame.y + screen.visibleFrame.height - height - 24,
            ),
          ),
        );
        await pageWindow.resizeTo(width, height);
        await pageWindow.moveTo(targetX, targetY);
        setText(
          "screen-status",
          JSON.stringify(
            {
              targetX,
              targetY,
              visibleFrame: screen?.visibleFrame ?? null,
            },
            null,
            2,
          ),
        );
      }

      async function refreshAnchor() {
        const bounds = await trayApi?.getBounds?.();
        setText("tray-status", JSON.stringify(bounds, null, 2));
      }

      async function refreshStyle() {
        if (!pageWindow?.getStyle) {
          setText("style-status", "navigator.window.getStyle() unavailable");
          return;
        }
        const style = await pageWindow.getStyle();
        setText(
          "style-status",
          JSON.stringify(
            {
              ...style,
              effectiveClearBackground: Boolean(
                style.background?.kind === "transparent" ||
                  style.background?.kind === "platformMaterial" ||
                  style.background?.kind === "semantic",
              ),
            },
            null,
            2,
          ),
        );
      }

      function refreshSessionStatus() {
        if (!sessionStatus) return;
        sessionStatus.textContent = JSON.stringify(
          {
            bootId,
            openCount,
            note: "bootId stays stable across hide/show; it only changes after destroy or content replacement",
          },
          null,
          2,
        );
      }

      async function toggleTransparent() {
        if (!pageWindow?.setBackground) return;
        const style = await pageWindow.getStyle();
        await pageWindow.setBackground(
          style.background?.kind === "transparent" ? "opaque" : "transparent",
        );
        await refreshStyle();
      }

      async function toggleMaterial() {
        if (!pageWindow?.setBackground) return;
        const style = await pageWindow.getStyle();
        const hasMaterial =
          style.background?.kind === "platformMaterial" ||
          style.background?.kind === "semantic";
        if (style.platform?.windows) {
          await pageWindow.setBackground(hasMaterial ? "opaque" : "mica");
          await refreshStyle();
          return;
        }
        await pageWindow.setBackground(
          hasMaterial ? "opaque" : { kind: "platformMaterial", material: "hudWindow", state: "active" },
        );
        await refreshStyle();
      }

      dragRegion?.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || !pageWindow?.startAppRegionDrag) return;
        void pageWindow.startAppRegionDrag({ pointerId: event.pointerId });
      });

      document.getElementById("toggle-transparent-button")?.addEventListener("click", () => {
        void toggleTransparent();
      });

      document.getElementById("toggle-material-button")?.addEventListener("click", () => {
        void toggleMaterial();
      });

      document.getElementById("reposition-button")?.addEventListener("click", () => {
        void placePanel();
      });

      document.getElementById("close-button")?.addEventListener("click", () => {
        void pageWindow?.close?.();
      });

      void refreshAnchor();
      refreshSessionStatus();
      void refreshStyle();
      if (pageWindow?.listen) {
        void pageWindow.listen("stylechange", () => {
          void refreshStyle();
        });
      }
      requestAnimationFrame(() => {
        void placePanel().then(() => {
          fitted = true;
        });
      });
      window.addEventListener("resize", () => {
        if (!fitted) return;
        void placePanel();
      });
    </script>
  </body>
</html>`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
