import type { WebviewWindowStylePatch } from "../../ext-webview/src/index";
import { createExampleLifecycle, sleep } from "./_support/example-lifecycle";
import { ensureAppInstalled, startDevServer } from "./_support/dev-server";
import {
  createWebviewExampleRuntime,
  createVisibleTrayIcon,
  mountExampleWebview,
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
    menu: {
      items: [
        { type: "item", id: 1, title: "Open Tray Panel", primaryEvent: true },
      ],
    },
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
  "click the tray icon: platforms with primary tray events should toggle the WebView panel"
);
console.log("press Ctrl-C to exit the tray demo");

let panelVisible = false;

const lifecycle = createExampleLifecycle({
  exitAfterMs: process.env.OPENTRAY_EXAMPLE_EXIT_AFTER_MS,
  onShutdown: async () => {
    await devServer.close();
    await runtime.shutdown();
  },
});

tray.onMenuClick(({ itemId }) => {
  console.log(`menu click: ${itemId}`);
  if (itemId === 1) {
    void toggleTrayPanel();
  }
});

webview.listen("blur", () => {
  console.log("tray panel blur: ignored because keepOnTop panels use click-toggle dismissal");
});

async function toggleTrayPanel(): Promise<void> {
  if (panelVisible) {
    await webview.hide();
    panelVisible = false;
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
  await webview.hide();
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
    await webview.show({
      fallbackRect: trayBounds.rect ?? { x: 0, y: 0, width: 1, height: 1 },
    });
    panelVisible = true;
    console.log("tray panel command: show");
  } catch (error) {
    console.error("tray panel show failed:", String(error));
  }
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
