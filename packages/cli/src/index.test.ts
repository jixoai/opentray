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
      { spaceId: "space-1" },
      "tray-1",
      createTestRequestId,
    );

    await tray.commandExtension("webview", { type: "show", width: 320, height: 240 });

    expect(transport.frames).toEqual([
      {
        type: "ext-command",
        requestId: "req-test",
        spaceId: "space-1",
        trayId: "tray-1",
        ext: "webview",
        data: { type: "show", width: 320, height: 240 },
      },
    ]);
  });

  it("queries tray bounds through the broker-backed tray handle", async () => {
    const transport = new RecordingTransport();
    const tray = createTrayHandle(
      transport,
      { spaceId: "space-1" },
      "tray-1",
      createTestRequestId,
    );

    const bounds = await tray.getBounds();

    expect(bounds).toEqual({
      kind: "native",
      source: "backend.nativeTrayBounds",
      rect: { x: 10, y: 20, width: 24, height: 24 },
    });
    expect(transport.frames).toEqual([
      {
        type: "get-tray-bounds",
        requestId: "req-test",
        spaceId: "space-1",
        trayId: "tray-1",
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

  it("resolves broker-created space and tray identities", async () => {
    const transport = new RecordingTransport();
    const client = createClient(transport, { requestIdPrefix: "test" });

    const space = await client.createSpace({
      id: "com.example.opentray",
      title: "Example",
      default: true,
    });
    const tray = await space.createTray({
      trayId: "status",
      title: "Status",
      icon: { type: "rgba", data: [0, 0, 0, 0], width: 1, height: 1 },
    });

    expect(space.space).toEqual({ spaceId: "space-from-broker" });
    expect(tray.trayId).toBe("status");
    expect(transport.frames.map((frame) => frame.requestId)).toEqual(["test-1", "test-2"]);
  });

  it("keeps createSurface as a deprecated alias", async () => {
    const transport = new RecordingTransport();
    const client = createClient(transport, { requestIdPrefix: "alias" });

    const space = await client.createSurface({ id: "legacy" });

    expect(space.space).toEqual({ spaceId: "space-from-broker" });
    expect(transport.frames[0]).toEqual({ type: "create-space", requestId: "alias-1", id: "legacy" });
  });

  it("resolves the broker default space through the client", async () => {
    const transport = new RecordingTransport();
    const client = createClient(transport, { requestIdPrefix: "default" });

    const space = await client.resolveDefaultSpace();

    expect(space.space).toEqual({ spaceId: "space-default" });
    expect(transport.frames[0]).toEqual({ type: "resolve-default-space", requestId: "default-1" });
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
      case "create-space":
        return {
          type: "space-created",
          requestId: frame.requestId,
          space: {
            spaceId: "space-from-broker",
          },
        };
      case "create-tray":
        return {
          type: "tray-created",
          requestId: frame.requestId,
          spaceId: frame.space.spaceId,
          trayId: frame.tray.trayId ?? "tray-from-broker",
        };
      case "resolve-default-space":
        return {
          type: "default-space",
          requestId: frame.requestId,
          space: {
            spaceId: "space-default",
          },
        };
      case "destroy-tray":
      case "get-tray-bounds":
        return {
          type: "tray-bounds",
          requestId: frame.requestId,
          spaceId: frame.spaceId,
          trayId: frame.trayId,
          bounds: {
            kind: "native",
            source: "backend.nativeTrayBounds",
            rect: { x: 10, y: 20, width: 24, height: 24 },
          },
        };
      case "set-tray-menu":
      case "set-tray-icon":
      case "set-tray-tooltip":
      case "load-ext":
      case "ext-command":
      case "unload-ext":
        return { type: "ack", requestId: frame.requestId };
      case "health":
        return {
          type: "daemon-health",
          requestId: frame.requestId,
          health: {
            pid: 12345,
            endpoint: "recorded",
            packageVersion: "0.1.0",
            protocolVersion: PROTOCOL_VERSION,
            sessionCount: 0,
            sessions: [],
          },
        };
    }
  }
}

const createTestRequestId = (): string => "req-test";
