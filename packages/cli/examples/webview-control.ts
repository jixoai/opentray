import { spawn } from "node:child_process";
import { access, constants, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "../src/index";
import { connectLocalBroker } from "../src/node";
import { attachWebview } from "../../ext-webview/src/index";

const controlPageUrl = new URL("./webview-control.html", import.meta.url);
const controlPageHtml = await readFile(controlPageUrl, "utf8");

const localWebviewExtension = await resolveLocalWebviewExtension();
if (process.env.OPENTRAY_EXT_PATH === undefined && localWebviewExtension !== undefined) {
  process.env.OPENTRAY_EXT_PATH = localWebviewExtension;
}

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
  icon: createVisibleIcon(),
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
  icon: createVisibleIcon(),
  style: {
    frameless: false,
    transparent: false,
    keepOnTop: false,
    backgroundEffect: null,
    cornerRadius: null,
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

function createVisibleIcon(): { type: "rgba"; width: number; height: number; data: number[] } {
  const width = 32;
  const height = 32;
  const data: number[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - 15.5;
      const dy = y - 15.5;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const inRing = distance >= 9 && distance <= 14;
      const inCore = distance <= 5;
      const inNeedle = Math.abs(dx + dy) <= 1.2 && x >= 9 && x <= 23 && y >= 9 && y <= 23;

      if (inRing || inCore || inNeedle) {
        data.push(inCore ? 255 : 24, inNeedle ? 240 : 132, inRing ? 72 : 96, 255);
      } else {
        data.push(0, 0, 0, 0);
      }
    }
  }

  return { type: "rgba", width, height, data };
}

async function resolveLocalWebviewExtension(): Promise<string | undefined> {
  const workspaceCargoToml = fileURLToPath(new URL("../../../Cargo.toml", import.meta.url));
  try {
    await access(workspaceCargoToml, constants.R_OK);
    await runCargoBuild(fileURLToPath(new URL("../../../", import.meta.url)));
  } catch {
    // Not running from the workspace root layout, so skip the source-build path.
  }

  const artifactName =
    process.platform === "win32"
      ? "opentray_ext_webview.dll"
      : process.platform === "darwin"
        ? "libopentray_ext_webview.dylib"
        : "libopentray_ext_webview.so";
  const candidates = [
    fileURLToPath(new URL(`../../../target/debug/${artifactName}`, import.meta.url)),
    fileURLToPath(new URL(`../../../target/release/${artifactName}`, import.meta.url)),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.R_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  return undefined;
}

function runCargoBuild(workspaceRoot: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("cargo", ["build", "-p", "opentray-ext-webview"], {
      cwd: workspaceRoot,
      stdio: process.env.OPENTRAY_EXT_BUILD_LOGS === "1" ? "inherit" : "ignore",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`cargo build -p opentray-ext-webview failed with code ${code ?? "unknown"}`));
    });
  });
}
