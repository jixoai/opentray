import type { ClientRequestFrame, ServerFrame } from "@opentray/spec";
import { createTrayHandle, type OpenTrayTransport } from "../../cli/src/index";

import { WebviewExt } from "../src/index";

class RecordingTransport implements OpenTrayTransport {
  readonly frames: ClientRequestFrame[] = [];

  async request(frame: ClientRequestFrame): Promise<ServerFrame> {
    this.frames.push(frame);
    console.log(`webview -> extension host ${JSON.stringify(frame)}`);
    return { type: "ack", requestId: frame.requestId };
  }
}

const transport = new RecordingTransport();
const tray = createTrayHandle(
  transport,
  {
    spaceId: "example-space",
  },
  "webview-tray",
).extend(WebviewExt, { mountId: "webview.example" });
const webview = tray.createWebviewWindow({
  html: "<main><h1>OpenTray WebView</h1><p>Extension atom example.</p></main>",
  width: 360,
  height: 220,
  title: "OpenTray WebView Example",
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
  nativeWindowApi: true,
  bindWindowGlobals: true,
  nativeScreenApi: true,
  bindScreenGlobals: true,
  titleSync: {
    documentToWindow: true,
    windowToDocument: true,
  },
  iconSync: true,
  nativeApiPolicy: {
    defaultSrc: ["'local'"],
    window: ["https://example.com"],
    screen: ["https://example.com"],
    titleSync: ["https://example.com"],
    iconSync: ["https://example.com"],
  },
  fallbackRect: {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  },
});

await webview.show();
await webview.navigate("https://example.com/status");
await webview.postMessage({
  kind: "ping",
  source: "examples/webview-command.ts",
});
await webview.hide();

console.log(`webview extension frames: ${transport.frames.length}`);
