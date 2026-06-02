import { describe, expect, it } from "vitest";

import {
  createBrokerEndpointIdentity,
  formatBrokerEndpointName,
  formatBrokerStateRoot,
  formatUnixSocketPath,
  formatWindowsPipeName,
  isSupportedProtocolVersion,
  parseServerFrame,
  PROTOCOL_VERSION,
  type ClientFrame,
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

  it("formats endpoint identity with package and protocol versions", () => {
    const identity = createBrokerEndpointIdentity({ packageVersion: "0.1.0" });

    expect(formatBrokerEndpointName(identity)).toBe("opentray-0.1.0-p1");
    expect(formatBrokerStateRoot("/Users/example", identity)).toBe("/Users/example/.opentray/0.1.0");
    expect(formatUnixSocketPath("/Users/example", identity)).toBe(
      "/Users/example/.opentray/0.1.0/opentray-p1.sock",
    );
    expect(formatWindowsPipeName(identity)).toBe("\\\\.\\pipe\\opentray-0.1.0-p1");
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
