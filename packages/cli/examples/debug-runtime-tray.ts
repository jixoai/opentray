import { createExampleLifecycle, sleep } from "./_support/example-lifecycle";
import {
  createWebviewExampleRuntime,
  mountExampleWebview,
} from "./_support/webview-example-support";

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
const webview = mountExampleWebview(
  runtime,
  "debug-runtime-webview"
).createWebviewWindow({
  html: createWebviewDemoHtml(),
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
console.log(
  "webview window mounted through tray.extend(WebviewExt)"
);
console.log(
  "click the tray icon: platforms with primary tray events should run the WebView action"
);
console.log("press Ctrl-C to exit the tray demo");

const lifecycle = createExampleLifecycle({
  exitAfterMs: process.env.OPENTRAY_EXAMPLE_EXIT_AFTER_MS,
  onShutdown: runtime.shutdown,
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

function createWebviewDemoHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>OpenTray WebView</title>
    <style>
      :root {
        color: #18220f;
        background: #f6edd8;
        font: 15px ui-rounded, "SF Pro Rounded", "Avenir Next", sans-serif;
      }
      body {
        margin: 0;
      }
      main {
        min-height: 100vh;
        box-sizing: border-box;
        padding: 22px;
        background:
          radial-gradient(circle at 84% 10%, rgba(34, 132, 96, 0.22), transparent 34%),
          linear-gradient(135deg, #fff8e7 0%, #e9f0d8 100%);
      }
      h1 {
        margin: 0 0 8px;
        font-size: 24px;
        letter-spacing: -0.04em;
      }
      p {
        margin: 0 0 16px;
        color: #526044;
      }
      section {
        display: grid;
        gap: 10px;
      }
      .card {
        border: 1px solid rgba(24, 34, 15, 0.16);
        border-radius: 14px;
        padding: 12px;
        background: rgba(255, 255, 255, 0.72);
        box-shadow: 0 12px 30px rgba(56, 72, 36, 0.12);
      }
      .label {
        margin-bottom: 5px;
        color: #7b5b1d;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      code {
        word-break: break-word;
        white-space: pre-wrap;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 10px;
      }
      button {
        border: 0;
        border-radius: 999px;
        padding: 8px 12px;
        color: #f8f3de;
        background: #2d654d;
        font: inherit;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>OpenTray WebView</h1>
      <p>This window was opened by the single primary tray action. Use the buttons below to exercise the extension-owned WebView bridge.</p>
      <section>
        <div class="card">
          <div class="label">primary event</div>
          <code>macOS single primary item direct-triggered menuClick -> WebView show</code>
        </div>
        <div class="card">
          <div class="label">navigator.window</div>
          <code id="navigator-status">Waiting for navigator.window bootstrap</code>
          <div class="actions">
            <button id="capabilities-button">Capabilities</button>
            <button id="frameless-button">Toggle Frameless</button>
            <button id="navigator-resize-button">Grow via navigator.window</button>
            <button id="navigator-move-button">Move via navigator.window</button>
          </div>
        </div>
        <div class="card">
          <div class="label">window globals</div>
          <code id="globals-status">Waiting for global override bootstrap</code>
          <div class="actions">
            <button id="global-resize-button">Grow via window.resizeTo</button>
            <button id="global-close-button">Close via window.close</button>
          </div>
        </div>
        <div class="card">
          <div class="label">events</div>
          <code id="event-status">Waiting for navigator.window events</code>
        </div>
        <div class="card">
          <div class="label">tray bounds</div>
          <code id="tray-status">Waiting for navigator.opentray.tray</code>
        </div>
      </section>
    </main>
    <script>
      const navigatorStatus = document.getElementById("navigator-status");
      const globalsStatus = document.getElementById("globals-status");
      const eventStatus = document.getElementById("event-status");
      const trayStatus = document.getElementById("tray-status");
      const pageWindow = navigator.window ?? navigator.opentrayWindow;
      const trayApi = navigator.opentray?.tray;

      if (!pageWindow) {
        navigatorStatus.textContent = "navigator.window is disabled";
        globalsStatus.textContent = "window.close / window.resizeTo are using browser defaults";
      } else {
        navigatorStatus.textContent = "navigator.window is ready";
        globalsStatus.textContent = "window.close / window.resizeTo are delegated to the extension for this demo";
        pageWindow.getCapabilities().then((capabilities) => {
          navigatorStatus.textContent = JSON.stringify(capabilities, null, 2);
        });
        const onEvent = (event) => {
          if (eventStatus) {
            eventStatus.textContent = JSON.stringify(event, null, 2);
          }
        };
        void pageWindow.listen("moved", onEvent);
        void pageWindow.listen("resized", onEvent);
        void pageWindow.listen("stylechange", onEvent);
        void pageWindow.listen("closed", onEvent);

        document.getElementById("capabilities-button")?.addEventListener("click", async () => {
          navigatorStatus.textContent = JSON.stringify(await pageWindow.getCapabilities(), null, 2);
        });
        document.getElementById("frameless-button")?.addEventListener("click", async () => {
          const style = await pageWindow.getStyle();
          await pageWindow.setStyle({ frameless: !style.frameless });
          navigatorStatus.textContent = JSON.stringify(await pageWindow.getStyle(), null, 2);
        });
        document.getElementById("navigator-resize-button")?.addEventListener("click", () => {
          void pageWindow.resizeTo(520, 320);
        });
        document.getElementById("navigator-move-button")?.addEventListener("click", () => {
          void pageWindow.moveTo(140, 120);
        });
        document.getElementById("global-resize-button")?.addEventListener("click", () => {
          window.resizeTo(560, 360);
        });
        document.getElementById("global-close-button")?.addEventListener("click", () => {
          window.close();
        });
      }

      if (!trayApi) {
        trayStatus.textContent = "navigator.opentray.tray is disabled";
      } else {
        trayApi.getBounds().then((bounds) => {
          trayStatus.textContent = JSON.stringify(bounds, null, 2);
        });
      }
    </script>
  </body>
</html>`;
}

await lifecycle.wait;
