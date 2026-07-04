import {
  createClient,
  createInitFrame,
  type ClientRequestFrame,
  type OpenTrayTransport,
  type ServerFrame,
} from "../src/index";

class RecordingTransport implements OpenTrayTransport {
  readonly frames: ClientRequestFrame[] = [];

  async request(frame: ClientRequestFrame): Promise<ServerFrame> {
    this.frames.push(frame);
    console.log(`client -> runtime ${JSON.stringify(frame)}`);
    switch (frame.type) {
      case "create-tray":
        return {
          type: "tray-created",
          requestId: frame.requestId,
          appId: "app-recorded",
          trayId: frame.tray.id,
        };
      case "get-tray-bounds":
        return {
          type: "tray-bounds",
          requestId: frame.requestId,
          appId: "app-recorded",
          trayId: frame.trayId,
          bounds: {
            kind: "unavailable",
            source: "backend.unavailable",
            rect: null,
          },
        };
      case "destroy-tray":
      case "set-tray-menu":
      case "set-tray-icon":
      case "set-tray-tooltip":
      case "load-ext":
      case "ext-command":
      case "unload-ext":
        return { type: "ack", requestId: frame.requestId };
      case "resolve-default-app":
        return {
          type: "default-app",
          requestId: frame.requestId,
          app: { appId: "app-recorded" },
        };
      case "health":
        return {
          type: "runtime-host-health",
          requestId: frame.requestId,
          health: {
            pid: process.pid,
            endpoint: "recorded",
            packageVersion: "0.1.0",
            protocolVersion: 1,
            appId: "com.example.opentray",
            appName: "OpenTray Example",
            callerLabel: "recorded",
            sessionCount: 0,
            sessions: [],
          },
        };
      default:
        return {
          type: "error",
          requestId: frame.requestId,
          code: "unsupported",
          message: frame.type,
        };
    }
  }
}

const transport = new RecordingTransport();
console.log(`client -> runtime ${JSON.stringify(createInitFrame("0.1.0"))}`);

const client = createClient(transport);

const tray = await client.createTray({
  id: "com.example.opentray",
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
  source: "examples/basic-tray.ts",
});
await tray.destroy();

console.log(`recorded protocol frames: ${transport.frames.length}`);
