// Orthogonal intents (2026-09-18; add-ext-opener task 4.3):
// 1. The frozen open() preflight matrix: absolute-path forms (POSIX `/`,
//    win32 drive, UNC, `\\?\` literal — all verbatim, existence never a
//    precondition), URL targets through the frozen allowlist
//    (case-insensitive `HTTPS://` passes; `file:` URLs pass as-is with no
//    URL→path normalization), drive-relative/relative typed rejections,
//    blocked schemes with the scheme in details.
// 2. revealInFolder: absolute-only + the frozen rejection set (quote /
//    any C0 control — reject-not-escape) with zero dispatch, plus the
//    pure trailing-separator trim law with the root boundary.
// 3. Capability/transport laws: Linux typed zero-frame rejection, the
//    immediate-path requirement, the `{type:"backend"}` ABI-shaped
//    getBackend fixture with the frozen immutable snapshot, embedded
//    descriptor over the frozen four-target staging matrix, and the
//    @opentray/spec schema guards (task 2.1) exercised from this facade.

import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  BrokerServerError,
  createTrayHandle,
  ExtensionOperationError,
  NativeExtensionEmbeddedArtifactError,
  type NativeExtensionExpectedIdentity,
  type OpenTrayTransport,
} from "opentray";
import type { ClientRequestFrame, RequestId, ServerFrame } from "@opentray/spec";
import {
  OPENER_ALLOWED_SCHEMES,
  OPENER_ERROR_CODES,
  isOpenerAllowedScheme,
  isOpenerBackendCapabilities,
  isOpenerErrorCode,
  type OpenerBackendCapabilities,
} from "@opentray/spec";

import {
  attachOpener,
  classifyOpenerTarget,
  OpenerError,
  OpenerExt,
  OPENER_NATIVE_ARTIFACT,
  preflightOpenTarget,
  preflightRevealPath,
  type OpenerCapability,
} from "./index";

const TEST_EXPECTED_IDENTITY = {
  extensionName: "opener",
  artifactSetVersion: "test",
  contractFingerprint: "opener-test-contract",
  target: { os: process.platform, arch: process.arch },
} satisfies NativeExtensionExpectedIdentity;
const TEST_NATIVE_ARTIFACT = {
  kind: "file",
  path: fileURLToPath(import.meta.url),
  expectedIdentity: TEST_EXPECTED_IDENTITY,
} as const;

const MOUNT_ID = "opener.tray-1";

const DARWIN_BACKEND: OpenerBackendCapabilities = {
  platform: "darwin",
  allowedSchemes: ["http", "https", "file", "mailto"],
  supportsRevealInFolder: true,
};

const WIN32_BACKEND: OpenerBackendCapabilities = {
  platform: "win32",
  allowedSchemes: ["http", "https", "file", "mailto"],
  supportsRevealInFolder: true,
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

const attachTestOpener = (
  platform: "darwin" | "win32" | "linux",
  transport: ScriptedTransport
): OpenerCapability =>
  attachOpener(createTrayHandle(transport, "app-1", "tray-1"), {
    mountId: MOUNT_ID,
    artifact: TEST_NATIVE_ARTIFACT,
    platform,
  });

const immediateResult = (requestId: RequestId): ServerFrame => ({
  type: "ext-command-result",
  requestId,
  events: [],
});

const backendEventResult = (
  backend: OpenerBackendCapabilities,
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

/** ABI-shaped backend event: the exact immediate-event JSON the native
 * crate emits for getBackend (the family ABI shape law — a plain mocked
 * helper could mask a native/facade shape mismatch; this fixture pins
 * the real one). */
const abiShapedBackendEvent = (
  backend: OpenerBackendCapabilities,
  requestId: RequestId
): ServerFrame => {
  type BackendEvent = Extract<ServerFrame, { type: "ext-command-result" }>["events"][number];
  const nativeJson = JSON.stringify({
    scope: { appId: "app-1", trayId: "tray-1", ext: MOUNT_ID },
    data: { type: "backend", backend },
  });
  return {
    type: "ext-command-result",
    requestId,
    events: [JSON.parse(nativeJson) as BackendEvent],
  };
};

/** Exactly one deferred terminal — opener must never settle through this shape. */
const terminalResult = (): ServerFrame => ({
  type: "ext-operation-terminal",
  operationId: "0123456789abcdef",
  payload: { kind: "result", value: null },
});

describe("@opentray/ext-opener", () => {
  it("declares the embedded artifact over the frozen four-target staging matrix", () => {
    expect(OPENER_NATIVE_ARTIFACT.kind).toBe("embedded");
    expect(OPENER_NATIVE_ARTIFACT.targets).toEqual({
      "darwin-arm64": {
        libraryPath: "platforms/darwin-arm64/libopentray_ext_opener.dylib",
      },
      "darwin-x64": {
        libraryPath: "platforms/darwin-x64/libopentray_ext_opener.dylib",
      },
      "win32-arm64": {
        libraryPath: "platforms/win32-arm64/opentray_ext_opener.dll",
      },
      "win32-x64": {
        libraryPath: "platforms/win32-x64/opentray_ext_opener.dll",
      },
    });
    expect(OPENER_NATIVE_ARTIFACT.packageJsonUrl).toContain("ext-opener/package.json");
    expect(OPENER_NATIVE_ARTIFACT.contractManifestUrl).toContain("ext-opener/contract.json");
    expect(OpenerExt.name).toBe("opener");
    expect(OpenerExt.artifact).toBe(OPENER_NATIVE_ARTIFACT);
  });

  it("ships the frozen contract identity bytes beside the facade package", async () => {
    const contract = JSON.parse(
      await readFile(fileURLToPath(new URL("../contract.json", import.meta.url)), "utf8")
    ) as { extensionName: string; contractFingerprint: string };
    expect(contract).toEqual({
      extensionName: "opener",
      contractFingerprint: "opentray-ext-opener-contract-1",
    });
  });

  it("emits load-ext with expectedIdentity, then camelCase immediate ext-commands for open", async () => {
    const transport = new ScriptedTransport([
      (frame) => immediateResult(frame.requestId),
      (frame) => immediateResult(frame.requestId),
    ]);
    const opener = attachTestOpener("darwin", transport);

    await opener.open("/tmp/report.txt");
    await opener.open("https://example.com/path?q=1");

    expect(transport.frames).toEqual([
      {
        type: "load-ext",
        requestId: "opentray-1",
        appId: "app-1",
        name: "opener",
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
        data: { type: "open", target: "/tmp/report.txt" },
      },
      {
        type: "ext-command",
        requestId: "opentray-3",
        appId: "app-1",
        trayId: "tray-1",
        ext: MOUNT_ID,
        data: { type: "open", target: "https://example.com/path?q=1" },
      },
    ]);
  });

  it("dispatches every legal matrix target VERBATIM (win32 forms, file: URLs, uppercase schemes)", async () => {
    for (const platform of ["win32", "darwin"] as const) {
      const targets = [
        "C:\\temp\\file.txt",
        "C:/Users/a/b.txt",
        "\\\\server\\share\\file.txt",
        "\\\\?\\C:\\temp\\file.txt",
        "file:///tmp/report.txt",
        "HTTPS://example.com",
        "MailTo:user@example.com",
        "mailto:user@example.com",
      ];
      const transport = new ScriptedTransport(
        targets.map(
          () => (frame: ExtCommandFrame) => immediateResult(frame.requestId)
        )
      );
      const opener = attachTestOpener(platform, transport);
      for (const target of targets) {
        await opener.open(target);
      }
      const commands = transport.frames.filter(
        (frame): frame is Extract<ClientRequestFrame, { type: "ext-command" }> =>
          frame.type === "ext-command"
      );
      expect(commands).toHaveLength(targets.length);
      for (let index = 0; index < targets.length; index += 1) {
        expect(commands[index]?.data).toEqual({ type: "open", target: targets[index] });
      }
    }
  });

  it("rejects malformed URL prefixes as relative typed rejections (the new URL() oracle)", async () => {
    // Mirrors the native WHATWG parse gate corpus (implementation review
    // I2 P1): a scheme-like prefix that `new URL()` cannot parse is the
    // relative rejection on BOTH sides — the native lexical scan alone
    // used to pass these through to ShellExecuteW.
    const transport = new ScriptedTransport();
    const opener = attachTestOpener("win32", transport);
    for (const target of ["http:", "http://", "http://[invalid", "https://exa mple.com"]) {
      const rejection = opener.open(target);
      await expect(rejection).rejects.toBeInstanceOf(OpenerError);
      const error = (await rejection.catch((caught: unknown) => caught)) as OpenerError;
      expect(error.code).toBe(OPENER_ERROR_CODES.targetInvalid);
      expect(error.details).toEqual({ reason: "relative" });
    }
    expect(transport.frames).toHaveLength(0);
  });

  it("dispatches bare non-special scheme URLs that new URL() accepts (no stricter than the oracle)", async () => {
    // `new URL("mailto:")` / `new URL("file:")` / `new URL("file:x")`
    // parse — the facade must dispatch them verbatim exactly like the
    // native WHATWG gate, never a rejection.
    const targets = ["mailto:", "file:", "file:x", "  https://example.com  "];
    const transport = new ScriptedTransport(
      targets.map(() => (frame: ExtCommandFrame) => immediateResult(frame.requestId))
    );
    const opener = attachTestOpener("win32", transport);
    for (const target of targets) {
      await opener.open(target);
    }
    const commands = transport.frames.filter(
      (frame): frame is Extract<ClientRequestFrame, { type: "ext-command" }> =>
        frame.type === "ext-command"
    );
    expect(commands.map((frame) => frame.data)).toEqual(
      targets.map((target) => ({ type: "open", target }))
    );
  });

  it("never treats existence as an acceptance precondition (missing paths dispatch)", async () => {
    const transport = new ScriptedTransport([(frame) => immediateResult(frame.requestId)]);
    const opener = attachTestOpener("darwin", transport);

    await opener.open("/definitely/not/there/report-later.txt");

    expect(transport.frames[1]).toMatchObject({
      data: { type: "open", target: "/definitely/not/there/report-later.txt" },
    });
  });

  it("rejects drive-relative and relative targets typed with zero dispatch", async () => {
    const transport = new ScriptedTransport();
    const opener = attachTestOpener("win32", transport);

    const driveRelative = opener.open("C:file.txt");
    await expect(driveRelative).rejects.toBeInstanceOf(OpenerError);
    const driveError = (await driveRelative.catch((caught: unknown) => caught)) as OpenerError;
    expect(driveError.code).toBe(OPENER_ERROR_CODES.targetInvalid);
    expect(driveError.details).toEqual({ reason: "drive-relative" });

    const relative = opener.open("relative/file.txt");
    await expect(relative).rejects.toBeInstanceOf(OpenerError);
    const relativeError = (await relative.catch((caught: unknown) => caught)) as OpenerError;
    expect(relativeError.code).toBe(OPENER_ERROR_CODES.targetInvalid);
    expect(relativeError.details).toEqual({ reason: "relative" });

    expect(transport.frames).toHaveLength(0);
  });

  it("rejects blocked schemes typed with the scheme in details and zero dispatch", async () => {
    const transport = new ScriptedTransport();
    const opener = attachTestOpener("darwin", transport);

    for (const [target, scheme] of [
      ["ssh://host.example", "ssh"],
      ["chrome://settings", "chrome"],
      // The URL parser lowercases the scheme — details carry the canonical
      // lowercase form (isomorphic with the native side's lowercased scan).
      ["CHROME://settings", "chrome"],
      ["ftp://example.com/file", "ftp"],
      ["javascript:alert(1)", "javascript"],
    ] as const) {
      const rejection = opener.open(target);
      await expect(rejection).rejects.toBeInstanceOf(OpenerError);
      const error = (await rejection.catch((caught: unknown) => caught)) as OpenerError;
      expect(error.code).toBe(OPENER_ERROR_CODES.schemeBlocked);
      expect(error.details).toEqual({ scheme });
    }
    expect(transport.frames).toHaveLength(0);
  });

  it("accepts allowlist schemes case-insensitively (HTTPS://, MailTo:)", async () => {
    for (const target of ["HTTPS://example.com", "MailTo:user@example.com", "FILE:///tmp/x"]) {
      expect(preflightOpenTarget(target)).toBeNull();
    }
  });

  it("throws TypeError on malformed input or unknown options before any dispatch", async () => {
    const transport = new ScriptedTransport();
    const opener = attachTestOpener("darwin", transport);

    await expect(opener.open(123 as never)).rejects.toThrow(TypeError);
    await expect(opener.open("")).rejects.toThrow(TypeError);
    await expect(opener.open("/a", { app: "x" } as never)).rejects.toThrow(/no options/);
    await expect(
      opener.revealInFolder("/a", { select: true } as never)
    ).rejects.toThrow(/no options/);
    await expect(opener.revealInFolder(undefined as never)).rejects.toThrow(TypeError);

    expect(transport.frames).toHaveLength(0);
  });

  it("revealInFolder dispatches the raw absolute path after preflight", async () => {
    const transport = new ScriptedTransport([(frame) => immediateResult(frame.requestId)]);
    const opener = attachTestOpener("darwin", transport);

    await opener.revealInFolder("/tmp/report.txt");

    expect(transport.frames[1]).toMatchObject({
      data: { type: "revealInFolder", path: "/tmp/report.txt" },
    });
  });

  it("revealInFolder rejects relative, drive-relative, and rejection-set members typed with zero dispatch", async () => {
    const darwin = new ScriptedTransport();
    const darwinOpener = attachTestOpener("darwin", darwin);
    const win32 = new ScriptedTransport();
    const win32Opener = attachTestOpener("win32", win32);

    const cases: readonly [OpenerCapability, string, Record<string, unknown>][] = [
      [darwinOpener, "notes/todo.txt", { reason: "relative" }],
      [win32Opener, "notes\\todo.txt", { reason: "relative" }],
      [win32Opener, "C:file.txt", { reason: "drive-relative" }],
      // Frozen rejection set — reject-not-escape (quote first, then C0).
      [win32Opener, 'C:\\Users\\a\\"b\\c.txt', { reason: "path-quote" }],
      [win32Opener, 'C:\\a"\u0001b', { reason: "path-quote" }],
      [darwinOpener, "/tmp/a\u0000b", { reason: "path-control-char" }],
      [darwinOpener, "/tmp/a\u001fb", { reason: "path-control-char" }],
      [win32Opener, "C:\\x\ty", { reason: "path-control-char" }],
      [win32Opener, "C:\\x\r\ny", { reason: "path-control-char" }],
    ];
    for (const [opener, path, details] of cases) {
      const rejection = opener.revealInFolder(path);
      await expect(rejection).rejects.toBeInstanceOf(OpenerError);
      const error = (await rejection.catch((caught: unknown) => caught)) as OpenerError;
      expect(error.code, path).toBe(OPENER_ERROR_CODES.targetInvalid);
      expect(error.details, path).toEqual(details);
    }
    expect(darwin.frames).toHaveLength(0);
    expect(win32.frames).toHaveLength(0);
  });

  it("applies the trailing-separator trim law with the frozen root boundary (pure plan)", () => {
    // Exactly one separator trims when the trimmed result is still legal.
    expect(preflightRevealPath("/foo/", "darwin")).toEqual({ mode: "select", path: "/foo" });
    expect(preflightRevealPath("C:\\foo\\", "win32")).toEqual({ mode: "select", path: "C:\\foo" });
    expect(preflightRevealPath("C:\\foo/", "win32")).toEqual({ mode: "select", path: "C:\\foo" });
    expect(preflightRevealPath("\\\\server\\share\\file.txt\\", "win32")).toEqual({
      mode: "select",
      path: "\\\\server\\share\\file.txt",
    });
    expect(preflightRevealPath("\\\\?\\C:\\temp\\file.txt\\", "win32")).toEqual({
      mode: "select",
      path: "\\\\?\\C:\\temp\\file.txt",
    });
    // Doubles keep their remainder (exactly one trim); POSIX never trims a
    // backslash (legal filename character).
    expect(preflightRevealPath("/foo//", "darwin")).toEqual({ mode: "select", path: "/foo/" });
    expect(preflightRevealPath("/foo\\", "darwin")).toEqual({ mode: "select", path: "/foo\\" });
    expect(preflightRevealPath("C:\\foo\\\\", "win32")).toEqual({
      mode: "select",
      path: "C:\\foo\\",
    });
    // Roots are never trimmed: open-the-root semantics.
    expect(preflightRevealPath("/", "darwin")).toEqual({ mode: "open-root", root: "/" });
    expect(preflightRevealPath("C:\\", "win32")).toEqual({ mode: "open-root", root: "C:\\" });
    expect(preflightRevealPath("C:/", "win32")).toEqual({ mode: "open-root", root: "C:/" });
    expect(preflightRevealPath("\\\\server\\share\\", "win32")).toEqual({
      mode: "open-root",
      root: "\\\\server\\share\\",
    });
    expect(preflightRevealPath("\\\\?\\C:\\", "win32")).toEqual({
      mode: "open-root",
      root: "\\\\?\\C:\\",
    });
    expect(preflightRevealPath("\\\\?\\UNC\\server\\share\\", "win32")).toEqual({
      mode: "open-root",
      root: "\\\\?\\UNC\\server\\share\\",
    });
    // A trim that lands ON a root keeps open-the-root semantics (POSIX //).
    expect(preflightRevealPath("//", "darwin")).toEqual({ mode: "open-root", root: "/" });
    // A bare share without a trailing separator selects (nothing to trim).
    expect(preflightRevealPath("\\\\server\\share", "win32")).toEqual({
      mode: "select",
      path: "\\\\server\\share",
    });
  });

  it("rejects every method on linux with a typed platform error before load", async () => {
    const transport = new ScriptedTransport();
    const opener = attachTestOpener("linux", transport);

    const rejections: readonly Promise<unknown>[] = [
      opener.open("https://example.com"),
      opener.revealInFolder("/tmp/a.txt"),
      opener.getBackend(),
    ];
    for (const rejection of rejections) {
      await expect(rejection).rejects.toMatchObject({
        code: OPENER_ERROR_CODES.platformUnsupported,
        details: { kind: "platform", platform: "linux" },
      });
    }
    expect(transport.frames).toHaveLength(0);
  });

  it("requires the immediate path: a deferred terminal is a wire contract violation", async () => {
    const transport = new ScriptedTransport([() => terminalResult()]);
    const opener = attachTestOpener("darwin", transport);

    await expect(opener.open("/tmp/a.txt")).rejects.toThrow(/immediate path/);
  });

  it("getBackend lazily requests the DTO once and returns one immutable frozen snapshot", async () => {
    const transport = new ScriptedTransport([
      (frame) => backendEventResult(DARWIN_BACKEND, frame.requestId),
    ]);
    const opener = attachTestOpener("darwin", transport);

    const first = await opener.getBackend();
    const second = await opener.getBackend();

    expect(first).toBe(second);
    expect(first).toEqual(DARWIN_BACKEND);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.allowedSchemes)).toBe(true);
    expect(transport.frames).toHaveLength(2);
    expect(transport.frames[1]).toMatchObject({
      type: "ext-command",
      data: { type: "getBackend" },
    });
  });

  it("getBackend consumes the ABI-shaped backend event on both platforms (round-trip fixture)", async () => {
    const darwin = new ScriptedTransport([
      (frame) => abiShapedBackendEvent(DARWIN_BACKEND, frame.requestId),
    ]);
    const darwinOpener = attachTestOpener("darwin", darwin);
    await expect(darwinOpener.getBackend()).resolves.toEqual(DARWIN_BACKEND);

    const win32 = new ScriptedTransport([
      (frame) => abiShapedBackendEvent(WIN32_BACKEND, frame.requestId),
    ]);
    const win32Opener = attachTestOpener("win32", win32);
    await expect(win32Opener.getBackend()).resolves.toEqual(WIN32_BACKEND);
  });

  it("getBackend rejects a missing payload or a platform-mismatched DTO", async () => {
    const missing = new ScriptedTransport([(frame) => immediateResult(frame.requestId)]);
    const missingOpener = attachTestOpener("darwin", missing);
    await expect(missingOpener.getBackend()).rejects.toThrow(/wire contract violation/);

    const mismatch = new ScriptedTransport([
      (frame) => backendEventResult(WIN32_BACKEND, frame.requestId),
    ]);
    const mismatchOpener = attachTestOpener("darwin", mismatch);
    await expect(mismatchOpener.getBackend()).rejects.toThrow(/reported platform win32/);
  });

  it("normalizes transport errors with opener codes and passes others through", async () => {
    const transport = new ScriptedTransport([
      () => {
        // The frozen win32 opener_failed details shape: ShellExecuteW
        // returned SE_ERR_NOASSOC (31) — the integer plus the mapped
        // reason surface as-is through the typed facade error.
        throw new ExtensionOperationError("opener_failed", "ShellExecuteW rejected the target", {
          details: { shellExecuteResult: 31, reason: "noassoc" },
        });
      },
      () => {
        // A transport-delivered typed rejection on a LEGAL target (the
        // facade preflight never sees this — the broker produced it).
        throw new BrokerServerError("opener_target_invalid", "broker rejection", {
          details: { reason: "path-quote" },
        });
      },
      () => {
        throw new ExtensionOperationError(
          "extension_transport_closed",
          "the broker transport closed while an extension operation was pending"
        );
      },
    ]);
    const opener = attachTestOpener("win32", transport);

    const failed = opener.open("C:\\x.xyz");
    await expect(failed).rejects.toBeInstanceOf(OpenerError);
    const failedError = (await failed.catch((caught: unknown) => caught)) as OpenerError;
    expect(failedError.code).toBe(OPENER_ERROR_CODES.failed);
    expect(failedError.details).toEqual({ shellExecuteResult: 31, reason: "noassoc" });

    const invalid = opener.open("C:\\ok.txt");
    await expect(invalid).rejects.toBeInstanceOf(OpenerError);
    const invalidError = (await invalid.catch((caught: unknown) => caught)) as OpenerError;
    expect(invalidError.code).toBe(OPENER_ERROR_CODES.targetInvalid);
    expect(invalidError.details).toEqual({ reason: "path-quote" });

    // The shared transport-close code surfaces unchanged (no opener alias).
    const transportRejection = opener.open("C:\\ok2.txt");
    await expect(transportRejection).rejects.toMatchObject({
      code: "extension_transport_closed",
    });
  });

  it("maps an embedded target-unsupported artifact failure to the typed platform error", async () => {
    const transport = new ScriptedTransport([
      () => {
        throw new NativeExtensionEmbeddedArtifactError(
          "target-unsupported",
          "no library staged for this platform",
          { target: "darwin-arm64" }
        );
      },
    ]);
    const opener = attachTestOpener("darwin", transport);

    const rejection = opener.open("/tmp/a.txt");
    await expect(rejection).rejects.toBeInstanceOf(OpenerError);
    const error = (await rejection.catch((caught: unknown) => caught)) as OpenerError;
    expect(error.code).toBe(OPENER_ERROR_CODES.platformUnsupported);
    expect(error.details).toEqual({ kind: "platform", platform: "darwin" });
  });
});

describe("@opentray/spec schema guards (task 2.1, exercised from this facade)", () => {
  it("freezes the v1 allowlist tuple and matches schemes case-insensitively", () => {
    expect(OPENER_ALLOWED_SCHEMES).toEqual(["http", "https", "file", "mailto"]);
    for (const scheme of OPENER_ALLOWED_SCHEMES) {
      expect(isOpenerAllowedScheme(scheme)).toBe(true);
      expect(isOpenerAllowedScheme(scheme.toUpperCase())).toBe(true);
    }
    for (const scheme of ["ssh", "chrome", "ftp", "javascript", ""]) {
      expect(isOpenerAllowedScheme(scheme)).toBe(false);
    }
  });

  it("freezes the four typed error codes and the matcher", () => {
    expect(OPENER_ERROR_CODES).toEqual({
      platformUnsupported: "opener_platform_unsupported",
      targetInvalid: "opener_target_invalid",
      schemeBlocked: "opener_scheme_blocked",
      failed: "opener_failed",
    });
    for (const code of Object.values(OPENER_ERROR_CODES)) {
      expect(isOpenerErrorCode(code)).toBe(true);
    }
    expect(isOpenerErrorCode("opener_mystery")).toBe(false);
    expect(isOpenerErrorCode("sound_not_found")).toBe(false);
  });

  it("validates complete backend DTOs and rejects drift", () => {
    expect(isOpenerBackendCapabilities(DARWIN_BACKEND)).toBe(true);
    expect(isOpenerBackendCapabilities(WIN32_BACKEND)).toBe(true);
    // Platform drift, scheme-list drift, missing fields, and wrong types.
    expect(isOpenerBackendCapabilities({ ...DARWIN_BACKEND, platform: "linux" })).toBe(false);
    expect(
      isOpenerBackendCapabilities({
        ...DARWIN_BACKEND,
        allowedSchemes: ["http", "https", "file", "ssh"],
      })
    ).toBe(false);
    expect(isOpenerBackendCapabilities({ ...WIN32_BACKEND, supportsRevealInFolder: false })).toBe(
      false
    );
    expect(isOpenerBackendCapabilities({ platform: "darwin" })).toBe(false);
    expect(isOpenerBackendCapabilities(null)).toBe(false);
    expect(isOpenerBackendCapabilities("darwin")).toBe(false);
  });
});

describe("preflight matrix (pure shared helpers)", () => {
  it("classifies the frozen absolute-path forms", () => {
    for (const target of [
      "/tmp/report.txt",
      "/",
      "C:\\Users\\a\\b.txt",
      "C:/Users/a/b.txt",
      "z:\\lower-drive.txt",
      "\\\\server\\share\\file.txt",
      "\\\\server\\share\\",
      "\\\\?\\C:\\temp\\file.txt",
      "\\\\?\\UNC\\server\\share\\file.txt",
    ]) {
      expect(classifyOpenerTarget(target), target).toEqual({ kind: "absolute-path" });
      expect(preflightOpenTarget(target), target).toBeNull();
    }
  });

  it("classifies drive-relative before URL interpretation and relative strings last", () => {
    expect(classifyOpenerTarget("C:file.txt")).toEqual({ kind: "drive-relative" });
    expect(classifyOpenerTarget("C:")).toEqual({ kind: "drive-relative" });
    expect(classifyOpenerTarget("relative/file.txt")).toEqual({ kind: "relative" });
    expect(classifyOpenerTarget("file.txt")).toEqual({ kind: "relative" });
    expect(classifyOpenerTarget("")).toEqual({ kind: "relative" });
    expect(classifyOpenerTarget("a b c")).toEqual({ kind: "relative" });
    // No scheme without a colon; a digit-leading prefix is not a scheme.
    expect(classifyOpenerTarget("https")).toEqual({ kind: "relative" });
    expect(classifyOpenerTarget("1https://x")).toEqual({ kind: "relative" });
    expect(classifyOpenerTarget("ht tps://x")).toEqual({ kind: "relative" });
  });

  it("classifies URLs through new URL() with the canonical lowercased scheme", () => {
    expect(classifyOpenerTarget("https://example.com")).toEqual({
      kind: "url",
      scheme: "https",
    });
    expect(classifyOpenerTarget("HTTPS://example.com")).toEqual({
      kind: "url",
      scheme: "https",
    });
    expect(classifyOpenerTarget("MailTo:user@example.com")).toEqual({
      kind: "url",
      scheme: "mailto",
    });
    expect(classifyOpenerTarget("file:///tmp/report.txt")).toEqual({
      kind: "url",
      scheme: "file",
    });
    // WHATWG pre-parse margin trim: new URL() parses through the
    // surrounding whitespace; the raw target still dispatches verbatim.
    expect(classifyOpenerTarget("  https://example.com  ")).toEqual({
      kind: "url",
      scheme: "https",
    });
    // Multi-letter schemes (blocked by the allowlist, still URLs) and
    // scheme-grammar continuation characters.
    expect(classifyOpenerTarget("ab:x")).toEqual({ kind: "url", scheme: "ab" });
    expect(classifyOpenerTarget("https+x://h")).toEqual({ kind: "url", scheme: "https+x" });
    expect(preflightOpenTarget("ab:x")).toBeInstanceOf(OpenerError);
    expect(preflightOpenTarget("https+x://h")).toBeInstanceOf(OpenerError);
  });
});
