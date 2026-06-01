import { describe, expect, it } from "vitest";

import {
  createBrokerEndpointIdentity,
  createInitFrame,
  createClient,
  createTrayHandle,
  formatBrokerEndpointName,
  PROTOCOL_VERSION,
  type OpenTrayTransport,
} from "./index";
import type { ClientRequestFrame, ServerFrame } from "@opentray/spec";

describe("opentray client", () => {
  it("routes extension commands through public protocol", async () => {
    const transport = new RecordingTransport();
    const tray = createTrayHandle(
      transport,
      { surfaceId: "surface-1", appId: "host" },
      "tray-1",
      createTestRequestId,
    );

    await tray.commandExtension("webview", { type: "show", width: 320, height: 240 });

    expect(transport.frames).toEqual([
      {
        type: "ext-command",
        requestId: "req-test",
        surfaceId: "surface-1",
        trayId: "tray-1",
        ext: "webview",
        data: { type: "show", width: 320, height: 240 },
      },
    ]);
  });

  it("creates explicit protocol handshake frames", () => {
    expect(createInitFrame("0.1.0")).toEqual({
      type: "init",
      protocolVersion: PROTOCOL_VERSION,
      clientVersion: "0.1.0",
    });
  });

  it("resolves broker-created surface and tray identities", async () => {
    const transport = new RecordingTransport();
    const client = createClient(transport, { requestIdPrefix: "test" });

    const surface = await client.createSurface({
      appId: "com.example.opentray",
      title: "Example",
      default: true,
    });
    const tray = await surface.createTray({
      trayId: "status",
      title: "Status",
      icon: { type: "rgba", data: [0, 0, 0, 0], width: 1, height: 1 },
    });

    expect(surface.surface).toEqual({ surfaceId: "surface-from-broker", appId: "com.example.opentray" });
    expect(tray.trayId).toBe("status");
    expect(transport.frames.map((frame) => frame.requestId)).toEqual(["test-1", "test-2"]);
  });

  it("exposes versioned broker endpoint identity helpers", () => {
    const identity = createBrokerEndpointIdentity({ packageVersion: "0.1.0" });

    expect(formatBrokerEndpointName(identity)).toBe("opentray-0.1.0-p1");
  });
});

class RecordingTransport implements OpenTrayTransport {
  readonly frames: ClientRequestFrame[] = [];

  async request(frame: ClientRequestFrame): Promise<ServerFrame> {
    this.frames.push(frame);
    switch (frame.type) {
      case "create-surface":
        return {
          type: "surface-created",
          requestId: frame.requestId,
          surface: {
            surfaceId: "surface-from-broker",
            appId: frame.appId,
          },
        };
      case "create-tray":
        return {
          type: "tray-created",
          requestId: frame.requestId,
          surfaceId: frame.surface.surfaceId,
          trayId: frame.tray.trayId ?? "tray-from-broker",
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

const createTestRequestId = (): string => "req-test";
