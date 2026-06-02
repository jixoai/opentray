import type { ClientRequestFrame, ServerFrame } from "@opentray/spec";
import { createTrayHandle, type OpenTrayTransport } from "../../cli/src/index";

import { attachWebview } from "../src/index";

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
);
const webview = attachWebview(tray);

await webview.show({
  type: "show",
  html: "<main><h1>OpenTray WebView</h1><p>Extension atom example.</p></main>",
  width: 360,
  height: 220,
  nativeWindowApi: true,
  bindWindowGlobals: true,
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
