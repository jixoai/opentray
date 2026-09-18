// Orthogonal intents (2026-09-18; add-ext-clipboard task 4.3):
// 1. writeText preflight matrix over the frozen encoding contract (design
//    reference section 1): UTF-16 code-unit cap boundaries (1 MiB exact,
//    one over), lone-surrogate rejection with the offending index (never a
//    silent replacement), emoji/surrogate-pair pass-through, non-string
//    TypeError — all with zero broker frames.
// 2. ABI shape laws: readText consumes the native `{type:"text"}` event
//    (null = first-class empty state); getBackend consumes the native
//    `{type:"backend"}` event through an ABI-shaped JSON round-trip fixture
//    (the dialog/sound review-chain law) and returns one frozen snapshot.
// 3. Typed error family: broker/native rejections with clipboard codes
//    normalize to ClipboardError preserving the frozen details payloads
//    (attempts/elapsedMs, osErrorCode, lengthUtf16/limit,
//    reason/index); unknown codes pass through unchanged.
// 4. Linux typed rejection with zero frames, unknown attach options
//    TypeError pre-transport, the embedded descriptor over the frozen
//    four-target staging matrix, and the shared @opentray/spec guards.

import { describe, expect, it } from "vitest";
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
  CLIPBOARD_ERROR_CODES,
  CLIPBOARD_MAX_WRITE_UTF16,
  isClipboardBackendCapabilities,
  isClipboardErrorCode,
} from "@opentray/spec";

import {
  attachClipboard,
  ClipboardError,
  ClipboardExt,
  CLIPBOARD_NATIVE_ARTIFACT,
  findLoneSurrogateIndex,
  type ClipboardBackendCapabilities,
  type ClipboardCapability,
} from "./index";

const TEST_EXPECTED_IDENTITY = {
  extensionName: "clipboard",
  artifactSetVersion: "test",
  contractFingerprint: "clipboard-test-contract",
  target: { os: process.platform, arch: process.arch },
} satisfies NativeExtensionExpectedIdentity;
const TEST_NATIVE_ARTIFACT = {
  kind: "file",
  path: fileURLToPath(import.meta.url),
  expectedIdentity: TEST_EXPECTED_IDENTITY,
} as const;

const MOUNT_ID = "clipboard.tray-1";

const DARWIN_BACKEND: ClipboardBackendCapabilities = {
  platform: "darwin",
  textOnly: true,
  maxWriteUtf16: CLIPBOARD_MAX_WRITE_UTF16,
  boundedOpenRetry: false,
};

const WIN32_BACKEND: ClipboardBackendCapabilities = {
  platform: "win32",
  textOnly: true,
  maxWriteUtf16: CLIPBOARD_MAX_WRITE_UTF16,
  boundedOpenRetry: true,
};

type ExtCommandFrame = Extract<ClientRequestFrame, { type: "ext-command" }>;
type ExtCommandHandler = (frame: ExtCommandFrame) => ServerFrame | Promise<ServerFrame>;

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

const attachTestClipboard = (
  platform: "darwin" | "win32" | "linux",
  transport: ScriptedTransport
): ClipboardCapability =>
  attachClipboard(createTrayHandle(transport, "app-1", "tray-1"), {
    mountId: MOUNT_ID,
    artifact: TEST_NATIVE_ARTIFACT,
    platform,
  });

const immediateResult = (requestId: RequestId): ServerFrame => ({
  type: "ext-command-result",
  requestId,
  events: [],
});

const textEventResult = (
  text: string | null,
  requestId: RequestId
): ServerFrame => ({
  type: "ext-command-result",
  requestId,
  events: [
    {
      scope: { appId: "app-1", trayId: "tray-1", ext: MOUNT_ID },
      data: { type: "text", text },
    },
  ],
});

const backendEventResult = (
  backend: ClipboardBackendCapabilities,
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

/**
 * ABI-shaped events: the exact immediate-event JSON the native crate emits
 * (options.rs result_event shapes). The plain helper objects above and the
 * ABI fixture must stay isomorphic — the dialog/sound review chain caught a
 * native/facade shape mismatch that plain mocked objects had masked.
 */
const abiShapedResult = (
  data: Record<string, unknown>,
  requestId: RequestId
): ServerFrame => {
  type ImmediateEvent = Extract<ServerFrame, { type: "ext-command-result" }>["events"][number];
  const nativeJson = JSON.stringify({
    scope: { appId: "app-1", trayId: "tray-1", ext: MOUNT_ID },
    data,
  });
  return {
    type: "ext-command-result",
    requestId,
    events: [JSON.parse(nativeJson) as ImmediateEvent],
  };
};

/** Exactly one deferred terminal — clipboard must never settle through this shape. */
const terminalResult = (): ServerFrame => ({
  type: "ext-operation-terminal",
  operationId: "0123456789abcdef",
  payload: { kind: "result", value: null },
});

describe("@opentray/ext-clipboard", () => {
  it("declares the embedded artifact over the frozen four-target staging matrix", () => {
    expect(CLIPBOARD_NATIVE_ARTIFACT.kind).toBe("embedded");
    expect(CLIPBOARD_NATIVE_ARTIFACT.targets).toEqual({
      "darwin-arm64": {
        libraryPath: "platforms/darwin-arm64/libopentray_ext_clipboard.dylib",
      },
      "darwin-x64": {
        libraryPath: "platforms/darwin-x64/libopentray_ext_clipboard.dylib",
      },
      "win32-arm64": {
        libraryPath: "platforms/win32-arm64/opentray_ext_clipboard.dll",
      },
      "win32-x64": {
        libraryPath: "platforms/win32-x64/opentray_ext_clipboard.dll",
      },
    });
    expect(CLIPBOARD_NATIVE_ARTIFACT.packageJsonUrl).toContain("ext-clipboard/package.json");
    expect(CLIPBOARD_NATIVE_ARTIFACT.contractManifestUrl).toContain(
      "ext-clipboard/contract.json"
    );
    expect(ClipboardExt.name).toBe("clipboard");
    expect(ClipboardExt.artifact).toBe(CLIPBOARD_NATIVE_ARTIFACT);
  });

  it("emits load-ext with expectedIdentity, then camelCase immediate ext-commands", async () => {
    const transport = new ScriptedTransport([
      (frame) => textEventResult("hello", frame.requestId),
      (frame) => immediateResult(frame.requestId),
      (frame) => immediateResult(frame.requestId),
    ]);
    const clipboard = attachTestClipboard("darwin", transport);

    await expect(clipboard.readText()).resolves.toBe("hello");
    await clipboard.writeText("hello");
    await clipboard.clear();

    expect(transport.frames).toEqual([
      {
        type: "load-ext",
        requestId: "opentray-1",
        appId: "app-1",
        name: "clipboard",
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
        data: { type: "readText" },
      },
      {
        type: "ext-command",
        requestId: "opentray-3",
        appId: "app-1",
        trayId: "tray-1",
        ext: MOUNT_ID,
        data: { type: "writeText", text: "hello" },
      },
      {
        type: "ext-command",
        requestId: "opentray-4",
        appId: "app-1",
        trayId: "tray-1",
        ext: MOUNT_ID,
        data: { type: "clear" },
      },
    ]);
  });

  // -------------------------------------------------------------------------
  // writeText preflight matrix (frozen encoding contract, design section 1)
  // -------------------------------------------------------------------------

  it("throws TypeError on a non-string payload before any dispatch", async () => {
    const transport = new ScriptedTransport();
    const clipboard = attachTestClipboard("darwin", transport);

    await expect(clipboard.writeText(42 as never)).rejects.toThrow(TypeError);
    await expect(clipboard.writeText(null as never)).rejects.toThrow(TypeError);
    expect(transport.frames).toHaveLength(0);
  });

  it("enforces the frozen 1 MiB UTF-16 cap at both boundaries", async () => {
    const atCap = "x".repeat(CLIPBOARD_MAX_WRITE_UTF16);
    const overCap = "x".repeat(CLIPBOARD_MAX_WRITE_UTF16 + 1);

    const transport = new ScriptedTransport([(frame) => immediateResult(frame.requestId)]);
    const clipboard = attachTestClipboard("darwin", transport);
    await clipboard.writeText(atCap);
    const dispatched = transport.frames.at(-1);
    expect(dispatched).toMatchObject({
      type: "ext-command",
      data: { type: "writeText", text: atCap },
    });

    const rejecting = new ScriptedTransport();
    const rejectingClipboard = attachTestClipboard("win32", rejecting);
    const rejection = rejectingClipboard.writeText(overCap);
    await expect(rejection).rejects.toBeInstanceOf(ClipboardError);
    const error = (await rejection.catch((caught: unknown) => caught)) as ClipboardError;
    expect(error.code).toBe(CLIPBOARD_ERROR_CODES.payloadTooLarge);
    expect(error.details).toEqual({
      lengthUtf16: CLIPBOARD_MAX_WRITE_UTF16 + 1,
      limit: CLIPBOARD_MAX_WRITE_UTF16,
    });
    expect(rejecting.frames).toHaveLength(0);
  });

  it("counts emoji by UTF-16 units: an emoji string can cross the cap", async () => {
    const emojiOverCap = "\u{1F600}".repeat(CLIPBOARD_MAX_WRITE_UTF16 / 2 + 1);
    const transport = new ScriptedTransport();
    const clipboard = attachTestClipboard("darwin", transport);
    const rejection = clipboard.writeText(emojiOverCap);
    await expect(rejection).rejects.toBeInstanceOf(ClipboardError);
    const error = (await rejection.catch((caught: unknown) => caught)) as ClipboardError;
    expect(error.code).toBe(CLIPBOARD_ERROR_CODES.payloadTooLarge);
    // 524_577 emoji = 1_049_154 UTF-16 units.
    expect(error.details).toMatchObject({ lengthUtf16: CLIPBOARD_MAX_WRITE_UTF16 + 2 });
    expect(transport.frames).toHaveLength(0);
  });

  it("rejects lone surrogates typed with the offending index, never replacing", async () => {
    const transport = new ScriptedTransport();
    const clipboard = attachTestClipboard("darwin", transport);

    const cases: readonly [string, number][] = [
      ["\uD83D", 0],
      ["\uDE00", 0],
      ["a\uD83D\uDE00\uD83D", 3],
      ["\uD83D\uDE00\uD83D", 2],
      ["ok\uD800", 2],
    ];
    for (const [payload, index] of cases) {
      const rejection = clipboard.writeText(payload);
      await expect(rejection).rejects.toBeInstanceOf(ClipboardError);
      const error = (await rejection.catch((caught: unknown) => caught)) as ClipboardError;
      expect(error.code).toBe(CLIPBOARD_ERROR_CODES.payloadInvalid);
      expect(error.details).toEqual({ reason: "lone-surrogate", index });
    }
    // No replacement write occurred: zero frames across every rejection.
    expect(transport.frames).toHaveLength(0);
  });

  it("passes valid surrogate pairs through byte-exact", async () => {
    const transport = new ScriptedTransport([(frame) => immediateResult(frame.requestId)]);
    const clipboard = attachTestClipboard("win32", transport);
    const payload = "first \u{1F600} last \u{1F9E1}";
    await clipboard.writeText(payload);
    expect(transport.frames.at(-1)).toMatchObject({
      type: "ext-command",
      data: { type: "writeText", text: payload },
    });
  });

  it("findLoneSurrogateIndex covers pair boundaries and BMP edges", () => {
    expect(findLoneSurrogateIndex("plain text")).toBeNull();
    expect(findLoneSurrogateIndex("\u{1F600}")).toBeNull();
    expect(findLoneSurrogateIndex("\u{1F600}\u{1F9E1}ok")).toBeNull();
    // BMP units on both surrogate-block edges are not surrogates.
    expect(findLoneSurrogateIndex("\uD7FF\uE000")).toBeNull();
    expect(findLoneSurrogateIndex("\uD83D")).toBe(0);
    expect(findLoneSurrogateIndex("\uDE00")).toBe(0);
    expect(findLoneSurrogateIndex("\uD83D\uDE00\uD83D")).toBe(2);
    expect(findLoneSurrogateIndex("a\uD83D\uDE00\uDE00")).toBe(3);
  });

  // -------------------------------------------------------------------------
  // readText ABI shape (null = first-class empty state)
  // -------------------------------------------------------------------------

  it("readText resolves null for the ABI-shaped empty-board event", async () => {
    const transport = new ScriptedTransport([
      (frame) => abiShapedResult({ type: "text", text: null }, frame.requestId),
    ]);
    const clipboard = attachTestClipboard("darwin", transport);
    await expect(clipboard.readText()).resolves.toBeNull();
  });

  it("readText resolves the ABI-shaped text event byte-exact", async () => {
    const payload = "h\u{1F600}i";
    const transport = new ScriptedTransport([
      (frame) => abiShapedResult({ type: "text", text: payload }, frame.requestId),
    ]);
    const clipboard = attachTestClipboard("win32", transport);
    await expect(clipboard.readText()).resolves.toBe(payload);
  });

  it("readText without a text payload is a wire contract violation", async () => {
    const missing = new ScriptedTransport([(frame) => immediateResult(frame.requestId)]);
    await expect(attachTestClipboard("darwin", missing).readText()).rejects.toThrow(
      /wire contract violation/
    );

    // A result-shaped event (the wrong family) never satisfies readText.
    const wrongShape = new ScriptedTransport([
      (frame) => abiShapedResult({ type: "result", op: "readText" }, frame.requestId),
    ]);
    await expect(attachTestClipboard("darwin", wrongShape).readText()).rejects.toThrow(
      /wire contract violation/
    );
  });

  // -------------------------------------------------------------------------
  // Typed error family normalization (frozen details payloads)
  // -------------------------------------------------------------------------

  it("normalizes clipboard-coded broker errors preserving the frozen details payloads", async () => {
    const transport = new ScriptedTransport([
      () => {
        throw new ExtensionOperationError("clipboard_locked", "lock contention", {
          details: { attempts: 15, elapsedMs: 2003 },
        });
      },
      () => {
        throw new BrokerServerError("clipboard_unavailable", "native failure", {
          details: { osErrorCode: 6 },
        });
      },
      () => {
        throw new ExtensionOperationError("clipboard_payload_too_large", "too large", {
          details: { lengthUtf16: 1_048_577, limit: 1_048_576 },
        });
      },
    ]);
    const clipboard = attachTestClipboard("win32", transport);

    const locked = clipboard.readText();
    await expect(locked).rejects.toBeInstanceOf(ClipboardError);
    const lockedError = (await locked.catch((caught: unknown) => caught)) as ClipboardError;
    expect(lockedError.details).toEqual({
      attempts: 15,
      elapsedMs: 2003,
    });

    const unavailable = clipboard.writeText("x");
    await expect(unavailable).rejects.toBeInstanceOf(ClipboardError);
    const unavailableError = (await unavailable.catch(
      (e: unknown) => e as ClipboardError
    )) as ClipboardError;
    expect(unavailableError.code).toBe(CLIPBOARD_ERROR_CODES.unavailable);
    expect(unavailableError.details).toEqual({ osErrorCode: 6 });

    const tooLarge = clipboard.writeText("x");
    await expect(tooLarge).rejects.toBeInstanceOf(ClipboardError);
    const tooLargeError = (await tooLarge.catch((caught: unknown) => caught)) as ClipboardError;
    expect(tooLargeError.details).toEqual({
      lengthUtf16: 1_048_577,
      limit: 1_048_576,
    });
  });

  it("passes unknown codes and the shared transport-close code through unchanged", async () => {
    const transport = new ScriptedTransport([
      () => {
        throw new ExtensionOperationError(
          "extension_transport_closed",
          "the broker transport closed while an extension operation was pending"
        );
      },
    ]);
    const clipboard = attachTestClipboard("darwin", transport);
    await expect(clipboard.clear()).rejects.toMatchObject({
      code: "extension_transport_closed",
    });
  });

  it("requires the immediate path: a deferred terminal is a wire contract violation", async () => {
    const transport = new ScriptedTransport([() => terminalResult()]);
    const clipboard = attachTestClipboard("darwin", transport);
    await expect(clipboard.clear()).rejects.toThrow(/immediate path/);
  });

  // -------------------------------------------------------------------------
  // getBackend (async frozen snapshot + the {type:"backend"} ABI shape law)
  // -------------------------------------------------------------------------

  it("getBackend lazily requests the DTO once and returns one frozen snapshot", async () => {
    const transport = new ScriptedTransport([
      (frame) => backendEventResult(DARWIN_BACKEND, frame.requestId),
    ]);
    const clipboard = attachTestClipboard("darwin", transport);

    const first = await clipboard.getBackend();
    const second = await clipboard.getBackend();
    expect(first).toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first).toEqual(DARWIN_BACKEND);
    expect(transport.frames).toHaveLength(2);
    expect(transport.frames[1]).toMatchObject({
      type: "ext-command",
      data: { type: "getBackend" },
    });
  });

  it("getBackend consumes the ABI-shaped win32 backend event round-trip", async () => {
    // The ABI boundary fixture (dialog/sound review-chain law): the facade
    // must consume the exact immediate-event JSON the native crate emits —
    // a plain mocked object alone can mask a native/facade mismatch.
    const transport = new ScriptedTransport([
      (frame) => abiShapedResult(
        { type: "backend", backend: WIN32_BACKEND },
        frame.requestId
      ),
    ]);
    const clipboard = attachTestClipboard("win32", transport);
    await expect(clipboard.getBackend()).resolves.toEqual(WIN32_BACKEND);

    const darwinTransport = new ScriptedTransport([
      (frame) => abiShapedResult(
        { type: "backend", backend: DARWIN_BACKEND },
        frame.requestId
      ),
    ]);
    await expect(
      attachTestClipboard("darwin", darwinTransport).getBackend()
    ).resolves.toEqual(DARWIN_BACKEND);
  });

  it("getBackend rejects a missing payload or a platform-mismatched DTO", async () => {
    const missing = new ScriptedTransport([(frame) => immediateResult(frame.requestId)]);
    await expect(attachTestClipboard("darwin", missing).getBackend()).rejects.toThrow(
      /wire contract violation/
    );

    const mismatch = new ScriptedTransport([
      (frame) => backendEventResult(WIN32_BACKEND, frame.requestId),
    ]);
    await expect(attachTestClipboard("darwin", mismatch).getBackend()).rejects.toThrow(
      /reported platform win32/
    );

    // The previous (wrong) result-op shape never satisfies the backend event.
    const wrongShape = new ScriptedTransport([
      (frame) => abiShapedResult(
        { type: "result", op: "getBackend", backend: DARWIN_BACKEND },
        frame.requestId
      ),
    ]);
    await expect(attachTestClipboard("darwin", wrongShape).getBackend()).rejects.toThrow(
      /wire contract violation/
    );
  });

  // -------------------------------------------------------------------------
  // Linux typed rejection (zero broker frames) + attach option gate
  // -------------------------------------------------------------------------

  it("rejects every method on linux with a typed platform error before load", async () => {
    const transport = new ScriptedTransport();
    const clipboard = attachTestClipboard("linux", transport);

    const rejections: readonly Promise<unknown>[] = [
      clipboard.readText(),
      clipboard.writeText("hello"),
      clipboard.clear(),
      clipboard.getBackend(),
    ];
    for (const rejection of rejections) {
      await expect(rejection).rejects.toMatchObject({
        code: CLIPBOARD_ERROR_CODES.platformUnsupported,
        details: { kind: "platform", platform: "linux" },
      });
    }
    expect(transport.frames).toHaveLength(0);
  });

  it("rejects unknown attach option fields with a pre-transport TypeError", async () => {
    const transport = new ScriptedTransport();
    expect(() =>
      attachClipboard(createTrayHandle(transport, "app-1", "tray-1"), {
        mountId: MOUNT_ID,
        artifact: TEST_NATIVE_ARTIFACT,
        flush: true,
      } as never)
    ).toThrow(TypeError);
    // The Linux gate stays the zero-frame path even for oversized payloads
    // (platform first: the whole capability is dead on linux).
    const linux = attachTestClipboard("linux", new ScriptedTransport());
    await expect(
      linux.writeText("x".repeat(CLIPBOARD_MAX_WRITE_UTF16 + 1))
    ).rejects.toMatchObject({
      code: CLIPBOARD_ERROR_CODES.platformUnsupported,
    });
    expect(transport.frames).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Shared @opentray/spec guards (task 2.1 evidence exercised from the facade)
  // -------------------------------------------------------------------------

  it("keeps the shared spec guards frozen", () => {
    expect(CLIPBOARD_MAX_WRITE_UTF16).toBe(1_048_576);
    expect(isClipboardBackendCapabilities(DARWIN_BACKEND)).toBe(true);
    expect(isClipboardBackendCapabilities(WIN32_BACKEND)).toBe(true);
    expect(isClipboardBackendCapabilities({ ...WIN32_BACKEND, platform: "linux" })).toBe(false);
    expect(
      isClipboardBackendCapabilities({ ...WIN32_BACKEND, maxWriteUtf16: 65_536 })
    ).toBe(false);
    expect(isClipboardBackendCapabilities({ ...WIN32_BACKEND, textOnly: false })).toBe(false);
    expect(isClipboardBackendCapabilities(null)).toBe(false);
    expect(isClipboardBackendCapabilities("darwin")).toBe(false);

    expect(CLIPBOARD_ERROR_CODES).toEqual({
      platformUnsupported: "clipboard_platform_unsupported",
      locked: "clipboard_locked",
      unavailable: "clipboard_unavailable",
      payloadTooLarge: "clipboard_payload_too_large",
      payloadInvalid: "clipboard_payload_invalid",
    });
    for (const code of Object.values(CLIPBOARD_ERROR_CODES)) {
      expect(isClipboardErrorCode(code)).toBe(true);
    }
    expect(isClipboardErrorCode("sound_not_found")).toBe(false);
    expect(isClipboardErrorCode("clipboard_mystery")).toBe(false);
  });
});
