import { describe, expect, it } from "vitest";

import {
  createBrokerEndpointIdentity,
  compareOpenTrayProtocolLine,
  formatBrokerEndpointName,
  formatOpenTrayProtocolLine,
  formatProtocolDistTag,
  formatBrokerStateRoot,
  formatUnixSocketPath,
  formatWindowsPipeName,
  isOpenTrayProtocolLineCompatible,
  isSupportedProtocolVersion,
  parseProtocolDistTag,
  OPENTRAY_PROTOCOL_FAMILY,
  OPENTRAY_PROTOCOL_LINE,
  parseServerFrame,
  PROTOCOL_VERSION,
  type ClientFrame,
  type Menu,
} from "./index";

describe("@opentray/spec", () => {
  it("does not throw on malformed protocol frames", () => {
    const parsed = parseServerFrame("{not-json");

    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBeTruthy();
  });

  it("keeps extension commands as typed protocol frames", () => {
    const frame: ClientFrame = {
      type: "ext-command",
      requestId: "req-1",
      spaceId: "space-1",
      trayId: "tray-1",
      ext: "webview",
      data: { type: "show" },
    };

    expect(frame.ext).toBe("webview");
  });

  it("keeps health checks as additive typed protocol frames", () => {
    const frame: ClientFrame = {
      type: "health",
      requestId: "req-health",
    };

    expect(frame.requestId).toBe("req-health");
  });

  it("accepts tray-bounds request and response frames", () => {
    const request: ClientFrame = {
      type: "get-tray-bounds",
      requestId: "req-bounds",
      spaceId: "space-1",
      trayId: "tray-1",
    };
    const parsed = parseServerFrame(
      JSON.stringify({
        type: "tray-bounds",
        requestId: "req-bounds",
        spaceId: "space-1",
        trayId: "tray-1",
        bounds: {
          kind: "native",
          source: "backend.nativeTrayBounds",
          rect: { x: 10, y: 20, width: 24, height: 24 },
        },
      }),
    );

    expect(request.trayId).toBe("tray-1");
    expect(parsed.ok).toBe(true);
    expect(parsed.frame).toEqual({
      type: "tray-bounds",
      requestId: "req-bounds",
      spaceId: "space-1",
      trayId: "tray-1",
      bounds: {
        kind: "native",
        source: "backend.nativeTrayBounds",
        rect: { x: 10, y: 20, width: 24, height: 24 },
      },
    });
  });

  it("accepts primary-event menu items without changing menuClick events", () => {
    const menu: Menu = {
      items: [{ type: "item", id: 8, title: "Show Window", primaryEvent: true }],
    };
    const parsed = parseServerFrame(
      JSON.stringify({
        type: "event",
        event: {
          type: "menuClick",
          spaceId: "space-1",
          trayId: "daemon-status",
          itemId: 8,
        },
      }),
    );

    expect(menu.items[0]).toEqual({
      type: "item",
      id: 8,
      title: "Show Window",
      primaryEvent: true,
    });
    expect(parsed.ok).toBe(true);
    expect(parsed.frame).toEqual({
      type: "event",
      event: {
        type: "menuClick",
        spaceId: "space-1",
        trayId: "daemon-status",
        itemId: 8,
      },
    });
  });

  it("formats endpoint identity with package and protocol versions", () => {
    const identity = createBrokerEndpointIdentity({ packageVersion: "0.1.0" });

    expect(formatBrokerEndpointName(identity)).toBe("opentray-0.1.0-p1");
    expect(formatBrokerStateRoot("/Users/example", identity)).toBe("/Users/example/.opentray/0.1.0");
    expect(formatUnixSocketPath("/Users/example", identity)).toBe(
      "/Users/example/.opentray/0.1.0/opentray-p1.sock",
    );
    expect(formatWindowsPipeName(identity)).toBe("\\\\.\\pipe\\opentray-0.1.0-p1");
  });

  it("formats extension-agnostic protocol-line dist-tags", () => {
    expect(OPENTRAY_PROTOCOL_FAMILY).toBe("opentray-protocol");
    expect(formatOpenTrayProtocolLine(OPENTRAY_PROTOCOL_LINE)).toBe("opentray-protocol/1.0");
    expect(
      formatOpenTrayProtocolLine({
        family: OPENTRAY_PROTOCOL_FAMILY,
        major: 1,
        minor: 2,
      }),
    ).toBe("opentray-protocol/1.2");
    expect(formatProtocolDistTag({ channel: "stable" })).toBe("stable-1-0");
    expect(formatProtocolDistTag({ channel: "alpha" })).toBe("alpha-1-0");
    expect(formatProtocolDistTag({ channel: "stable", major: 1, minor: 2 })).toBe("stable-1-2");
    expect(parseProtocolDistTag("stable-1-0")).toEqual({
      channel: "stable",
      major: 1,
      minor: 0,
    });
    expect(parseProtocolDistTag("alpha-1-2")).toEqual({
      channel: "alpha",
      major: 1,
      minor: 2,
    });
  });

  it("treats newer minor lines as backward-compatible within the same major", () => {
    const stable12 = { family: OPENTRAY_PROTOCOL_FAMILY, major: 1, minor: 2 } as const;
    const stable11 = { family: OPENTRAY_PROTOCOL_FAMILY, major: 1, minor: 1 } as const;
    const stable10 = { family: OPENTRAY_PROTOCOL_FAMILY, major: 1, minor: 0 } as const;
    const stable20 = { family: OPENTRAY_PROTOCOL_FAMILY, major: 2, minor: 0 } as const;

    expect(compareOpenTrayProtocolLine(stable12, stable11)).toBeGreaterThan(0);
    expect(compareOpenTrayProtocolLine(stable11, stable12)).toBeLessThan(0);
    expect(compareOpenTrayProtocolLine(stable12, stable12)).toBe(0);
    expect(isOpenTrayProtocolLineCompatible(stable12, stable11)).toBe(true);
    expect(isOpenTrayProtocolLineCompatible(stable12, stable10)).toBe(true);
    expect(isOpenTrayProtocolLineCompatible(stable10, stable12)).toBe(false);
    expect(isOpenTrayProtocolLineCompatible(stable20, stable12)).toBe(false);
  });

  it("rejects extension-specific protocol-line dist-tags", () => {
    expect(() => parseProtocolDistTag("stable-webview-1-0")).toThrow(
      "invalid OpenTray protocol dist-tag",
    );
    expect(() => parseProtocolDistTag("alpha-lynx-1-0")).toThrow(
      "invalid OpenTray protocol dist-tag",
    );
  });

  it("keeps runtime protocol version separate from install-time protocol tags", () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(formatProtocolDistTag({ channel: "stable" })).toBe("stable-1-0");
    expect(createBrokerEndpointIdentity({ packageVersion: "0.5.1" })).toEqual({
      packageVersion: "0.5.1",
      protocolVersion: 1,
    });
  });

  it("rejects ready frames without explicit protocol metadata", () => {
    const parsed = parseServerFrame(JSON.stringify({ type: "ready", version: PROTOCOL_VERSION }));

    expect(parsed.ok).toBe(false);
  });

  it("requires session metadata in ready frames", () => {
    const parsed = parseServerFrame(
      JSON.stringify({ type: "ready", protocolVersion: PROTOCOL_VERSION, brokerVersion: "0.1.0" }),
    );

    expect(parsed.ok).toBe(false);
  });

  it("checks protocol compatibility before session authority exists", () => {
    const init: ClientFrame = {
      type: "init",
      protocolVersion: PROTOCOL_VERSION + 1,
      clientVersion: "0.2.0",
    };

    expect(isSupportedProtocolVersion(init.protocolVersion)).toBe(false);
  });

  it("parses request-correlated responses", () => {
    const legacy = parseServerFrame(
      JSON.stringify({
        type: "surface-created",
        requestId: "req-legacy",
        surface: { surfaceId: "surface-legacy", appId: "app" },
      }),
    );

    expect(legacy.ok).toBe(false);

    const parsed = parseServerFrame(
      JSON.stringify({
        type: "space-created",
        requestId: "req-1",
        space: { spaceId: "space-1" },
      }),
    );

    expect(parsed.ok).toBe(true);
    expect(parsed.frame).toEqual({
      type: "space-created",
      requestId: "req-1",
      space: { spaceId: "space-1" },
    });
  });

  it("parses structured request errors", () => {
    const parsed = parseServerFrame(
      JSON.stringify({
        type: "error",
        requestId: "req-1",
        code: "not-initialized",
        message: "init required",
      }),
    );

    expect(parsed.ok).toBe(true);
  });

  it("parses daemon health responses", () => {
    const parsed = parseServerFrame(
      JSON.stringify({
        type: "daemon-health",
        requestId: "req-health",
        health: {
          pid: 12345,
          packageVersion: "0.1.0",
          protocolVersion: PROTOCOL_VERSION,
          endpoint: "/tmp/opentray.sock",
          sessionCount: 2,
          sessions: [
            { sessionId: 1, internalLeaseId: "lease-1", initialized: true },
            { sessionId: 2, initialized: false },
          ],
        },
      }),
    );

    expect(parsed.ok).toBe(true);
    expect(parsed.frame).toEqual({
      type: "daemon-health",
      requestId: "req-health",
      health: {
        pid: 12345,
        packageVersion: "0.1.0",
        protocolVersion: PROTOCOL_VERSION,
        endpoint: "/tmp/opentray.sock",
        sessionCount: 2,
        sessions: [
          { sessionId: 1, internalLeaseId: "lease-1", initialized: true },
          { sessionId: 2, initialized: false },
        ],
      },
    });
  });

  it("parses camelCase tray event frames", () => {
    const parsed = parseServerFrame(
      JSON.stringify({
        type: "event",
        event: {
          type: "menuClick",
          spaceId: "space-1",
          trayId: "daemon-status",
          itemId: 99,
        },
      }),
    );

    expect(parsed.ok).toBe(true);
    expect(parsed.frame).toEqual({
      type: "event",
      event: {
        type: "menuClick",
        spaceId: "space-1",
        trayId: "daemon-status",
        itemId: 99,
      },
    });
  });

  it("rejects snake_case tray event frames", () => {
    const parsed = parseServerFrame(
      JSON.stringify({
        type: "event",
        event: {
          type: "menuClick",
          surface_id: "surface-1",
          tray_id: "daemon-status",
          item_id: 99,
        },
      }),
    );

    expect(parsed.ok).toBe(false);
  });
});
