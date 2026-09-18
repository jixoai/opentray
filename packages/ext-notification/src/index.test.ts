// Orthogonal intents (2026-09-18; add-ext-notification batch C, tasks
// 4.1-4.3):
// 1. Payload matrix: frozen UTF-16 bounds 64/256/64 counted by String.length
//    (surrogate-pair boundaries included), the win32 subtitle-join combined
//    256 limit (never truncated), empty title, unknown fields, type
//    violations — every negative case asserts zero broker frames.
// 2. Authorization surface: darwin DeferredOperation terminals and win32
//    Immediate event answers both settle the same public Promise
//    (transport-agnostic law); the broker-side 10s timeout arrives as a
//    typed notification_failed error terminal; typed broker rejections pass
//    their details payloads through unchanged.
// 3. getBackend: lazy-once immutable frozen snapshot consuming the exact
//    ABI-shaped {type:"backend"} event JSON for BOTH platform DTO
//    constructors (the family's R1 fixture law), plus the embedded
//    descriptor and the @opentray/spec guard truth.

import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  BrokerServerError,
  createTrayHandle,
  ExtensionOperationError,
  type NativeExtensionExpectedIdentity,
  type OpenTrayTransport,
} from "opentray";
import type { ClientRequestFrame, RequestId, ServerFrame } from "@opentray/spec";
import {
  isNotificationBackendCapabilities,
  isNotificationErrorCode,
  NOTIFICATION_BODY_LIMIT_UTF16,
  NOTIFICATION_ERROR_CODES,
  NOTIFICATION_SUBTITLE_LIMIT_UTF16,
  NOTIFICATION_TITLE_LIMIT_UTF16,
  type NotificationBackendCapabilities,
} from "@opentray/spec";

import {
  attachNotification,
  NotificationError,
  NotificationExt,
  NOTIFICATION_NATIVE_ARTIFACT,
  type NotificationCapability,
} from "./index";
import { joinWin32Body } from "./shared";

const TEST_EXPECTED_IDENTITY = {
  extensionName: "notification",
  artifactSetVersion: "test",
  contractFingerprint: "notification-test-contract",
  target: { os: process.platform, arch: process.arch },
} satisfies NativeExtensionExpectedIdentity;
const TEST_NATIVE_ARTIFACT = {
  kind: "file",
  path: fileURLToPath(import.meta.url),
  expectedIdentity: TEST_EXPECTED_IDENTITY,
} as const;

const MOUNT_ID = "notification.tray-1";
const TERMINAL_OPERATION_ID = "0123456789abcdef";

const DARWIN_BACKEND: NotificationBackendCapabilities = {
  platform: "darwin",
  authorizationModel: "user",
  channel: "user-notification-center",
  titleLimitUtf16: NOTIFICATION_TITLE_LIMIT_UTF16,
  bodyLimitUtf16: NOTIFICATION_BODY_LIMIT_UTF16,
  subtitleLimitUtf16: NOTIFICATION_SUBTITLE_LIMIT_UTF16,
  supportsSubtitle: true,
};

const WIN32_BACKEND: NotificationBackendCapabilities = {
  platform: "win32",
  authorizationModel: "always-granted",
  channel: "tray-icon-info",
  titleLimitUtf16: NOTIFICATION_TITLE_LIMIT_UTF16,
  bodyLimitUtf16: NOTIFICATION_BODY_LIMIT_UTF16,
  subtitleLimitUtf16: NOTIFICATION_SUBTITLE_LIMIT_UTF16,
  supportsSubtitle: false,
};

type ExtCommandFrame = Extract<ClientRequestFrame, { type: "ext-command" }>;
type ExtCommandHandler = (frame: ExtCommandFrame) => ServerFrame | Promise<ServerFrame>;
type ExtCommandEvent = Extract<ServerFrame, { type: "ext-command-result" }>["events"][number];

/** Resolves ext-command requests through scripted handlers; everything else acks. */
class ScriptedTransport implements OpenTrayTransport {
  readonly frames: ClientRequestFrame[] = [];
  private readonly extCommandHandlers: ExtCommandHandler[];

  constructor(handlers: readonly ExtCommandHandler[] = []) {
    this.extCommandHandlers = [...handlers];
  }

  async request(frame: ClientRequestFrame): Promise<ServerFrame> {
    this.frames.push(frame);
    if (frame.type === "ext-command") {
      const handler = this.extCommandHandlers.shift();
      if (handler === undefined) {
        throw new Error(`unexpected ext-command ${JSON.stringify(frame.data)}`);
      }
      return handler(frame);
    }
    return { type: "ack", requestId: frame.requestId };
  }
}

const attachTestNotification = (
  platform: "darwin" | "win32" | "linux",
  transport: ScriptedTransport
): NotificationCapability =>
  attachNotification(createTrayHandle(transport, "app-1", "tray-1"), {
    mountId: MOUNT_ID,
    artifact: TEST_NATIVE_ARTIFACT,
    platform,
  });

const immediateResult = (requestId: RequestId): ServerFrame => ({
  type: "ext-command-result",
  requestId,
  events: [],
});

/** Exactly what the local broker transport resolves a deferred request with. */
const terminalResult = (value: unknown): ServerFrame => ({
  type: "ext-operation-terminal",
  operationId: TERMINAL_OPERATION_ID,
  payload: { kind: "result", value },
});

const backendEventResult = (
  backend: NotificationBackendCapabilities,
  requestId: RequestId
): ServerFrame => ({
  type: "ext-command-result",
  requestId,
  events: [
    {
      scope: { appId: "app-1", trayId: "tray-1", ext: MOUNT_ID },
      data: { type: "backend", backend },
    },
  ],
});

/** Immediate event answer for the authorization commands (win32 path). */
const authorizationEventResult = (
  data: unknown,
  requestId: RequestId
): ServerFrame => ({
  type: "ext-command-result",
  requestId,
  events: [
    {
      scope: { appId: "app-1", trayId: "tray-1", ext: MOUNT_ID },
      data,
    },
  ],
});

/** ABI-shaped event: the exact immediate-event JSON the native crate emits
 * (the family's R1 law — a plain helper fixture once masked a native/facade
 * shape mismatch; this round-trips real serialized bytes instead). */
const abiShapedEvent = (data: unknown, requestId: RequestId): ServerFrame => ({
  type: "ext-command-result",
  requestId,
  events: [JSON.parse(JSON.stringify({ scope: { appId: "app-1", trayId: "tray-1", ext: MOUNT_ID }, data })) as ExtCommandEvent],
});

// Astral-plane character: one BMP code POINT but TWO UTF-16 code units —
// String.length is the frozen measurement unit.
const ASTRAL = "\u{1D11E}";

describe("@opentray/ext-notification", () => {
  it("declares the embedded artifact and contract identity over the frozen four-target staging matrix", async () => {
    expect(NOTIFICATION_NATIVE_ARTIFACT.kind).toBe("embedded");
    expect(NOTIFICATION_NATIVE_ARTIFACT.targets).toEqual({
      "darwin-arm64": {
        libraryPath: "platforms/darwin-arm64/libopentray_ext_notification.dylib",
      },
      "darwin-x64": {
        libraryPath: "platforms/darwin-x64/libopentray_ext_notification.dylib",
      },
      "win32-arm64": {
        libraryPath: "platforms/win32-arm64/opentray_ext_notification.dll",
      },
      "win32-x64": {
        libraryPath: "platforms/win32-x64/opentray_ext_notification.dll",
      },
    });
    expect(NOTIFICATION_NATIVE_ARTIFACT.packageJsonUrl).toContain(
      "ext-notification/package.json"
    );
    expect(NOTIFICATION_NATIVE_ARTIFACT.contractManifestUrl).toContain(
      "ext-notification/contract.json"
    );
    expect(NotificationExt.name).toBe("notification");
    expect(NotificationExt.artifact).toBe(NOTIFICATION_NATIVE_ARTIFACT);

    // The embedded identity chain reads the shipped contract manifest bytes.
    const contract = JSON.parse(
      await readFile(fileURLToPath(NOTIFICATION_NATIVE_ARTIFACT.contractManifestUrl), "utf8")
    ) as Record<string, unknown>;
    expect(contract).toEqual({
      extensionName: "notification",
      contractFingerprint: "opentray-ext-notification-contract-1",
    });
  });

  it("emits load-ext with expectedIdentity, then camelCase immediate ext-commands for notify", async () => {
    const transport = new ScriptedTransport([
      (frame) => immediateResult(frame.requestId),
      (frame) => immediateResult(frame.requestId),
    ]);
    const notification = attachTestNotification("darwin", transport);

    await notification.notify({ title: "Build finished" });
    await notification.notify({
      title: "Deploy complete",
      body: "All 3 checks passed",
      subtitle: "CI",
      silent: true,
    });

    expect(transport.frames).toEqual([
      {
        type: "load-ext",
        requestId: "opentray-1",
        appId: "app-1",
        name: "notification",
        path: TEST_NATIVE_ARTIFACT.path,
        expectedIdentity: TEST_EXPECTED_IDENTITY,
        mountId: MOUNT_ID,
      },
      {
        type: "ext-command",
        requestId: "opentray-2",
        appId: "app-1",
        trayId: "tray-1",
        ext: MOUNT_ID,
        data: {
          type: "notify",
          title: "Build finished",
          silent: false,
        },
      },
      {
        type: "ext-command",
        requestId: "opentray-3",
        appId: "app-1",
        trayId: "tray-1",
        ext: MOUNT_ID,
        data: {
          type: "notify",
          title: "Deploy complete",
          body: "All 3 checks passed",
          subtitle: "CI",
          silent: true,
        },
      },
    ]);
  });

  it("projects subtitle as a distinct darwin wire field and joins it into the win32 body", async () => {
    const darwin = new ScriptedTransport([(frame) => immediateResult(frame.requestId)]);
    const darwinNotification = attachTestNotification("darwin", darwin);
    await darwinNotification.notify({ title: "t", subtitle: "s", body: "b" });
    expect(darwin.frames[1]).toMatchObject({
      data: {
        type: "notify",
        title: "t",
        body: "b",
        subtitle: "s",
        silent: false,
      },
    });

    const win32 = new ScriptedTransport([
      (frame) => immediateResult(frame.requestId),
      (frame) => immediateResult(frame.requestId),
    ]);
    const win32Notification = attachTestNotification("win32", win32);
    await win32Notification.notify({ title: "t", subtitle: "sub", body: "text" });
    await win32Notification.notify({ title: "t", subtitle: "sub-only" });
    // The degradation is facade-side: the win32 wire never carries subtitle.
    expect(win32.frames[1]).toMatchObject({
      data: {
        type: "notify",
        title: "t",
        body: "sub\u{2014}text",
        silent: false,
      },
    });
    expect((win32.frames[1] as ExtCommandFrame).data).not.toHaveProperty("subtitle");
    expect(win32.frames[2]).toMatchObject({
      data: {
        type: "notify",
        title: "t",
        body: "sub-only",
        silent: false,
      },
    });
  });

  it("sends the notify wire FLAT — the exact shape the native serde tag and the bridge decode (I3a P0 pin)", async () => {
    // The frame data must equal this literal object: fields next to
    // `type`, no nested `options` wrapper (a wrapper never reached a
    // decoder on the native or bridge side and made every real notify
    // fail while the mocked transports stayed green).
    const transport = new ScriptedTransport([(frame) => immediateResult(frame.requestId)]);
    const notification = attachTestNotification("darwin", transport);
    await notification.notify({ title: "t", body: "b", subtitle: "s", silent: true });
    expect(transport.frames[1]).toMatchObject({ type: "ext-command" });
    expect((transport.frames[1] as ExtCommandFrame).data).toEqual({
      type: "notify",
      title: "t",
      body: "b",
      subtitle: "s",
      silent: true,
    });
  });

  it("rejects the payload bounds matrix typed with zero dispatch (UTF-16 code units, String.length)", async () => {
    const transport = new ScriptedTransport();
    const notification = attachTestNotification("darwin", transport);

    await expect(notification.notify({ title: "" })).rejects.toMatchObject({
      code: NOTIFICATION_ERROR_CODES.payloadInvalid,
      details: { field: "title", lengthUtf16: 0, limit: 64 },
    });
    await expect(notification.notify({ title: "a".repeat(65) })).rejects.toMatchObject({
      details: { field: "title", lengthUtf16: 65, limit: 64 },
    });
    // Astral-plane boundary: 32 surrogate pairs = exactly 64 units (legal);
    // 33 pairs = 66 units (one over is enough to prove unit counting).
    await expect(notification.notify({ title: ASTRAL.repeat(33) })).rejects.toMatchObject({
      details: { field: "title", lengthUtf16: 66, limit: 64 },
    });
    await expect(notification.notify({ title: "t", body: "b".repeat(257) })).rejects.toMatchObject(
      {
        details: { field: "body", lengthUtf16: 257, limit: 256 },
      }
    );
    await expect(
      notification.notify({ title: "t", subtitle: "s".repeat(65) })
    ).rejects.toMatchObject({
      details: { field: "subtitle", lengthUtf16: 65, limit: 64 },
    });
    await expect(
      notification.notify({ title: "t", soundtrack: true } as never)
    ).rejects.toMatchObject({
      code: NOTIFICATION_ERROR_CODES.payloadInvalid,
      details: { field: "soundtrack" },
    });
    await expect(notification.notify({ title: 42 } as never)).rejects.toMatchObject({
      details: { field: "title" },
    });
    await expect(
      notification.notify({ title: "t", silent: "no" } as never)
    ).rejects.toMatchObject({
      details: { field: "silent" },
    });
    await expect(notification.notify(null as never)).rejects.toMatchObject({
      code: NOTIFICATION_ERROR_CODES.payloadInvalid,
    });
    expect(transport.frames).toHaveLength(0);
  });

  it("accepts the exact UTF-16 boundaries (64 title, 256 body) and dispatches them", async () => {
    const transport = new ScriptedTransport([
      (frame) => immediateResult(frame.requestId),
      (frame) => immediateResult(frame.requestId),
    ]);
    const notification = attachTestNotification("darwin", transport);

    await expect(
      notification.notify({ title: ASTRAL.repeat(32), body: "b".repeat(256) })
    ).resolves.toBeUndefined();
    expect(transport.frames[1]).toMatchObject({
      data: {
        type: "notify",
        title: ASTRAL.repeat(32),
        body: "b".repeat(256),
        silent: false,
      },
    });
  });

  it("jointly validates the win32 joined body at 256 and never truncates", async () => {
    const win32Transport = new ScriptedTransport([
      (frame) => immediateResult(frame.requestId),
    ]);
    const win32Notification = attachTestNotification("win32", win32Transport);
    // 64-unit subtitle + 1-unit separator + 191-unit body = exactly 256.
    await win32Notification.notify({
      title: "t",
      subtitle: "s".repeat(64),
      body: "b".repeat(191),
    });
    expect(win32Transport.frames[1]).toMatchObject({
      data: {
        type: "notify",
        title: "t",
        body: "s".repeat(64) + "\u{2014}" + "b".repeat(191),
        silent: false,
      },
    });

    // One more body unit overflows the joined channel: typed rejection, zero
    // dispatch, no silent truncation to 256.
    const overflowTransport = new ScriptedTransport();
    const overflowNotification = attachTestNotification("win32", overflowTransport);
    await expect(
      overflowNotification.notify({
        title: "t",
        subtitle: "s".repeat(64),
        body: "b".repeat(192),
      })
    ).rejects.toMatchObject({
      code: NOTIFICATION_ERROR_CODES.payloadInvalid,
      details: { field: "body", lengthUtf16: 257, limit: 256 },
    });
    expect(overflowTransport.frames).toHaveLength(0);

    // The same combined-overflow input is legal on darwin: per-field bounds
    // hold and subtitle stays a distinct field.
    const darwinTransport = new ScriptedTransport([
      (frame) => immediateResult(frame.requestId),
    ]);
    const darwinNotification = attachTestNotification("darwin", darwinTransport);
    await darwinNotification.notify({
      title: "t",
      subtitle: "s".repeat(64),
      body: "b".repeat(192),
    });
    expect(darwinTransport.frames[1]).toMatchObject({
      data: {
        type: "notify",
        title: "t",
        body: "b".repeat(192),
        subtitle: "s".repeat(64),
        silent: false,
      },
    });
  });

  it("settles the authorization surface through darwin deferred terminals", async () => {
    const transport = new ScriptedTransport([
      () => terminalResult({ type: "authorization", status: "notDetermined" }),
      () => terminalResult({ type: "authorizationDecision", granted: false }),
    ]);
    const notification = attachTestNotification("darwin", transport);

    await expect(notification.getAuthorizationStatus()).resolves.toBe("notDetermined");
    await expect(notification.requestAuthorization()).resolves.toBe(false);
    expect(transport.frames[1]).toMatchObject({
      type: "ext-command",
      data: { type: "getAuthorizationStatus" },
    });
    expect(transport.frames[2]).toMatchObject({
      type: "ext-command",
      data: { type: "requestAuthorization" },
    });
  });

  it("accepts immediate authorization event answers (the win32 path)", async () => {
    const transport = new ScriptedTransport([
      (frame) =>
        authorizationEventResult({ type: "authorization", status: "granted" }, frame.requestId),
      (frame) =>
        authorizationEventResult({ type: "authorizationDecision", granted: true }, frame.requestId),
    ]);
    const notification = attachTestNotification("win32", transport);

    await expect(notification.getAuthorizationStatus()).resolves.toBe("granted");
    await expect(notification.requestAuthorization()).resolves.toBe(true);
    // Zero deferred frames: both answers rode ext-command-result envelopes.
    for (const frame of transport.frames) {
      expect(frame.type).not.toBe("ext-operation-terminal");
    }
  });

  it("surfaces the broker-side 10s authorization timeout as typed notification_failed", async () => {
    const transport = new ScriptedTransport([
      () => {
        throw new ExtensionOperationError(
          NOTIFICATION_ERROR_CODES.failed,
          "authorization read did not complete within the 10s budget",
          { details: { reason: "authorization-timeout" } }
        );
      },
    ]);
    const notification = attachTestNotification("darwin", transport);

    const rejection = notification.getAuthorizationStatus();
    await expect(rejection).rejects.toBeInstanceOf(NotificationError);
    const error = (await rejection.catch((caught: unknown) => caught)) as NotificationError;
    expect(error.code).toBe(NOTIFICATION_ERROR_CODES.failed);
    expect(error.details).toEqual({ reason: "authorization-timeout" });
    expect(error.cause).toBeInstanceOf(ExtensionOperationError);
  });

  it("maps typed broker/native rejections with details passthrough and unknown codes unchanged", async () => {
    const transport = new ScriptedTransport([
      () => {
        throw new ExtensionOperationError("notification_denied", "the app is denied", {
          details: { status: "denied" },
        });
      },
      () => {
        throw new BrokerServerError("notification_tray_absent", "scope has no registered icon", {
          details: { kind: "tray-absent", scope: "tray-1" },
        });
      },
      () => {
        throw new ExtensionOperationError(
          "extension_transport_closed",
          "the broker transport closed while an extension operation was pending"
        );
      },
    ]);
    const notification = attachTestNotification("win32", transport);

    const denied = notification.notify({ title: "t" });
    await expect(denied).rejects.toBeInstanceOf(NotificationError);
    const deniedError = (await denied.catch((caught: unknown) => caught)) as NotificationError;
    expect(deniedError.code).toBe(NOTIFICATION_ERROR_CODES.denied);
    expect(deniedError.details).toEqual({ status: "denied" });

    const absent = notification.notify({ title: "t" });
    await expect(absent).rejects.toBeInstanceOf(NotificationError);
    const absentError = (await absent.catch((caught: unknown) => caught)) as NotificationError;
    expect(absentError.code).toBe(NOTIFICATION_ERROR_CODES.trayAbsent);
    expect(absentError.details).toEqual({ kind: "tray-absent", scope: "tray-1" });

    // No transport alias in the frozen family: the shared code surfaces unchanged.
    await expect(notification.notify({ title: "t" })).rejects.toMatchObject({
      code: "extension_transport_closed",
    });
  });

  it("getBackend lazily requests the DTO once and returns one immutable frozen snapshot", async () => {
    const transport = new ScriptedTransport([
      (frame) => backendEventResult(DARWIN_BACKEND, frame.requestId),
    ]);
    const notification = attachTestNotification("darwin", transport);

    const first = await notification.getBackend();
    const second = await notification.getBackend();

    expect(first).toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first).toEqual(DARWIN_BACKEND);
    expect(transport.frames).toHaveLength(2);
    expect(transport.frames[1]).toMatchObject({
      type: "ext-command",
      data: { type: "getBackend" },
    });
  });

  it("getBackend consumes the exact ABI-shaped backend event for BOTH platform DTOs", async () => {
    // Family R1 law: round-trip the real serialized event JSON the native
    // crate emits (`data: { type: "backend", backend }`) so a future
    // native/facade shape drift fails here instead of in production — for
    // both platform constructors (darwin user model, win32 always-granted).
    const darwinTransport = new ScriptedTransport([
      (frame) => abiShapedEvent({ type: "backend", backend: DARWIN_BACKEND }, frame.requestId),
    ]);
    const darwinNotification = attachTestNotification("darwin", darwinTransport);
    await expect(darwinNotification.getBackend()).resolves.toEqual(DARWIN_BACKEND);

    const win32Transport = new ScriptedTransport([
      (frame) => abiShapedEvent({ type: "backend", backend: WIN32_BACKEND }, frame.requestId),
    ]);
    const win32Notification = attachTestNotification("win32", win32Transport);
    await expect(win32Notification.getBackend()).resolves.toEqual(WIN32_BACKEND);
  });

  it("getBackend rejects a missing payload, a platform-mismatched DTO, or a deferred terminal", async () => {
    const missing = new ScriptedTransport([(frame) => immediateResult(frame.requestId)]);
    const missingNotification = attachTestNotification("darwin", missing);
    await expect(missingNotification.getBackend()).rejects.toThrow(/wire contract violation/);

    const mismatch = new ScriptedTransport([
      (frame) => backendEventResult(WIN32_BACKEND, frame.requestId),
    ]);
    const mismatchNotification = attachTestNotification("darwin", mismatch);
    await expect(mismatchNotification.getBackend()).rejects.toThrow(
      /reported platform win32/
    );

    // getBackend is an immediate-path command (only the authorization
    // commands defer); a terminal here is a wire contract violation.
    const deferred = new ScriptedTransport([() => terminalResult(DARWIN_BACKEND)]);
    const deferredNotification = attachTestNotification("darwin", deferred);
    await expect(deferredNotification.getBackend()).rejects.toThrow(/immediate path/);
  });

  it("rejects authorization settles that violate the wire contract", async () => {
    const badTerminal = new ScriptedTransport([
      () => terminalResult({ type: "authorization", status: "maybe" }),
    ]);
    const badTerminalNotification = attachTestNotification("darwin", badTerminal);
    await expect(badTerminalNotification.getAuthorizationStatus()).rejects.toThrow(
      /wire contract/
    );

    const emptyImmediate = new ScriptedTransport([(frame) => immediateResult(frame.requestId)]);
    const emptyImmediateNotification = attachTestNotification("win32", emptyImmediate);
    await expect(emptyImmediateNotification.requestAuthorization()).rejects.toThrow(
      /authorization payload/
    );
  });

  it("requires the immediate path for notify: a deferred terminal is a wire contract violation", async () => {
    const transport = new ScriptedTransport([() => terminalResult(null)]);
    const notification = attachTestNotification("darwin", transport);

    await expect(notification.notify({ title: "t" })).rejects.toThrow(/immediate path/);
  });

  it("rejects every method on linux with a typed platform error before load", async () => {
    const transport = new ScriptedTransport();
    const notification = attachTestNotification("linux", transport);

    const rejections: readonly Promise<unknown>[] = [
      notification.notify({ title: "t" }),
      notification.getAuthorizationStatus(),
      notification.requestAuthorization(),
      notification.getBackend(),
    ];
    for (const rejection of rejections) {
      await expect(rejection).rejects.toMatchObject({
        code: NOTIFICATION_ERROR_CODES.platformUnsupported,
        details: { kind: "platform", platform: "linux" },
      });
    }
    expect(transport.frames).toHaveLength(0);
  });

  it("throws TypeError for unknown attach option fields before any extension work", () => {
    const transport = new ScriptedTransport();
    expect(() =>
      attachNotification(createTrayHandle(transport, "app-1", "tray-1"), {
        mountId: MOUNT_ID,
        mystery: true,
      } as never)
    ).toThrow(TypeError);
    expect(transport.frames).toHaveLength(0);
  });
});

describe("shared pure helpers", () => {
  it("joins the win32 degradation body through one em dash", () => {
    expect(joinWin32Body("s", "b")).toBe("s\u{2014}b");
    expect(joinWin32Body("s", undefined)).toBe("s");
    // An EMPTY-string body is no body at all: never a dangling separator
    // (implementation review I3a P1 parity with the crate's
    // win32_joined_body).
    expect(joinWin32Body("s", "")).toBe("s");
    // The separator itself is one UTF-16 unit and counts toward the 256 join.
    expect(joinWin32Body("s", "b").length).toBe(3);
  });
});

describe("@opentray/spec shared schema guards", () => {
  it("freezes the platform-independent payload bounds at 64/256/64 UTF-16 units", () => {
    expect(NOTIFICATION_TITLE_LIMIT_UTF16).toBe(64);
    expect(NOTIFICATION_BODY_LIMIT_UTF16).toBe(256);
    expect(NOTIFICATION_SUBTITLE_LIMIT_UTF16).toBe(64);
  });

  it("freezes the five-code typed error family", () => {
    expect(NOTIFICATION_ERROR_CODES).toEqual({
      platformUnsupported: "notification_platform_unsupported",
      denied: "notification_denied",
      payloadInvalid: "notification_payload_invalid",
      trayAbsent: "notification_tray_absent",
      failed: "notification_failed",
    });
    expect(isNotificationErrorCode("notification_failed")).toBe(true);
    expect(isNotificationErrorCode("notification_missing")).toBe(false);
  });

  it("guards the backend DTO for both platform constructors and rejects drift", () => {
    expect(isNotificationBackendCapabilities(DARWIN_BACKEND)).toBe(true);
    expect(isNotificationBackendCapabilities(WIN32_BACKEND)).toBe(true);
    expect(
      isNotificationBackendCapabilities({ ...WIN32_BACKEND, supportsSubtitle: "yes" })
    ).toBe(false);
    expect(
      isNotificationBackendCapabilities({ ...DARWIN_BACKEND, authorizationModel: "auto" })
    ).toBe(false);
    expect(
      isNotificationBackendCapabilities({ ...DARWIN_BACKEND, titleLimitUtf16: 256 })
    ).toBe(false);
    expect(isNotificationBackendCapabilities({ platform: "linux" })).toBe(false);
    expect(isNotificationBackendCapabilities(null)).toBe(false);
  });
});
