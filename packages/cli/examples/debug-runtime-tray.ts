import { createExampleLifecycle, sleep } from "./_support/example-lifecycle";
import { ensureAppInstalled, startDevServer } from "./_support/dev-server";
import {
  createWebviewExampleRuntime,
  mountExampleWebview,
} from "./_support/webview-example-support";

ensureAppInstalled();

const runtime = await createWebviewExampleRuntime({
  importMetaUrl: import.meta.url,
  requestIdPrefix: "debug-runtime-example",
  homePrefix: "opentray-debug-runtime-tray",
  tray: {
    id: "com.example.opentray.debug-runtime",
    tooltip: {
      title: "OpenTray",
      description:
        "Single primary tray action; macOS direct-triggers without opening a menu",
    },
    menu: {
      items: [
        { type: "item", id: 1, title: "Open WebView", primaryEvent: true },
      ],
    },
  },
});
const { tray } = runtime;
const devServer = await startDevServer("/debug-runtime-tray");
console.log(`debug-runtime-tray panel: ${devServer.url}`);
const webview = mountExampleWebview(
  runtime,
  "debug-runtime-webview",
).createWebviewWindow({
  url: devServer.url,
  width: 420,
  height: 260,
  nativeWindowApi: true,
  bindWindowGlobals: true,
  nativeTrayApi: true,
});

tray.onMenuClick(({ itemId }) => {
  console.log(`menu click: ${itemId}`);
  void handleMenuClick(itemId);
});
console.log("webview window mounted through tray.extend(WebviewExt)");
console.log(
  "click the tray icon: platforms with primary tray events should run the WebView action"
);
console.log("press Ctrl-C to exit the tray demo");

const lifecycle = createExampleLifecycle({
  exitAfterMs: process.env.OPENTRAY_EXAMPLE_EXIT_AFTER_MS,
  onShutdown: async () => {
    await devServer.close();
    await runtime.shutdown();
  },
});

const webviewSmoke = process.env.OPENTRAY_EXAMPLE_WEBVIEW_SMOKE;
if (webviewSmoke === "show" || webviewSmoke === "1") {
  await handleMenuClick(1);
}
if (webviewSmoke === "1") {
  lifecycle.clearExitTimer();
  await sleep(300);
  await lifecycle.shutdown();
}

async function handleMenuClick(itemId: number): Promise<void> {
  if (itemId === 1) {
    const trayBounds = await tray.getBounds();
    console.log(`tray bounds: ${JSON.stringify(trayBounds)}`);

    await webview.show({
      fallbackRect: trayBounds.rect ?? { x: 0, y: 0, width: 1, height: 1 },
    });
    console.log("webview command: show");
    return;
  }
}

await lifecycle.wait;
