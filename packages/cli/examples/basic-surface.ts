import type { ClientRequestFrame, ServerFrame } from "@opentray/spec";

import { createClient, createInitFrame, type OpenTrayTransport } from "../src/index";

class RecordingTransport implements OpenTrayTransport {
  readonly frames: ClientRequestFrame[] = [];

  async request(frame: ClientRequestFrame): Promise<ServerFrame> {
    this.frames.push(frame);
    console.log(`client -> broker ${JSON.stringify(frame)}`);
    switch (frame.type) {
      case "create-surface":
        return {
          type: "surface-created",
          requestId: frame.requestId,
          surface: {
            surfaceId: `recorded:${frame.appId}`,
            appId: frame.appId,
          },
        };
      case "create-tray":
        return {
          type: "tray-created",
          requestId: frame.requestId,
          surfaceId: frame.surface.surfaceId,
          trayId: frame.tray.trayId ?? "recorded-tray",
        };
      case "destroy-tray":
      case "set-tray-menu":
      case "set-tray-icon":
      case "set-tray-tooltip":
      case "load-ext":
      case "ext-command":
      case "unload-ext":
      case "resolve-default-surface":
        return { type: "ack", requestId: frame.requestId };
    }
  }
}

const transport = new RecordingTransport();
console.log(`client -> broker ${JSON.stringify(createInitFrame("0.1.0"))}`);

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
