import { mediaQueryKit, styleKit } from "../../ext-webview/src/index";
import type { Menu } from "../src/index";
import { createExampleLifecycle, sleep } from "./_support/example-lifecycle";
import { ensureAppInstalled, startDevServer } from "./_support/dev-server";
import {
  createExamplePrimaryMenu,
  createVisibleTrayIcon,
  createWebviewExampleRuntime,
  listenWebviewIpcMessages,
  mountExampleWebview,
  shutdownWebviewExample,
  syncExamplePrimaryMenu,
  type WebviewPageMessageWatch,
} from "./_support/webview-example-support";

const PANEL_WIDTH = 440;
const PANEL_HEIGHT = 290;
const OPEN_ITEM_ID = 1;
const QUIT_ITEM_ID = 99;

type WidthMode = "compact" | "comfort" | "wide";
type HeightMode = "fit" | "tall";

console.log("mediaQuery trace: styleKit recipes + mediaQueryKit native-bounds callbacks");

ensureAppInstalled();

const icon = createVisibleTrayIcon();
const runtime = await createWebviewExampleRuntime({
  importMetaUrl: import.meta.url,
  requestIdPrefix: "media-query-demo",
  homePrefix: "opentray-media-query",
  tray: {
    id: "com.example.opentray.media-query",
    tooltip: {
      title: "OpenTray Media Query Demo",
      description: "mediaQueryKit + styleKit native window recipes",
    },
    menu: createMenu(false),
  },
});
const { tray } = runtime;

const webviewTray = mountExampleWebview(runtime, "media-query-demo-webview");
const devServer = await startDevServer("/media-query");
console.log(`media-query panel: ${devServer.url}`);
const panel = webviewTray.createWebviewWindow({
  url: devServer.url,
  width: PANEL_WIDTH,
  height: PANEL_HEIGHT,
  title: "OpenTray Media Query Demo",
  icon,
  nativeWindowApi: true,
  nativeTrayApi: true,
  nativeApiPolicy: {
    defaultSrc: ["'local'"],
  },
});

let panelShown = false;
let panelBootstrapped = false;
let visibilitySubscribed = false;
let stopVisibleChange: (() => void) | undefined;
let mediaWatch: Awaited<ReturnType<typeof mediaQueryKit.match>> | undefined;
let pageMessageWatch: WebviewPageMessageWatch | undefined;
let panelLifecycleUnlisten: (() => void) | undefined;
let widthMode: WidthMode = "comfort";
let heightMode: HeightMode = "fit";
const lifecycle = createExampleLifecycle({
  exitAfterMs: process.env.OPENTRAY_EXAMPLE_EXIT_AFTER_MS,
  onShutdown: async () => {
    stopPanelWatches();
    stopVisibleChange?.();
    try {
      await panel.destroy();
    } catch {
      // The panel may never have been opened; closing the runtime session is still authoritative.
    }
    panelBootstrapped = false;
    await shutdownWebviewExample(runtime, devServer);
  },
});

tray.onMenuClick(({ itemId }) => {
  if (itemId === OPEN_ITEM_ID) {
    void toggleExampleVisibility();
    return;
  }
  if (itemId === QUIT_ITEM_ID) {
    void lifecycle.shutdown();
  }
});

console.log("Use the primary tray action to Show Example or Hide Example.");

const smoke = process.env.OPENTRAY_EXAMPLE_WEBVIEW_SMOKE;
if (smoke === "1") {
  lifecycle.clearExitTimer();
}
if (smoke === "show" || smoke === "1") {
  await openPanel();
}
if (smoke === "1") {
  await sleep(500);
  await lifecycle.shutdown();
}

async function openPanel(): Promise<void> {
  const trayBounds = await tray.getBounds();
  if (!panelBootstrapped) {
    await panel.show({ fallbackRect: trayBounds.rect ?? { x: 0, y: 0, width: 1, height: 1 } });
    panelShown = true;
    panelBootstrapped = true;
    subscribeVisibility();
    await syncPrimaryMenu(true);
    await styleKit.apply(panel, {
      initWidth: PANEL_WIDTH,
      initHeight: PANEL_HEIGHT,
      minWidth: 320,
      minHeight: 230,
      maxWidth: 760,
      maxHeight: 540,
      background: "blur",
      state: "active",
      frameless: true,
      keepOnTop: true,
      platform: process.platform === "win32" ? { windows: { cornerPreference: "round" } } : {},
    });
    await startPanelWatches();
    await broadcastPanelState();
    return;
  }

  await panel.toVisible();
  panelShown = true;
  await startPanelWatches();
  await broadcastPanelState();
}

async function startPanelWatches(): Promise<void> {
  if (pageMessageWatch === undefined) {
    pageMessageWatch = listenWebviewIpcMessages(panel, handlePanelIpcMessage, { intervalMs: 16 });
  }
  if (panelLifecycleUnlisten === undefined) {
    panelLifecycleUnlisten = panel.listen("windowstatechange", (event) => {
      if (!event.payload.visible) {
        panelShown = false;
        stopPanelWatches();
      }
    });
  }
  if (mediaWatch === undefined) {
    await startMediaWatch();
  }
}

async function startMediaWatch(): Promise<void> {
  mediaWatch?.stop();
  mediaWatch = await mediaQueryKit.match(
    panel,
    {
      maxWidth: 419,
      callback: async () => {
        widthMode = "compact";
        await applyResponsiveStyle({ minHeight: 230 });
      },
    },
    {
      minWidth: 420,
      maxWidth: 579,
      callback: async () => {
        widthMode = "comfort";
        await applyResponsiveStyle({ minHeight: 250 });
      },
    },
    {
      minWidth: 580,
      callback: async () => {
        widthMode = "wide";
        await applyResponsiveStyle({ minHeight: 290 });
      },
    },
    {
      maxHeight: 359,
      callback: async () => {
        heightMode = "fit";
        await broadcastPanelState();
      },
    },
    {
      minHeight: 360,
      callback: async () => {
        heightMode = "tall";
        await applyResponsiveStyle({ maxHeight: 540 });
      },
    },
  );
}

async function applyResponsiveStyle(style: { minHeight?: number; maxHeight?: number }): Promise<void> {
  await styleKit.apply(panel, {
    ...style,
    background: "blur",
    state: "active",
    frameless: true,
    keepOnTop: true,
  });
  await broadcastPanelState();
}

function pauseMediaWatch(): void {
  mediaWatch?.pause();
}

async function resumeMediaWatch(): Promise<void> {
  if (!mediaWatch) {
    return;
  }
  await mediaWatch.resume();
  await broadcastPanelState();
}

function stopPanelWatches(): void {
  mediaWatch?.stop();
  mediaWatch = undefined;
  pageMessageWatch?.stop();
  pageMessageWatch = undefined;
  panelLifecycleUnlisten?.();
  panelLifecycleUnlisten = undefined;
}

async function handlePanelIpcMessage(message: { payload: unknown }): Promise<void> {
  const payload = message.payload;
  if (isWindowInteractionIntent(payload)) {
    if (payload.active) {
      pauseMediaWatch();
    } else {
      await resumeMediaWatch();
    }
    return;
  }
  if (!isMediaIntent(payload)) {
    return;
  }
  if (payload.type === "resize") {
    pauseMediaWatch();
    await panel.resizeTo(payload.width, payload.height);
    await resumeMediaWatch();
    return;
  }
  if (payload.type === "refresh") {
    await mediaWatch?.refresh();
    await broadcastPanelState();
    return;
  }
  if (payload.type === "hide") {
    stopPanelWatches();
    panelShown = false;
    await panel.close();
  }
}

async function broadcastPanelState(): Promise<void> {
  if (!panelShown) {
    return;
  }
  try {
    await panel.postMessage({
      type: "mediaQueryKitState",
      widthMode,
      heightMode,
      watchActive: mediaWatch?.active ?? false,
      bounds: await panel.getBounds(),
    });
  } catch (error) {
    console.error(`media query panel state update failed: ${String(error)}`);
  }
}

async function toggleExampleVisibility(): Promise<void> {
  if (panelBootstrapped && (await panel.isVisible())) {
    stopPanelWatches();
    panelShown = false;
    await panel.close();
    return;
  }
  await openPanel();
}

async function syncPrimaryMenu(visible: boolean): Promise<void> {
  await syncExamplePrimaryMenu(tray, {
    visible,
    primaryItemId: OPEN_ITEM_ID,
    trailingItems: [{ type: "separator" }, { type: "item", id: QUIT_ITEM_ID, title: "Quit Demo" }],
  });
}

function subscribeVisibility(): void {
  if (visibilitySubscribed) {
    return;
  }
  visibilitySubscribed = true;
  stopVisibleChange = panel.listen("visibleChange", ({ payload }) => {
    void syncPrimaryMenu(payload.visible);
  });
}

function createMenu(visible: boolean): Menu {
  return createExamplePrimaryMenu({
    visible,
    primaryItemId: OPEN_ITEM_ID,
    trailingItems: [{ type: "separator" }, { type: "item", id: QUIT_ITEM_ID, title: "Quit Demo" }],
  });
}

type MediaIntent =
  | { type: "resize"; width: number; height: number }
  | { type: "refresh" }
  | { type: "hide" };
type WindowInteractionIntent = { type: "windowInteraction"; active: boolean };

function isMediaIntent(value: unknown): value is MediaIntent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.type === "refresh" || record.type === "hide") {
    return true;
  }
  return (
    record.type === "resize" &&
    typeof record.width === "number" &&
    Number.isFinite(record.width) &&
    typeof record.height === "number" &&
    Number.isFinite(record.height)
  );
}

function isWindowInteractionIntent(value: unknown): value is WindowInteractionIntent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.type === "windowInteraction" && typeof record.active === "boolean";
}

await lifecycle.wait;
