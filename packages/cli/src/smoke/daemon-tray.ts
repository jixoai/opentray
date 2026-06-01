import type { Rect } from "@opentray/spec";

import { createClient } from "../client";
import { connectLocalBroker } from "../local-broker";

const menuLabels = new Map<number, string>([
  [1, "Primary Action"],
  [3, "Checked Capability"],
  [4, "Radio: Active"],
  [5, "Radio: Passive"],
  [6, "Nested Action"],
  [7, "Nested Check"],
  [8, "WebView: Show HTML"],
  [9, "WebView: Navigate"],
  [10, "WebView: Post Message"],
  [11, "WebView: Evaluate"],
  [12, "WebView: Hide"],
  [99, "Quit Demo"],
]);

interface WebviewShowCommand {
  type: "show";
  html?: string;
  url?: string;
  width?: number;
  height?: number;
  fallbackRect?: Rect;
}

export const runDaemonTraySmoke = async (): Promise<void> => {
  const connection = await connectLocalBroker();
  const client = createClient(connection, { requestIdPrefix: "daemon-smoke" });
  console.log(`connected: endpoint=${connection.endpoint} lease=${connection.leaseId}`);

  const surface = await client.createSurface({
    appId: "com.example.opentray.daemon-smoke",
    title: "OpenTray Daemon Smoke",
    default: true,
  });
  console.log(`surface: ${JSON.stringify(surface.surface)}`);

  const tray = await surface.createTray({
    trayId: "daemon-smoke-status",
    title: "OpenTray",
    tooltip: {
      title: "OpenTray",
      description: "npm-installed daemon smoke with broker-routed menu events",
    },
    icon: createVisibleIcon(),
    menu: {
      items: [
        { type: "item", id: 1, title: "Primary Action" },
        { type: "item", id: 2, title: "Disabled Action", enabled: false },
        { type: "check", id: 3, title: "Checked Capability", checked: true },
        { type: "radio", id: 4, title: "Radio: Active", group: 1, checked: true },
        { type: "radio", id: 5, title: "Radio: Passive", group: 1 },
        { type: "separator" },
        {
          type: "submenu",
          title: "Nested Actions",
          items: [
            { type: "item", id: 6, title: "Nested Action" },
            { type: "check", id: 7, title: "Nested Check", checked: false },
          ],
        },
        {
          type: "submenu",
          title: "WebView Commands",
          items: [
            { type: "item", id: 8, title: "Show HTML" },
            { type: "item", id: 9, title: "Navigate" },
            { type: "item", id: 10, title: "Post Message" },
            { type: "item", id: 11, title: "Evaluate JS" },
            { type: "item", id: 12, title: "Hide" },
          ],
        },
        { type: "separator" },
        { type: "item", id: 99, title: "Quit Demo" },
      ],
    },
  });
  console.log(`tray: ${tray.trayId}`);

  await connection.request({
    type: "load-ext",
    requestId: "daemon-smoke-load-webview",
    surfaceId: surface.surface.surfaceId,
    name: "webview",
    path: "@opentray/ext-webview",
  });
  console.log("webview extension requested through the generic load-ext path");
  console.log("open the system tray item and choose any enabled menu item to see routed events");

  let closed = false;
  let messageCount = 0;
  let evalCount = 0;
  let exitTimer: NodeJS.Timeout | undefined;

  const shutdown = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    if (exitTimer !== undefined) {
      clearTimeout(exitTimer);
    }
    await connection.close();
  };

  const commandWebview = async (command: WebviewShowCommand | Record<string, unknown>): Promise<void> => {
    await tray.commandExtension("webview", command);
  };

  const handleMenuClick = async (itemId: number): Promise<void> => {
    if (itemId === 99) {
      console.log("quit item routed; closing smoke connection");
      await shutdown();
      return;
    }

    if (itemId < 8 || itemId > 12) {
      return;
    }

    switch (itemId) {
      case 8:
        await commandWebview({
          type: "show",
          html: createWebviewDemoHtml(),
          width: 420,
          height: 260,
          fallbackRect: { x: 0, y: 0, width: 1, height: 1 },
        });
        console.log("webview command: show");
        break;
      case 9:
        await commandWebview({ type: "navigate", url: "https://example.com/opentray-status" });
        console.log("webview command: navigate");
        break;
      case 10:
        messageCount += 1;
        await commandWebview({
          type: "postMessage",
          payload: {
            kind: "ping",
            source: "opentray smoke daemon-tray",
            count: messageCount,
            sentAt: new Date().toISOString(),
          },
        });
        console.log("webview command: postMessage");
        break;
      case 11:
        evalCount += 1;
        await commandWebview({ type: "evaluate", js: createVisibleEvaluateScript(evalCount) });
        console.log("webview command: evaluate");
        break;
      case 12:
        await commandWebview({ type: "hide" });
        console.log("webview command: hide");
        break;
    }
  };

  connection.onEvent((frame) => {
    console.log(`broker -> client ${JSON.stringify(frame)}`);
    if (frame.type === "event" && frame.event.type === "menuClick") {
      console.log(`menu click: ${menuLabels.get(frame.event.itemId) ?? frame.event.itemId}`);
      void handleMenuClick(frame.event.itemId);
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
  try {
    if (webviewSmoke === "show") {
      await handleMenuClick(8);
    } else if (webviewSmoke === "1") {
      if (exitTimer !== undefined) {
        clearTimeout(exitTimer);
        exitTimer = undefined;
      }
      for (const itemId of [8, 10, 11, 9, 12]) {
        await handleMenuClick(itemId);
      }
      await sleep(300);
      await shutdown();
    }
  } catch (error) {
    await shutdown();
    throw error;
  }
};

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
      }
    </style>
  </head>
  <body>
    <main>
      <h1>OpenTray WebView</h1>
      <p>Use the tray menu to mutate this native WebView through extension commands.</p>
      <section>
        <div class="card">
          <div class="label">postMessage</div>
          <code id="message-status">Waiting for WebView Commands -> Post Message</code>
        </div>
        <div class="card">
          <div class="label">evaluate JS</div>
          <code id="eval-status">Waiting for WebView Commands -> Evaluate JS</code>
        </div>
      </section>
    </main>
    <script>
      window.addEventListener("message", (event) => {
        const target = document.getElementById("message-status");
        if (target) {
          target.textContent = JSON.stringify(event.data, null, 2);
        }
      });
    </script>
  </body>
</html>`;
}

function createVisibleEvaluateScript(count: number): string {
  return `(() => {
    let target = document.getElementById("eval-status");
    if (!target) {
      const panel = document.createElement("div");
      panel.style.cssText = "position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483647;padding:12px;border-radius:12px;background:#fff8e7;color:#18220f;box-shadow:0 12px 30px rgba(0,0,0,.18);font:14px ui-rounded, sans-serif;";
      panel.textContent = "OpenTray Evaluate JS: ";
      target = document.createElement("code");
      target.id = "eval-status";
      panel.appendChild(target);
      document.body.appendChild(panel);
    }
    if (target) {
      target.textContent = "Evaluate JS updated the WebView, count=${count}, at " + new Date().toLocaleTimeString();
    }
    window.__OPENTRAY_DEMO__ = { evaluated: true, count: ${count} };
  })();`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
