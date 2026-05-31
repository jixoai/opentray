import type { ClientFrame } from "@opentray/spec";
import { createTrayHandle, type OpenTrayTransport } from "../../cli/src/index";

import { attachWebview } from "../src/index";

class RecordingTransport implements OpenTrayTransport {
  readonly frames: ClientFrame[] = [];

  async send(frame: ClientFrame): Promise<void> {
    this.frames.push(frame);
    console.log(`webview -> extension host ${JSON.stringify(frame)}`);
  }
}

const transport = new RecordingTransport();
const tray = createTrayHandle(
  transport,
  {
    surfaceId: "example-surface",
    appId: "com.example.opentray",
  },
  "webview-tray",
);
const webview = attachWebview(tray);

await webview.show({
  type: "show",
  html: "<main><h1>OpenTray WebView</h1><p>Extension atom example.</p></main>",
  width: 360,
  height: 220,
  fallbackRect: {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  },
});
await webview.navigate("https://example.com/status");
await webview.postMessage({
  kind: "ping",
  source: "examples/webview-command.ts",
});
await webview.hide();

console.log(`webview extension frames: ${transport.frames.length}`);
