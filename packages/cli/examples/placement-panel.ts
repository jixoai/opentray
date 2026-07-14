// Orthogonal intents (2026-07-14; original user request: prove tray-relative placement):
// 1. Exercise placement modes through native tray and screen authorities.
// 2. Assert tray smoke provenance does not fall back to screen center.

import {
  WebviewPlacementKit,
  type WebviewPlacement,
  type WebviewPlacementResult,
  type WebviewWindowStylePatch,
} from "../../ext-webview/src/index";
import type { Menu } from "../src/index";
import { createExampleLifecycle, sleep } from "./_support/example-lifecycle";
import { ensureAppInstalled, startDevServer } from "./_support/dev-server";
import {
  createVisibleTrayIcon,
  createWebviewExampleRuntime,
  listenWebviewIpcMessages,
  mountExampleWebview,
  type WebviewPageMessageWatch,
} from "./_support/webview-example-support";

function createPlacementStyle(platform: NodeJS.Platform): WebviewWindowStylePatch {
  return {
    frameless: true,
    keepOnTop: true,
    background: { kind: "semantic", token: "blur", state: "active" },
    platform:
      platform === "win32" ? { windows: { cornerPreference: "round" } } : {},
  };
}

const PANEL_WIDTH = 800;
const PANEL_HEIGHT = 600;
const OPEN_ITEM_ID = 1;
const QUIT_ITEM_ID = 99;

const PLACEMENTS = [
  "tray",
  "screen-center",
  "screen-top",
  "screen-right",
  "screen-bottom",
  "screen-left",
  "screen-top-left",
  "screen-top-right",
  "screen-bottom-left",
  "screen-bottom-right",
  "edge",
  "edge-x",
  "edge-y",
  "edge-top",
  "edge-right",
  "edge-bottom",
  "edge-left",
] as const satisfies readonly WebviewPlacement[];

console.log(
  "placement trace: WebviewPlacementKit watch/applyOnce with tray, screen, and edge anchors"
);

ensureAppInstalled();

const icon = createVisibleTrayIcon();
const runtime = await createWebviewExampleRuntime({
  importMetaUrl: import.meta.url,
  requestIdPrefix: "placement-demo",
  homePrefix: "opentray-placement",
  tray: {
    id: "com.example.opentray.placement",
    tooltip: {
      title: "OpenTray Placement Demo",
      description: "WebviewPlacementKit tray, screen, and edge anchors",
    },
    menu: createMenu(),
  },
});
const { tray } = runtime;

const webviewTray = mountExampleWebview(runtime, "placement-demo-webview");
const devServer = await startDevServer("/placement");
console.log(`placement panel: ${devServer.url}`);
const panel = webviewTray.createWebviewWindow({
  url: devServer.url,
  width: PANEL_WIDTH,
  height: PANEL_HEIGHT,
  title: "OpenTray Placement Demo",
  icon,
  nativeWindowApi: true,
  nativeTrayApi: true,
  style: createPlacementStyle(process.platform),
  nativeApiPolicy: {
    defaultSrc: ["'local'"],
  },
});
const placementKit = new WebviewPlacementKit({ tray, screen: webviewTray });

let panelShown = false;
let placementWatch:
  | Awaited<ReturnType<WebviewPlacementKit["watch"]>>
  | undefined;
let pageMessageWatch: WebviewPageMessageWatch | undefined;
let panelLifecycleUnlisten: (() => void) | undefined;
let currentFallbackRect = { x: 0, y: 0, width: 1, height: 1 };
let currentMode = "watch:tray";
let lastPlacement: WebviewPlacementResult | undefined;
const lifecycle = createExampleLifecycle({
  exitAfterMs: process.env.OPENTRAY_EXAMPLE_EXIT_AFTER_MS,
  onShutdown: async () => {
    stopPanelWatches();
    try {
      await panel.destroy();
    } catch {
      // The panel may never have been opened; closing the runtime session is still authoritative.
    }
    await devServer.close();
    await runtime.shutdown();
  },
});

tray.onMenuClick(({ itemId }) => {
  if (itemId === OPEN_ITEM_ID) {
    void openPanel();
    return;
  }
  if (itemId === QUIT_ITEM_ID) {
    void lifecycle.shutdown();
  }
});

console.log(
  "Use tray menu item 'Open Placement Kit' to review placement modes."
);

const smoke = process.env.OPENTRAY_EXAMPLE_WEBVIEW_SMOKE;
if (smoke === "1") {
  lifecycle.clearExitTimer();
}
if (smoke === "show" || smoke === "1") {
  await openPanel();
}
if (smoke === "1") {
  await sleep(500);
  lastPlacement = placementWatch
    ? await placementWatch.refresh()
    : lastPlacement;
  const trayBounds = await tray.getBounds();
  console.log(`placement smoke tray bounds: ${JSON.stringify(trayBounds)}`);
  console.log(`placement smoke result: ${JSON.stringify(lastPlacement)}`);
  if (
    trayBounds.kind !== "native" ||
    trayBounds.source !== "backend.nativeTrayBounds" ||
    trayBounds.rect === null ||
    lastPlacement?.kind !== "native" ||
    !lastPlacement.source.startsWith("backend.nativeTrayBounds")
  ) {
    throw new Error("placement smoke did not resolve from native tray bounds");
  }
  await lifecycle.shutdown();
}

async function openPanel(): Promise<void> {
  stopPanelWatches();
  const trayBounds = await tray.getBounds();
  currentFallbackRect = trayBounds.rect ?? { x: 0, y: 0, width: 1, height: 1 };
  await panel.show({ fallbackRect: currentFallbackRect });
  panelShown = true;
  pageMessageWatch = listenWebviewIpcMessages(panel, handlePanelIpcMessage, {
    intervalMs: 16,
  });
  panelLifecycleUnlisten = panel.listen("windowstatechange", (event) => {
    if (!event.payload.visible) {
      panelShown = false;
      stopPanelWatches();
    }
  });
  await startPlacementWatch("tray");
}

async function startPlacementWatch(placement: WebviewPlacement): Promise<void> {
  placementWatch?.stop();
  placementWatch = undefined;
  const bounds = await currentPanelBounds();
  placementWatch = await placementKit.watch(panel, {
    placement,
    width: bounds.width,
    height: bounds.height,
    placementMargin: 12,
    fallbackRect: currentFallbackRect,
    settleMs: 120,
  });
  currentMode = `watch:${placement}`;
  lastPlacement = placementWatch.latest ?? undefined;
  await broadcastPanelState();
}

async function applyPlacementOnce(placement: WebviewPlacement): Promise<void> {
  placementWatch?.stop();
  placementWatch = undefined;
  const bounds = await currentPanelBounds();
  lastPlacement = await placementKit.applyOnce(panel, {
    placement,
    width: bounds.width,
    height: bounds.height,
    placementMargin: 12,
    fallbackRect: currentFallbackRect,
    windowRect: bounds,
  });
  currentMode = `once:${placement}`;
  await broadcastPanelState();
}

async function refreshPlacement(): Promise<void> {
  if (placementWatch) {
    lastPlacement = await placementWatch.refresh();
  }
  await broadcastPanelState();
}

function stopPlacementWatch(): void {
  placementWatch?.stop();
  placementWatch = undefined;
  currentMode = "stopped";
}

function pausePlacementWatch(): void {
  placementWatch?.pause();
}

async function resumePlacementWatch(): Promise<void> {
  if (!placementWatch) {
    return;
  }
  lastPlacement = await placementWatch.resume();
  await broadcastPanelState();
}

function stopPanelWatches(): void {
  stopPlacementWatch();
  pageMessageWatch?.stop();
  pageMessageWatch = undefined;
  panelLifecycleUnlisten?.();
  panelLifecycleUnlisten = undefined;
}

async function handlePanelIpcMessage(message: {
  payload: unknown;
}): Promise<void> {
  const payload = message.payload;
  if (isWindowInteractionIntent(payload)) {
    if (payload.active) {
      pausePlacementWatch();
    } else {
      await resumePlacementWatch();
    }
    return;
  }
  if (!isPlacementIntent(payload)) {
    return;
  }
  if (payload.type === "watch") {
    await startPlacementWatch(payload.placement);
    return;
  }
  if (payload.type === "once") {
    await applyPlacementOnce(payload.placement);
    return;
  }
  if (payload.type === "refresh") {
    await refreshPlacement();
    return;
  }
  if (payload.type === "stop") {
    stopPlacementWatch();
    await broadcastPanelState();
    return;
  }
  if (payload.type === "hide") {
    stopPanelWatches();
    panelShown = false;
    await panel.hide();
  }
}

async function currentPanelBounds(): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
}> {
  try {
    return await panel.getBounds();
  } catch {
    return {
      x: currentFallbackRect.x,
      y: currentFallbackRect.y,
      width: PANEL_WIDTH,
      height: PANEL_HEIGHT,
    };
  }
}

async function broadcastPanelState(): Promise<void> {
  if (!panelShown) {
    return;
  }
  try {
    await panel.postMessage({
      type: "placementKitState",
      mode: currentMode,
      watchActive: placementWatch?.active ?? false,
      placement: lastPlacement ?? null,
      bounds: await currentPanelBounds(),
    });
  } catch (error) {
    console.error(`placement panel state update failed: ${String(error)}`);
  }
}

function createMenu(): Menu {
  return {
    items: [
      {
        type: "item",
        id: OPEN_ITEM_ID,
        title: "Open Placement Kit",
        primaryEvent: true,
      },
      { type: "separator" },
      { type: "item", id: QUIT_ITEM_ID, title: "Quit Demo" },
    ],
  };
}

type PlacementIntent =
  | { type: "watch"; placement: WebviewPlacement }
  | { type: "once"; placement: WebviewPlacement }
  | { type: "refresh" }
  | { type: "stop" }
  | { type: "hide" };
type WindowInteractionIntent = { type: "windowInteraction"; active: boolean };

function isPlacementIntent(value: unknown): value is PlacementIntent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    record.type === "refresh" ||
    record.type === "stop" ||
    record.type === "hide"
  ) {
    return true;
  }
  return (
    (record.type === "watch" || record.type === "once") &&
    typeof record.placement === "string" &&
    isPlacement(record.placement)
  );
}

function isPlacement(value: string): value is WebviewPlacement {
  return PLACEMENTS.includes(value as (typeof PLACEMENTS)[number]);
}

function isWindowInteractionIntent(
  value: unknown
): value is WindowInteractionIntent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.type === "windowInteraction" && typeof record.active === "boolean"
  );
}

await lifecycle.wait;
