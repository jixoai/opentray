import { describe, expect, it } from "vitest";

import {
  createBrokerEndpointIdentity,
  createInitFrame,
  createClient,
  createTrayHandle,
  formatBrokerEndpointName,
  PROTOCOL_VERSION,
  type OpenTrayTransport,
  type OpenTrayConnection,
  type OpenTrayEventFrame,
} from "./index";
import type { ClientRequestFrame, ServerFrame } from "@opentray/spec";

describe("opentray client", () => {
  it("routes extension commands through public protocol", async () => {
    const transport = new RecordingTransport();
    const tray = createTrayHandle(
      transport,
      "app-1",
      "tray-1",
      createTestRequestId
    );

    await tray.commandExtension("webview", {
      type: "show",
      width: 320,
      height: 240,
    });

    expect(transport.frames).toEqual([
      {
        type: "ext-command",
        requestId: "req-test",
        appId: "app-1",
        trayId: "tray-1",
        ext: "webview",
        data: { type: "show", width: 320, height: 240 },
      },
    ]);
  });

  it("passes app and tray identity into extension context", () => {
    const transport = new RecordingTransport();
    const tray = createTrayHandle(
      transport,
      "app-1",
      "tray-1",
      createTestRequestId
    );

    const extended = tray.extend({
      name: "identity",
      path: "@example/identity",
      extend(_tray, context) {
        return {
          appId: context.appId,
          trayId: context.trayId,
          mountId: context.mountId,
        };
      },
    });

    expect(extended.appId).toBe("app-1");
    expect(extended.trayId).toBe("tray-1");
    expect(extended.mountId).toBe("identity.tray-1.1");
  });

  it("queries tray bounds through the runtime-bound tray handle", async () => {
    const transport = new RecordingTransport();
    const tray = createTrayHandle(
      transport,
      "app-1",
      "tray-1",
      createTestRequestId
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
        appId: "app-1",
        trayId: "tray-1",
      },
    ]);
  });

  it("updates tray state through tray-scoped protocol requests", async () => {
    const transport = new RecordingTransport();
    const tray = createTrayHandle(
      transport,
      "app-1",
      "tray-1",
      createTestRequestId
    );

    await tray.setMenu({ items: [{ type: "item", id: 1, title: "Open" }] });
    await tray.setTooltip({ title: "Focus", description: "25 minutes" });
    await tray.setIcon({
      type: "rgba",
      data: [0, 0, 0, 0],
      width: 1,
      height: 1,
    });

    expect(transport.frames).toEqual([
      {
        type: "set-tray-menu",
        requestId: "req-test",
        appId: "app-1",
        trayId: "tray-1",
        menu: { items: [{ type: "item", id: 1, title: "Open" }] },
      },
      {
        type: "set-tray-tooltip",
        requestId: "req-test",
        appId: "app-1",
        trayId: "tray-1",
        tooltip: { title: "Focus", description: "25 minutes" },
      },
      {
        type: "set-tray-icon",
        requestId: "req-test",
        appId: "app-1",
        trayId: "tray-1",
        icon: { type: "rgba", data: [0, 0, 0, 0], width: 1, height: 1 },
      },
    ]);
  });

  it("exposes tray-scoped events only for eventful broker connections", () => {
    const transport = new EventfulRecordingTransport();
    const tray = createTrayHandle(
      transport,
      "app-1",
      "tray-1",
      createTestRequestId
    );
    const seen: string[] = [];

    const unsubscribeMenu = tray.onMenuClick((event) => {
      seen.push(`menu:${event.itemId}`);
    });
    const unsubscribeClick = tray.onTrayClick((event) => {
      seen.push(`click:${event.x},${event.y}`);
    });

    transport.emit({
      type: "event",
      event: { type: "menuClick", appId: "app-1", trayId: "other", itemId: 1 },
    });
    transport.emit({
      type: "event",
      event: { type: "menuClick", appId: "app-1", trayId: "tray-1", itemId: 2 },
    });
    transport.emit({
      type: "event",
      event: {
        type: "trayClick",
        appId: "app-1",
        trayId: "tray-1",
        button: "left",
        x: 4,
        y: 8,
      },
    });
    transport.emit({
      type: "ext-event",
      appId: "app-1",
      trayId: "tray-1",
      ext: "webview",
      data: {},
    });

    unsubscribeMenu();
    unsubscribeClick();
    transport.emit({
      type: "event",
      event: { type: "menuClick", appId: "app-1", trayId: "tray-1", itemId: 3 },
    });

    expect(seen).toEqual(["menu:2", "click:4,8"]);
  });

  it("creates explicit protocol handshake frames", () => {
    expect(createInitFrame("0.1.0")).toEqual({
      type: "init",
      protocolVersion: PROTOCOL_VERSION,
      clientVersion: "0.1.0",
    });
  });

  it("resolves broker-created app and tray identities", async () => {
    const transport = new RecordingTransport();
    const client = createClient(transport, { requestIdPrefix: "test" });

    const tray = await client.createTray({
      id: "status",
      icon: { type: "rgba", data: [0, 0, 0, 0], width: 1, height: 1 },
    });

    expect(tray.trayId).toBe("status");
    expect(transport.frames.map((frame) => frame.requestId)).toEqual([
      "test-1",
      "test-2",
    ]);
  });

  it("creates a tray through the client default app lookup", async () => {
    const transport = new RecordingTransport();
    const client = createClient(transport, { requestIdPrefix: "alias" });

    const tray = await client.createTray({ id: "legacy" });

    expect(tray.trayId).toBe("legacy");
    expect(transport.frames).toEqual([
      { type: "resolve-default-app", requestId: "alias-1" },
      {
        type: "create-tray",
        requestId: "alias-2",
        app: { appId: "app-default" },
        tray: { id: "legacy" },
      },
    ]);
  });

  it("exposes versioned broker endpoint identity helpers", () => {
    const identity = createBrokerEndpointIdentity({ packageVersion: "0.1.0" });

    expect(formatBrokerEndpointName(identity)).toBe(
      "opentray-0.1.0-p1-opentray"
    );
  });
});

class RecordingTransport implements OpenTrayTransport {
  readonly frames: ClientRequestFrame[] = [];

  async request(frame: ClientRequestFrame): Promise<ServerFrame> {
    this.frames.push(frame);
    switch (frame.type) {
      case "create-tray":
        return {
          type: "tray-created",
          requestId: frame.requestId,
          appId: frame.app.appId,
          trayId: frame.tray.id,
        };
      case "resolve-default-app":
        return {
          type: "default-app",
          requestId: frame.requestId,
          app: {
            appId: "app-default",
          },
        };
      case "destroy-tray":
        return { type: "ack", requestId: frame.requestId };
      case "get-tray-bounds":
        return {
          type: "tray-bounds",
          requestId: frame.requestId,
          appId: frame.appId,
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
          type: "runtime-host-health",
          requestId: frame.requestId,
          health: {
            pid: 12345,
            endpoint: "recorded",
            packageVersion: "0.1.0",
            protocolVersion: PROTOCOL_VERSION,
            appId: "com.example.test-runtime",
            appName: "Test Runtime",
            callerLabel: "test-runtime",
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

class EventfulRecordingTransport
  extends RecordingTransport
  implements OpenTrayConnection
{
  private readonly listeners = new Set<(frame: OpenTrayEventFrame) => void>();

  onEvent(listener: (frame: OpenTrayEventFrame) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(frame: OpenTrayEventFrame): void {
    for (const listener of this.listeners) {
      listener(frame);
    }
  }
}

const createTestRequestId = (): string => "req-test";
