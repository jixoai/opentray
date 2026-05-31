import type { ClientFrame } from "@opentray/spec";

import { createClient, type OpenTrayTransport } from "../src/index";

class RecordingTransport implements OpenTrayTransport {
  readonly frames: ClientFrame[] = [];

  async send(frame: ClientFrame): Promise<void> {
    this.frames.push(frame);
    console.log(`client -> broker ${JSON.stringify(frame)}`);
  }
}

const transport = new RecordingTransport();
const client = createClient(transport);

const surface = await client.createSurface({
  appId: "com.example.opentray",
  title: "OpenTray Example",
  default: true,
});

const tray = await surface.createTray({
  trayId: "build-status",
  title: "Build Status",
  tooltip: {
    title: "OpenTray",
    description: "Protocol-only human example",
  },
  icon: {
    type: "rgba",
    width: 1,
    height: 1,
    data: [20, 120, 80, 255],
  },
  menu: {
    items: [
      { type: "item", id: 1, title: "Open Dashboard" },
      { type: "separator" },
      { type: "item", id: 2, title: "Quit" },
    ],
  },
});

await tray.commandExtension("example-status", {
  type: "refresh",
  source: "examples/basic-surface.ts",
});
await tray.destroy();

console.log(`recorded protocol frames: ${transport.frames.length}`);
