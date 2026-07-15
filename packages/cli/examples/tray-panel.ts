import type { WebviewWindowStylePatch } from "../../ext-webview/src/index";
import { createExampleLifecycle, sleep } from "./_support/example-lifecycle";
import { ensureAppInstalled, startDevServer } from "./_support/dev-server";
import {
  createExamplePrimaryMenu,
  createWebviewExampleRuntime,
  createVisibleTrayIcon,
  EXAMPLE_PRIMARY_ITEM_ID,
  mountExampleWebview,
  shutdownWebviewExample,
  syncExamplePrimaryMenu,
} from "./_support/webview-example-support";

ensureAppInstalled();

const icon = createVisibleTrayIcon();
const runtime = await createWebviewExampleRuntime({
  importMetaUrl: import.meta.url,
  requestIdPrefix: "tray-panel",
  homePrefix: "opentray-tray-panel",
  tray: {
    id: "com.example.opentray.tray-panel",
    tooltip: {
      title: "OpenTray",
      description:
        "Single primary tray action launching a custom WebView tray panel",
    },
    menu: createExamplePrimaryMenu({ visible: false }),
  },
});
const { tray } = runtime;

const webviewTray = mountExampleWebview(runtime, "tray-panel-webview");
const devServer = await startDevServer("/tray-panel");
console.log(`tray panel: ${devServer.url}`);
const webview = webviewTray.createWebviewWindow({
  url: devServer.url,
  width: 388,
  height: 286,
  title: "OpenTray Tray Panel",
  icon,
  style: createTrayPanelWindowStyle(),
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
console.log(
  "click the tray icon: the primary action toggles Show Example and Hide Example"
);
console.log("press Ctrl-C to exit the tray demo");

let panelBootstrapped = false;
let visibilitySubscribed = false;
let stopVisibleChange: (() => void) | undefined;
let stopBlur: (() => void) | undefined;

const lifecycle = createExampleLifecycle({
  exitAfterMs: process.env.OPENTRAY_EXAMPLE_EXIT_AFTER_MS,
  onShutdown: async () => {
    stopVisibleChange?.();
    stopBlur?.();
    try {
      await webview.destroy();
    } catch {
      // The panel may already be gone; runtime shutdown still owns final cleanup.
    }
    await shutdownWebviewExample(runtime, devServer);
  },
});

tray.onMenuClick(({ itemId }) => {
  console.log(`menu click: ${itemId}`);
  if (itemId === EXAMPLE_PRIMARY_ITEM_ID) {
    void toggleTrayPanel();
  }
});

async function toggleTrayPanel(): Promise<void> {
  if (panelBootstrapped && (await webview.isVisible())) {
    await webview.close();
    console.log("tray panel command: hide");
    return;
  }
  await openTrayPanel();
}

const webviewSmoke = process.env.OPENTRAY_EXAMPLE_WEBVIEW_SMOKE;
if (webviewSmoke === "show" || webviewSmoke === "1") {
  await openTrayPanel();
}
if (webviewSmoke === "reopen") {
  await openTrayPanel();
  await sleep(250);
  await webview.close();
  await sleep(250);
  await openTrayPanel();
}
if (webviewSmoke === "set-content") {
  await openTrayPanel();
  await sleep(250);
  await webview.setContent({
    type: "setContent",
    url: `${devServer.url}?mode=content-set`,
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
  lifecycle.clearExitTimer();
  await sleep(300);
  await lifecycle.shutdown();
}
if (webviewSmoke === "reopen") {
  lifecycle.clearExitTimer();
  await sleep(400);
  await lifecycle.shutdown();
}
if (webviewSmoke === "set-content" || webviewSmoke === "destroy-reopen") {
  lifecycle.clearExitTimer();
  await sleep(400);
  await lifecycle.shutdown();
}

async function openTrayPanel(): Promise<void> {
  const trayBounds = await tray.getBounds();
  console.log(`tray bounds: ${JSON.stringify(trayBounds)}`);

  try {
    if (panelBootstrapped) {
      await webview.toVisible();
    } else {
      await webview.show({
        fallbackRect: trayBounds.rect ?? { x: 0, y: 0, width: 1, height: 1 },
      });
      panelBootstrapped = true;
      subscribeVisibility();
      await syncPrimaryMenu(true);
    }
    console.log("tray panel command: show");
  } catch (error) {
    console.error("tray panel show failed:", String(error));
  }
}

function subscribeVisibility(): void {
  if (visibilitySubscribed) {
    return;
  }
  visibilitySubscribed = true;
  stopVisibleChange = webview.listen("visibleChange", ({ payload }) => {
    void syncPrimaryMenu(payload.visible);
  });
  stopBlur = webview.listen("blur", () => {
    console.log("tray panel blur: ignored because keepOnTop panels use click-toggle dismissal");
  });
}

async function syncPrimaryMenu(visible: boolean): Promise<void> {
  await syncExamplePrimaryMenu(tray, { visible });
}

await lifecycle.wait;

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
