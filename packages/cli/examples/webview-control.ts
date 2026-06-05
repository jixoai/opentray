import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createClient } from "../src/index";
import { connectLocalBroker } from "../src/node";
import { attachWebview } from "../../ext-webview/src/index";
import { createVisibleTrayIcon, prepareLocalWebviewExtensionPath } from "./_support/webview-example-support";

const controlPageUrl = new URL("./webview-control.html", import.meta.url);
const controlPageHtml = await readFile(controlPageUrl, "utf8");

const localWebviewExtension = await prepareLocalWebviewExtensionPath(import.meta.url);

const demoHomeDir = process.env.OPENTRAY_HOME ?? join("/tmp", `opentray-webview-control-${process.pid}`);
const connection = await connectLocalBroker({ homeDir: demoHomeDir });
const client = createClient(connection, { requestIdPrefix: "webview-control" });
console.log(`connected: endpoint=${connection.endpoint} session=${connection.sessionId}`);
console.log(`broker home: ${demoHomeDir}`);
if (localWebviewExtension !== undefined) {
  console.log(`webview dylib: ${localWebviewExtension}`);
}

const space = await client.createSpace({
  id: "com.example.opentray.webview-control",
  title: "OpenTray WebView Control Demo",
  default: true,
});
console.log(`space: ${JSON.stringify(space.space)}`);

const tray = await space.createTray({
  trayId: "webview-control",
  title: "OpenTray",
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

await connection.request({
  type: "load-ext",
  requestId: "webview-control-load-webview",
  spaceId: space.space.spaceId,
  name: "webview",
  path: "@opentray/ext-webview",
});

const webview = attachWebview(tray);
await webview.show({
  type: "show",
  html: controlPageHtml,
  width: 960,
  height: 720,
  title: "OpenTray WebView Control Demo",
  icon: createVisibleTrayIcon(),
  style: {
    frameless: false,
    transparent: false,
    keepOnTop: false,
    platform: {
      macos: {
        material: null,
        materialState: "followsWindowActiveState",
        cornerRadius: null,
      },
    },
  },
  windowControlsOverlay: true,
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
});

console.log(`control page source: ${controlPageUrl.href}`);
console.log(
  "Use the page controls to test overlay titlebar geometry, app-region drag, frameless native material, rounded corners, title, icon, screen, and navigation behavior.",
);

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
