import { createClient } from "../src/index";
import { connectLocalBroker } from "../src/node";
import { attachWebview } from "../../ext-webview/src/index";

const connection = await connectLocalBroker();
const client = createClient(connection, { requestIdPrefix: "daemon-example" });
console.log(`connected: endpoint=${connection.endpoint} lease=${connection.leaseId}`);

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
let webview: ReturnType<typeof attachWebview> | undefined;

connection.onEvent((frame) => {
  console.log(`broker -> client ${JSON.stringify(frame)}`);
  if (frame.type === "event" && frame.event.type === "menuClick") {
    console.log(`menu click: ${menuLabels.get(frame.event.itemId) ?? frame.event.itemId}`);
    void handleMenuClick(frame.event.itemId);
  }
});

const surface = await client.createSurface({
  appId: "com.example.opentray.daemon",
  title: "OpenTray Daemon Example",
  default: true,
});
console.log(`surface: ${JSON.stringify(surface.surface)}`);

const tray = await surface.createTray({
  trayId: "daemon-status",
  title: "OpenTray",
  tooltip: {
    title: "OpenTray",
    description: "Daemon-created tray with broker-routed menu events",
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
  requestId: "daemon-example-load-webview",
  surfaceId: surface.surface.surfaceId,
  name: "webview",
  path: "@opentray/ext-webview",
});
webview = attachWebview(tray);
console.log("webview facade attached to the daemon native WebView extension");
console.log("open the system tray item and choose any enabled menu item to see routed events");

const exitAfter = process.env.OPENTRAY_EXAMPLE_EXIT_AFTER_MS;
let exitTimer: NodeJS.Timeout | undefined;
if (exitAfter !== undefined && exitAfter.length > 0) {
  const duration = Number.parseInt(exitAfter, 10);
  if (Number.isInteger(duration) && duration > 0) {
    exitTimer = setTimeout(() => {
      void shutdown();
    }, duration);
  }
}

const webviewSmoke = process.env.OPENTRAY_EXAMPLE_WEBVIEW_SMOKE;
if (webviewSmoke === "show") {
  await handleMenuClick(8);
} else if (webviewSmoke === "1") {
  for (const itemId of [8, 9, 10, 11, 12]) {
    await handleMenuClick(itemId);
  }
}

let closed = false;
async function shutdown(): Promise<void> {
  if (closed) {
    return;
  }
  closed = true;
  if (exitTimer !== undefined) {
    clearTimeout(exitTimer);
  }
  await connection.close();
}

async function handleMenuClick(itemId: number): Promise<void> {
  if (itemId === 99) {
    console.log("quit item routed; closing demo connection");
    await shutdown();
    return;
  }

  if (itemId < 8 || itemId > 12) {
    return;
  }

  if (webview === undefined) {
    console.error("webview facade is not ready");
    return;
  }

  switch (itemId) {
    case 8:
      await webview.show({
        type: "show",
        html: "<main><h1>OpenTray WebView</h1><p>Daemon demo command.</p></main>",
        width: 420,
        height: 260,
        fallbackRect: { x: 0, y: 0, width: 1, height: 1 },
      });
      console.log("webview command: show");
      break;
    case 9:
      await webview.navigate("https://example.com/opentray-status");
      console.log("webview command: navigate");
      break;
    case 10:
      await webview.postMessage({ kind: "ping", source: "daemon-tray" });
      console.log("webview command: postMessage");
      break;
    case 11:
      await webview.evaluate("window.__OPENTRAY_DEMO__ = true");
      console.log("webview command: evaluate");
      break;
    case 12:
      await webview.hide();
      console.log("webview command: hide");
      break;
  }
}

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
