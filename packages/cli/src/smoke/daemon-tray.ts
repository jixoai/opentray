import type { Rect } from "@opentray/spec";

import { createClient } from "../client";
import { connectLocalBroker } from "../local-broker";

const menuLabels = new Map<number, string>([
  [1, "Open WebView"],
]);

interface WebviewShowCommand {
  type: "show";
  html?: string;
  url?: string;
  width?: number;
  height?: number;
  fallbackRect?: Rect;
  nativeWindowApi?: boolean;
  bindWindowGlobals?: boolean;
  nativeScreenApi?: boolean;
  bindScreenGlobals?: boolean;
  nativeTrayApi?: boolean;
  title?: string;
  icon?: { type: "href"; href: string };
  style?: {
    frameless?: boolean;
    transparent?: boolean;
    keepOnTop?: boolean;
    platform?: {
      macos?: {
        material?: string | null;
        materialState?: "followsWindowActiveState" | "active" | "inactive";
        cornerRadius?: number | null;
      };
    };
  };
  titleSync?: boolean | { documentToWindow?: boolean; windowToDocument?: boolean };
  iconSync?: boolean | { faviconToWindow?: boolean; windowToFavicon?: boolean };
  nativeApiPolicy?: {
    defaultSrc?: string[];
    window?: string[];
    screen?: string[];
    tray?: string[];
    windowGlobals?: string[];
    screenGlobals?: string[];
    titleSync?: string[];
    iconSync?: string[];
  };
}

export const runDaemonTraySmoke = async (): Promise<void> => {
  const connection = await connectLocalBroker();
  const client = createClient(connection, { requestIdPrefix: "daemon-smoke" });
  console.log(`connected: endpoint=${connection.endpoint} session=${connection.sessionId}`);

  const space = await client.createSpace({
    id: "com.example.opentray.daemon-smoke",
    title: "OpenTray Daemon Smoke",
    default: true,
  });
  console.log(`space: ${JSON.stringify(space.space)}`);

  const tray = await space.createTray({
    trayId: "daemon-smoke-status",
    title: "OpenTray",
    tooltip: {
      title: "OpenTray",
      description: "Single primary tray action; macOS direct-triggers without opening a menu",
    },
    icon: createVisibleIcon(),
    menu: {
      items: [
        { type: "item", id: 1, title: "Open WebView", primaryEvent: true },
      ],
    },
  });
  console.log(`tray: ${tray.trayId}`);

  await connection.request({
    type: "load-ext",
    requestId: "daemon-smoke-load-webview",
    spaceId: space.space.spaceId,
    name: "webview",
    path: "@opentray/ext-webview",
  });
  console.log("webview extension requested through the generic load-ext path");
  console.log("click the tray icon: macOS should direct-trigger the single primary action without opening a menu");

  let closed = false;
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
    if (itemId === 1) {
      const trayBounds = await tray.getBounds();
      console.log(`tray bounds: ${JSON.stringify(trayBounds)}`);
      await commandWebview({
        type: "show",
        html: createWebviewDemoHtml(),
        width: 420,
        height: 260,
        title: "OpenTray WebView Smoke",
        icon: {
          type: "href",
          href: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
        },
        style: {
          frameless: true,
          transparent: true,
          keepOnTop: true,
          platform: {
            macos: {
              material: "hudWindow",
              materialState: "active",
            },
          },
        },
        fallbackRect: trayBounds.rect ?? { x: 0, y: 0, width: 1, height: 1 },
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
          window: ["https://example.com"],
          screen: ["https://example.com"],
          tray: ["https://example.com"],
          titleSync: ["https://example.com"],
          iconSync: ["https://example.com"],
        },
      });
      console.log("primary tray action: webview show");
      return;
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
    if (webviewSmoke === "show" || webviewSmoke === "1") {
      await handleMenuClick(1);
    }
    if (webviewSmoke === "1") {
      if (exitTimer !== undefined) {
        clearTimeout(exitTimer);
        exitTimer = undefined;
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
      <p>This window was opened by the single primary tray action.</p>
      <section>
        <div class="card">
          <div class="label">primary event</div>
          <code>macOS single primary item direct-triggered menuClick -> WebView show</code>
        </div>
      </section>
    </main>
  </body>
</html>`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
