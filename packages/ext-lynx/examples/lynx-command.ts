import type { ClientRequestFrame, ServerFrame } from "@opentray/spec";
import { createTrayHandle, type OpenTrayTransport } from "../../cli/src/index";

import { attachLynx } from "../src/index";

class RecordingTransport implements OpenTrayTransport {
  readonly frames: ClientRequestFrame[] = [];

  async request(frame: ClientRequestFrame): Promise<ServerFrame> {
    this.frames.push(frame);
    console.log(`lynx -> extension host ${JSON.stringify(frame)}`);
    return { type: "ack", requestId: frame.requestId };
  }
}

const transport = new RecordingTransport();
const tray = createTrayHandle(
  transport,
  {
    spaceId: "example-space",
  },
  "lynx-tray"
);
const lynx = attachLynx(tray);

await lynx.show({
  type: "show",
  bundlePath: "/tmp/demo.main.lynx.bundle",
  fitContentSize: true,
  nativeWindowApi: true,
  bindWindowGlobals: true,
  nativeScreenApi: true,
  bindScreenGlobals: true,
  title: "OpenTray Lynx Example",
  icon: {
    type: "rgba",
    width: 1,
    height: 1,
    data: [15, 124, 109, 255],
  },
  minWidth: 320,
  minHeight: 220,
});
await lynx.hide();

console.log(`lynx extension frames: ${transport.frames.length}`);
