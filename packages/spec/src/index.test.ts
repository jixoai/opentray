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
      surfaceId: "surface-1",
      trayId: "tray-1",
      ext: "webview",
      data: { type: "show" },
    };

    expect(frame.ext).toBe("webview");
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

  it("requires lease metadata in ready frames", () => {
    const parsed = parseServerFrame(
      JSON.stringify({ type: "ready", protocolVersion: PROTOCOL_VERSION, brokerVersion: "0.1.0" }),
    );

    expect(parsed.ok).toBe(false);
  });

  it("checks protocol compatibility before lease authority exists", () => {
    const init: ClientFrame = {
      type: "init",
      protocolVersion: PROTOCOL_VERSION + 1,
      clientVersion: "0.2.0",
    };

    expect(isSupportedProtocolVersion(init.protocolVersion)).toBe(false);
  });

  it("parses request-correlated responses", () => {
    const parsed = parseServerFrame(
      JSON.stringify({
        type: "surface-created",
        requestId: "req-1",
        surface: { surfaceId: "surface-1", appId: "app" },
      }),
    );

    expect(parsed.ok).toBe(true);
    expect(parsed.frame).toEqual({
      type: "surface-created",
      requestId: "req-1",
      surface: { surfaceId: "surface-1", appId: "app" },
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
});
