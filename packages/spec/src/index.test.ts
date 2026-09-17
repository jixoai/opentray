import { describe, expect, it } from "vitest";

import {
  createBrokerEndpointIdentity,
  compareOpenTrayProtocolLine,
  EXTENSION_EVENT_RECORD_MAX_BYTES,
  formatBrokerEndpointName,
  formatOpenTrayProtocolLine,
  formatProtocolDistTag,
  formatBrokerStateRoot,
  formatUnixSocketPath,
  formatWindowsPipeName,
  isCommandScope,
  isExtOperationPayload,
  isOpenTrayProtocolLineCompatible,
  isOperationId,
  isSupportedProtocolVersion,
  isTypedExtensionError,
  OPERATION_ID_PATTERN,
  parseProtocolDistTag,
  OPENTRAY_PROTOCOL_FAMILY,
  OPENTRAY_PROTOCOL_LINE,
  parseServerFrame,
  PROTOCOL_VERSION,
  type ClientFrame,
  type CommandScope,
  type ExpectedExtensionIdentity,
  type ExtOperationPayload,
  type Icon,
  type Menu,
  type ServerFrame,
  type TypedExtensionError,
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
      appId: "app-1",
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
      appId: "app-1",
      trayId: "tray-1",
    };
    const parsed = parseServerFrame(
      JSON.stringify({
        type: "tray-bounds",
        requestId: "req-bounds",
        appId: "app-1",
        trayId: "tray-1",
        bounds: {
          kind: "native",
          source: "backend.nativeTrayBounds",
          rect: { x: 10, y: 20, width: 24, height: 24 },
        },
      })
    );

    expect(request.trayId).toBe("tray-1");
    expect(parsed.ok).toBe(true);
    expect(parsed.frame).toEqual({
      type: "tray-bounds",
      requestId: "req-bounds",
      appId: "app-1",
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
      items: [
        { type: "item", id: 8, title: "Show Window", primaryEvent: true },
      ],
    };
    const parsed = parseServerFrame(
      JSON.stringify({
        type: "event",
        event: {
          type: "menuClick",
          appId: "app-1",
          trayId: "daemon-status",
          itemId: 8,
        },
      })
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
        appId: "app-1",
        trayId: "daemon-status",
        itemId: 8,
      },
    });
  });

  it("accepts generic app reopen event frames", () => {
    const parsed = parseServerFrame(
      JSON.stringify({
        type: "app-event",
        event: { type: "reopenRequested", appId: "app-1" },
      }),
    );

    expect(parsed).toEqual({
      ok: true,
      frame: {
        type: "app-event",
        event: { type: "reopenRequested", appId: "app-1" },
      },
    });
  });

  it("models responsive icon candidates in one icon field", () => {
    const icon: Icon = {
      type: "file",
      path: "./fallback.png",
      text: "Build",
      "icon-only": { type: "file", path: "./icon-only.png" },
      "text-only": "Build",
      "icon-text": { type: "file", path: "./icon-text.png", text: "Build" },
      "darwin-icon-only": {
        type: "file",
        path: "./darwin-icon-only.png",
        isTemplate: true,
      },
      "darwin-icon-text": {
        type: "file",
        path: "./darwin-icon-text.png",
        text: "Build",
        isTemplate: true,
      },
      "win32-icon-only": { type: "file", path: "./win32-icon-only.png" },
      "win32-icon-text": {
        type: "file",
        path: "./win32-icon-text.png",
        text: "Build",
      },
      "linux-icon-only": { type: "file", path: "./linux-icon-only.png" },
      "linux-icon-text": {
        type: "file",
        path: "./linux-icon-text.png",
        text: "Build",
      },
    };

    const textOnlyIcon: Icon = {
      "text-only": "Build",
    };

    expect(icon["icon-text"]?.text).toBe("Build");
    expect(icon["darwin-icon-only"]?.isTemplate).toBe(true);
    expect(icon["darwin-icon-text"]?.text).toBe("Build");
    expect(JSON.parse(JSON.stringify(icon))).toMatchObject({
      "darwin-icon-only": { isTemplate: true },
      "win32-icon-only": { path: "./win32-icon-only.png" },
      "linux-icon-text": { text: "Build" },
    });
    expect(textOnlyIcon["text-only"]).toBe("Build");
  });

  it("formats endpoint identity with package, protocol versions, and caller label", () => {
    const identity = createBrokerEndpointIdentity({
      packageVersion: "0.1.0",
      callerLabel: "myapp",
    });

    expect(identity.callerLabel).toBe("myapp");
    expect(formatBrokerEndpointName(identity)).toBe("opentray-0.1.0-p2-myapp");
    expect(formatBrokerStateRoot("/Users/example", identity)).toBe(
      "/Users/example/.opentray/0.1.0/myapp"
    );
    expect(formatUnixSocketPath("/Users/example", identity)).toBe(
      "/Users/example/.opentray/0.1.0/myapp/opentray-p2.sock"
    );
    expect(formatWindowsPipeName(identity)).toBe(
      "\\\\.\\pipe\\opentray-0.1.0-p2-myapp"
    );
  });

  it("falls back to the neutral caller label and keeps identities distinct per caller", () => {
    const implicit = createBrokerEndpointIdentity({ packageVersion: "0.1.0" });
    const explicit = createBrokerEndpointIdentity({
      packageVersion: "0.1.0",
      callerLabel: "myapp",
    });

    expect(implicit.callerLabel).toBe("opentray");
    expect(formatBrokerEndpointName(implicit)).not.toBe(
      formatBrokerEndpointName(explicit)
    );
  });

  it("sanitizes unsafe caller labels without collapsing distinct inputs", () => {
    const safe = createBrokerEndpointIdentity({
      packageVersion: "0.1.0",
      callerLabel: "My App!",
    });
    const empty = createBrokerEndpointIdentity({
      packageVersion: "0.1.0",
      callerLabel: "!!!",
    });

    expect(safe.callerLabel).toBe("my-app");
    expect(empty.callerLabel).toBe("opentray");
  });

  it("formats extension-agnostic protocol-line dist-tags", () => {
    expect(OPENTRAY_PROTOCOL_FAMILY).toBe("opentray-protocol");
    expect(formatOpenTrayProtocolLine(OPENTRAY_PROTOCOL_LINE)).toBe(
      "opentray-protocol/1.1"
    );
    expect(
      formatOpenTrayProtocolLine({
        family: OPENTRAY_PROTOCOL_FAMILY,
        major: 1,
        minor: 2,
      })
    ).toBe("opentray-protocol/1.2");
    expect(formatProtocolDistTag({ channel: "stable" })).toBe("stable-1-1");
    expect(formatProtocolDistTag({ channel: "alpha" })).toBe("alpha-1-1");
    expect(
      formatProtocolDistTag({ channel: "stable", major: 1, minor: 2 })
    ).toBe("stable-1-2");
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
    const stable12 = {
      family: OPENTRAY_PROTOCOL_FAMILY,
      major: 1,
      minor: 2,
    } as const;
    const stable11 = {
      family: OPENTRAY_PROTOCOL_FAMILY,
      major: 1,
      minor: 1,
    } as const;
    const stable10 = {
      family: OPENTRAY_PROTOCOL_FAMILY,
      major: 1,
      minor: 0,
    } as const;
    const stable20 = {
      family: OPENTRAY_PROTOCOL_FAMILY,
      major: 2,
      minor: 0,
    } as const;

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
      "invalid OpenTray protocol dist-tag"
    );
    expect(() => parseProtocolDistTag("alpha-lynx-1-0")).toThrow(
      "invalid OpenTray protocol dist-tag"
    );
  });

  it("keeps runtime protocol version separate from install-time protocol tags", () => {
    expect(PROTOCOL_VERSION).toBe(2);
    expect(formatProtocolDistTag({ channel: "stable" })).toBe("stable-1-1");
    expect(createBrokerEndpointIdentity({ packageVersion: "0.5.1" })).toEqual({
      packageVersion: "0.5.1",
      protocolVersion: 2,
      callerLabel: "opentray",
    });
  });

  it("retires protocol version 1 exhaustively (v2 matrix, Rust parity)", () => {
    expect(isSupportedProtocolVersion(PROTOCOL_VERSION)).toBe(true);
    expect(isSupportedProtocolVersion(1)).toBe(false);
    expect(isSupportedProtocolVersion(PROTOCOL_VERSION + 1)).toBe(false);
  });

  it("rejects ready frames without explicit protocol metadata", () => {
    const parsed = parseServerFrame(
      JSON.stringify({ type: "ready", version: PROTOCOL_VERSION })
    );

    expect(parsed.ok).toBe(false);
  });

  it("requires session metadata in ready frames", () => {
    const parsed = parseServerFrame(
      JSON.stringify({
        type: "ready",
        protocolVersion: PROTOCOL_VERSION,
        brokerVersion: "0.1.0",
      })
    );

    expect(parsed.ok).toBe(false);
  });

  it("requires exact broker artifact identity in ready frames", () => {
    const identity = {
      packageVersion: "0.1.0",
      target: { os: "darwin", arch: "arm64" },
      executableHash: "a".repeat(64),
      buildIdentity: "sha256:aaaaaaaaaaaaaaaa",
    } as const;
    const missing = parseServerFrame(
      JSON.stringify({
        type: "ready",
        protocolVersion: PROTOCOL_VERSION,
        brokerVersion: "0.1.0",
        sessionId: "session-1",
      }),
    );
    const current = parseServerFrame(
      JSON.stringify({
        type: "ready",
        protocolVersion: PROTOCOL_VERSION,
        brokerVersion: "0.1.0",
        brokerArtifactIdentity: identity,
        sessionId: "session-1",
      }),
    );

    expect(missing.ok).toBe(false);
    expect(current.ok).toBe(true);
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
      })
    );

    expect(legacy.ok).toBe(false);

    const parsed = parseServerFrame(
      JSON.stringify({
        type: "app-created",
        requestId: "req-1",
        app: { appId: "app-1" },
      })
    );

    expect(parsed.ok).toBe(true);
    expect(parsed.frame).toEqual({
      type: "app-created",
      requestId: "req-1",
      app: { appId: "app-1" },
    });
  });

  it("parses structured request errors", () => {
    const parsed = parseServerFrame(
      JSON.stringify({
        type: "error",
        requestId: "req-1",
        code: "not-initialized",
        message: "init required",
      })
    );

    expect(parsed.ok).toBe(true);
  });

  it("parses runtime host health responses", () => {
    const parsed = parseServerFrame(
      JSON.stringify({
        type: "runtime-host-health",
        requestId: "req-health",
        health: {
          pid: 12345,
          packageVersion: "0.1.0",
          protocolVersion: PROTOCOL_VERSION,
          endpoint: "/tmp/opentray.sock",
          appId: "com.example.build",
          appName: "Build",
          callerLabel: "myapp",
          sessionCount: 2,
          sessions: [
            { sessionId: 1, internalSessionId: "session-1", initialized: true },
            { sessionId: 2, initialized: false },
          ],
        },
      })
    );

    expect(parsed.ok).toBe(true);
    expect(parsed.frame).toEqual({
      type: "runtime-host-health",
      requestId: "req-health",
      health: {
        pid: 12345,
        packageVersion: "0.1.0",
        protocolVersion: PROTOCOL_VERSION,
        endpoint: "/tmp/opentray.sock",
        appId: "com.example.build",
        appName: "Build",
        callerLabel: "myapp",
        sessionCount: 2,
        sessions: [
          { sessionId: 1, internalSessionId: "session-1", initialized: true },
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
          appId: "app-1",
          trayId: "daemon-status",
          itemId: 99,
        },
      })
    );

    expect(parsed.ok).toBe(true);
    expect(parsed.frame).toEqual({
      type: "event",
      event: {
        type: "menuClick",
        appId: "app-1",
        trayId: "daemon-status",
        itemId: 99,
      },
    });
  });

  it("requires tray identity on tray click events", () => {
    const parsed = parseServerFrame(
      JSON.stringify({
        type: "event",
        event: {
          type: "trayClick",
          appId: "app-1",
          trayId: "daemon-status",
          button: "left",
          x: 10,
          y: 20,
        },
      })
    );
    const missingTray = parseServerFrame(
      JSON.stringify({
        type: "event",
        event: {
          type: "trayClick",
          appId: "app-1",
          button: "left",
          x: 10,
          y: 20,
        },
      })
    );

    expect(parsed.ok).toBe(true);
    expect(missingTray.ok).toBe(false);
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
      })
    );

    expect(parsed.ok).toBe(false);
  });
});

describe("@opentray/spec DeferredOperation protocol (v2)", () => {
  const operationId = "000000000000000f";

  it("round-trips the acceptance frame with the 16-hex wire operationId", () => {
    const accepted: Extract<ServerFrame, { type: "ext-command-accepted" }> = {
      type: "ext-command-accepted",
      requestId: "req-1",
      operationId,
    };
    const wire = JSON.stringify(accepted);

    expect(JSON.parse(wire)).toEqual({
      type: "ext-command-accepted",
      requestId: "req-1",
      operationId,
    });
    const parsed = parseServerFrame(wire);
    expect(parsed).toEqual({ ok: true, frame: accepted });
  });

  it("round-trips terminal frames through both frozen payload branches", () => {
    const terminalResult: Extract<ServerFrame, { type: "ext-operation-terminal" }> = {
      type: "ext-operation-terminal",
      operationId,
      payload: { kind: "result", value: { response: 0, suppressed: false } },
    };
    const terminalError: Extract<ServerFrame, { type: "ext-operation-terminal" }> = {
      type: "ext-operation-terminal",
      operationId,
      payload: {
        kind: "error",
        error: {
          code: "dialog_dismissal_unavailable",
          message: "platform cannot observe the dismissal reason",
          details: { kind: "dismissal" },
        },
      },
    };

    const resultWire = JSON.parse(JSON.stringify(terminalResult));
    expect(resultWire).toEqual({
      type: "ext-operation-terminal",
      operationId,
      payload: { kind: "result", value: { response: 0, suppressed: false } },
    });
    const errorWire = JSON.parse(JSON.stringify(terminalError));
    expect(errorWire).toEqual({
      type: "ext-operation-terminal",
      operationId,
      payload: {
        kind: "error",
        error: {
          code: "dialog_dismissal_unavailable",
          message: "platform cannot observe the dismissal reason",
          details: { kind: "dismissal" },
        },
      },
    });

    expect(parseServerFrame(JSON.stringify(terminalResult))).toEqual({
      ok: true,
      frame: terminalResult,
    });
    expect(parseServerFrame(JSON.stringify(terminalError))).toEqual({
      ok: true,
      frame: terminalError,
    });
  });

  it("rejects a terminal payload without a known discriminated branch", () => {
    const cancel = parseServerFrame(
      JSON.stringify({
        type: "ext-operation-terminal",
        operationId,
        payload: { kind: "cancel" },
      })
    );
    const missingError = parseServerFrame(
      JSON.stringify({
        type: "ext-operation-terminal",
        operationId,
        payload: { kind: "error" },
      })
    );
    const missingValue = parseServerFrame(
      JSON.stringify({
        type: "ext-operation-terminal",
        operationId,
        payload: { kind: "result" },
      })
    );

    expect(cancel.ok).toBe(false);
    expect(missingError.ok).toBe(false);
    expect(missingValue.ok).toBe(false);
    expect(isExtOperationPayload({ kind: "cancel" })).toBe(false);
    expect(isExtOperationPayload({ kind: "result", value: null })).toBe(true);
    expect(isExtOperationPayload({ kind: "error", error: { code: "c", message: "m" } })).toBe(
      true
    );
  });

  it("enforces one details language on typed errors: absent or JSON object", () => {
    // The synchronous error frame already rejects null/scalar/array details;
    // deferred terminal errors accept exactly the same language (impl review R2).
    const objectDetails = { kind: "error", error: { code: "c", message: "m", details: { v: 1 } } };
    expect(isExtOperationPayload(objectDetails)).toBe(true);
    expect(isTypedExtensionError(objectDetails.error)).toBe(true);
    const malformedDetails = [null, 1, "str", [], true];
    for (const details of malformedDetails) {
      const payload = { kind: "error", error: { code: "c", message: "m", details } };
      expect(isExtOperationPayload(payload), `details=${JSON.stringify(details)}`).toBe(false);
      expect(isTypedExtensionError(payload.error), `details=${JSON.stringify(details)}`).toBe(
        false
      );
      expect(
        parseServerFrame(
          JSON.stringify({ type: "ext-operation-terminal", operationId: "0000000000000001", payload })
        ).ok,
        `terminal details=${JSON.stringify(details)}`
      ).toBe(false);
    }
  });

  it("rejects acceptance and terminal frames with wrong field types", () => {
    const acceptedBadOperation = parseServerFrame(
      JSON.stringify({
        type: "ext-command-accepted",
        requestId: "req-1",
        operationId: 15,
      })
    );
    const terminalBadOperation = parseServerFrame(
      JSON.stringify({
        type: "ext-operation-terminal",
        operationId,
        payload: "result",
      })
    );

    expect(acceptedBadOperation.ok).toBe(false);
    expect(terminalBadOperation.ok).toBe(false);
  });

  it("freezes the typed extension error wire shape (details optional both ways)", () => {
    const error: TypedExtensionError = {
      code: "dialog_session_busy",
      message: "owner already shows a dialog",
      details: { kind: "owner", trayId: "tray-1" },
    };
    expect(JSON.parse(JSON.stringify(error))).toEqual({
      code: "dialog_session_busy",
      message: "owner already shows a dialog",
      details: { kind: "owner", trayId: "tray-1" },
    });
    expect(isTypedExtensionError(error)).toBe(true);
    expect(isTypedExtensionError({ code: "c", message: "m" })).toBe(true);
    expect(isTypedExtensionError({ code: "c" })).toBe(false);
    expect(isTypedExtensionError({ message: "m" })).toBe(false);
  });

  it("serializes the broker-injected command scope as camelCase", () => {
    const scope: CommandScope = {
      appId: "app-1",
      trayId: "tray-1",
      sessionId: "session-1",
      instanceGeneration: 3,
    };
    expect(JSON.parse(JSON.stringify(scope))).toEqual({
      appId: "app-1",
      trayId: "tray-1",
      sessionId: "session-1",
      instanceGeneration: 3,
    });
    expect(isCommandScope(scope)).toBe(true);
    expect(isCommandScope({ ...scope, trayId: undefined })).toBe(false);
    expect(isCommandScope({ ...scope, instanceGeneration: -1 })).toBe(false);
    expect(isCommandScope({ ...scope, instanceGeneration: 1.5 })).toBe(false);
  });

  it("keeps command envelopes optional and legacy envelopes unchanged", () => {
    const withScope = {
      type: "ext-command-result",
      requestId: "req-1",
      events: [
        {
          scope: { appId: "app-1", trayId: "tray-1", ext: "dialog" },
          commandScope: {
            appId: "app-1",
            trayId: "tray-1",
            sessionId: "session-1",
            instanceGeneration: 3,
          },
          data: { type: "show" },
        },
      ],
    } as const;
    const legacy = {
      type: "ext-command-result",
      requestId: "req-2",
      events: [{ scope: { appId: "app-1", ext: "dialog" }, data: {} }],
    } as const;

    expect(parseServerFrame(JSON.stringify(withScope)).ok).toBe(true);
    expect(parseServerFrame(JSON.stringify(legacy)).ok).toBe(true);
    const forgedScope = {
      type: "ext-command-result",
      requestId: "req-3",
      events: [
        {
          scope: { appId: "app-1", ext: "dialog" },
          commandScope: { appId: "app-1" },
          data: {},
        },
      ],
    };
    expect(parseServerFrame(JSON.stringify(forgedScope)).ok).toBe(false);
  });

  it("keeps the embedded identity-chain inputs optional both ways", () => {
    const legacy: ExpectedExtensionIdentity = {
      extensionName: "dialog",
      artifactSetVersion: "1.0.0",
      contractFingerprint: "opentray-ext-dialog-contract-1",
      target: { os: "darwin", arch: "arm64" },
    };
    expect(JSON.parse(JSON.stringify(legacy))).toEqual({
      extensionName: "dialog",
      artifactSetVersion: "1.0.0",
      contractFingerprint: "opentray-ext-dialog-contract-1",
      target: { os: "darwin", arch: "arm64" },
    });

    const chained: ExpectedExtensionIdentity = {
      ...legacy,
      sha256: "a".repeat(64),
      buildIdentity: "build-123",
    };
    const wire = JSON.parse(JSON.stringify(chained));
    expect(wire.sha256).toBe("a".repeat(64));
    expect(wire.buildIdentity).toBe("build-123");
  });

  it("exports the shared 64 KiB record bound (Rust fixture parity)", () => {
    expect(EXTENSION_EVENT_RECORD_MAX_BYTES).toBe(65536);
    expect(EXTENSION_EVENT_RECORD_MAX_BYTES).toBe(64 * 1024);
  });

  it("rejects operation ids outside the frozen 16-lowercase-hex wire form", () => {
    expect(isOperationId("000000000000000f")).toBe(true);
    expect(isOperationId("ffffffffffffffff")).toBe(true);
    // Adversarial forms: empty, uppercase, non-hex, too short, too long.
    expect(isOperationId("")).toBe(false);
    expect(isOperationId("000000000000000F")).toBe(false);
    expect(isOperationId("00000000000000zz")).toBe(false);
    expect(isOperationId("000000000000000")).toBe(false);
    expect(isOperationId("000000000000000ff")).toBe(false);
    expect(isOperationId(15)).toBe(false);
    expect(OPERATION_ID_PATTERN.test("0".repeat(16))).toBe(true);

    for (const badOperationId of [
      "",
      "000000000000000F",
      "00000000000000zz",
      "0".repeat(15),
      "0".repeat(17),
    ]) {
      const accepted = parseServerFrame(
        JSON.stringify({
          type: "ext-command-accepted",
          requestId: "req-1",
          operationId: badOperationId,
        })
      );
      const terminal = parseServerFrame(
        JSON.stringify({
          type: "ext-operation-terminal",
          operationId: badOperationId,
          payload: { kind: "result", value: null },
        })
      );
      expect(accepted.ok).toBe(false);
      expect(terminal.ok).toBe(false);
    }
  });

  it("carries optional structured details on synchronous error frames", () => {
    const withDetails = parseServerFrame(
      JSON.stringify({
        type: "error",
        requestId: "req-1",
        code: "dialog_presentation_failed",
        message: "worker did not reach the native modal call",
        details: { worker: "owner-1", phase: "enter-modal" },
      })
    );
    expect(withDetails).toEqual({
      ok: true,
      frame: {
        type: "error",
        requestId: "req-1",
        code: "dialog_presentation_failed",
        message: "worker did not reach the native modal call",
        details: { worker: "owner-1", phase: "enter-modal" },
      },
    });

    const withoutDetails = parseServerFrame(
      JSON.stringify({
        type: "error",
        requestId: "req-2",
        code: "unsupported",
        message: "unknown command",
      })
    );
    expect(withoutDetails).toEqual({
      ok: true,
      frame: {
        type: "error",
        requestId: "req-2",
        code: "unsupported",
        message: "unknown command",
      },
    });
    expect("details" in (withoutDetails.frame as { details?: unknown })).toBe(false);

    // Nulls, scalars, and arrays are structurally invalid details payloads.
    for (const badDetails of [null, "text", 7, ["not", "an", "object"]]) {
      const bad = parseServerFrame(
        JSON.stringify({
          type: "error",
          requestId: "req-3",
          code: "c",
          message: "m",
          details: badDetails,
        })
      );
      expect(bad.ok).toBe(false);
    }
  });

  it("keeps the payload discriminated union exhaustive at the type level", () => {
    const payloads: ExtOperationPayload[] = [
      { kind: "result", value: null },
      { kind: "error", error: { code: "c", message: "m" } },
    ];
    for (const payload of payloads) {
      if (payload.kind === "result") {
        expect(payload.value).toBeDefined();
      } else {
        expect(payload.error.code).toBe("c");
      }
    }
  });
});
