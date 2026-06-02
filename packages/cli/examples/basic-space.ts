import type { ClientRequestFrame, ServerFrame } from "@opentray/spec";

import { createClient, createInitFrame, type OpenTrayTransport } from "../src/index";

class RecordingTransport implements OpenTrayTransport {
  readonly frames: ClientRequestFrame[] = [];

  async request(frame: ClientRequestFrame): Promise<ServerFrame> {
    this.frames.push(frame);
    console.log(`client -> broker ${JSON.stringify(frame)}`);
    switch (frame.type) {
      case "create-space":
        return {
          type: "space-created",
          requestId: frame.requestId,
          space: {
            spaceId: `recorded:${frame.id ?? "default"}`,
          },
        };
      case "create-tray":
        return {
          type: "tray-created",
          requestId: frame.requestId,
          spaceId: frame.space.spaceId,
          trayId: frame.tray.trayId ?? "recorded-tray",
        };
      case "destroy-tray":
      case "set-tray-menu":
      case "set-tray-icon":
      case "set-tray-tooltip":
      case "load-ext":
      case "ext-command":
      case "unload-ext":
      case "resolve-default-space":
        return { type: "ack", requestId: frame.requestId };
      case "health":
        return {
          type: "daemon-health",
          requestId: frame.requestId,
          health: {
            pid: process.pid,
            endpoint: "recorded",
            packageVersion: "0.1.0",
            protocolVersion: 1,
            sessionCount: 0,
            sessions: [],
          },
        };
    }
  }
}

const transport = new RecordingTransport();
console.log(`client -> broker ${JSON.stringify(createInitFrame("0.1.0"))}`);

const client = createClient(transport);

const space = await client.createSpace({
  id: "com.example.opentray",
  title: "OpenTray Example",
  default: true,
});

const tray = await space.createTray({
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
  source: "examples/basic-space.ts",
});
await tray.destroy();

console.log(`recorded protocol frames: ${transport.frames.length}`);
