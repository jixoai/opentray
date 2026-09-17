// Orthogonal intents (2026-09-17; add-ext-sound task 4.3):
// 1. Resolution-order matrix: common-name table hit projects to the frozen
//    platform constant, miss passes through as a native name, native miss
//    rejects typed sound_not_found with a details payload.
// 2. win32 WAV content-validation matrix over byte fixtures (pure validator):
//    header-only, u32::MAX declared, declared-8 boundary, odd pad, fmt-only,
//    data-only, chunk past declared vs past physical, disguised MP3,
//    truncated, size cap, case-extension.
// 3. Facade preflight (paths, readability, options) and the embedded
//    descriptor over the frozen four-target staging matrix.

import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { realpath } from "node:fs/promises";
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
  attachSound,
  SoundError,
  SoundExt,
  SOUND_ERROR_CODES,
  SOUND_NATIVE_ARTIFACT,
  type SoundBackendCapabilities,
  type SoundCapability,
} from "./index";
import {
  expandHomeDirectory,
  validateWavBytes,
  WAV_MAX_BYTES,
  WAV_MIN_BYTES,
} from "./shared";

const TEST_EXPECTED_IDENTITY = {
  extensionName: "sound",
  artifactSetVersion: "test",
  contractFingerprint: "sound-test-contract",
  target: { os: process.platform, arch: process.arch },
} satisfies NativeExtensionExpectedIdentity;
const TEST_NATIVE_ARTIFACT = {
  kind: "file",
  path: fileURLToPath(import.meta.url),
  expectedIdentity: TEST_EXPECTED_IDENTITY,
} as const;

const MOUNT_ID = "sound.tray-1";

const DARWIN_BACKEND: SoundBackendCapabilities = {
  platform: "darwin",
  systemSoundCatalog: true,
  playFile: true,
  fileFormats: ["wav", "aiff", "mp3", "m4a"],
};

const WIN32_BACKEND: SoundBackendCapabilities = {
  platform: "win32",
  systemSoundCatalog: true,
  playFile: true,
  fileFormats: ["wav"],
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

const attachTestSound = (
  platform: "darwin" | "win32" | "linux",
  transport: ScriptedTransport
): SoundCapability =>
  attachSound(createTrayHandle(transport, "app-1", "tray-1"), {
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
  backend: SoundBackendCapabilities,
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
 * crate emits for getBackend (sound review R1 P1 — the previous mocked
 * shape masked a native/facade contract mismatch; this fixture pins the
 * real one). */
const abiShapedBackendEvent = (
  backend: SoundBackendCapabilities,
  requestId: RequestId
): ServerFrame => {
  type BackendEvent = ReturnType<typeof backendEventResult>["events"][number];
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

/** Exactly one deferred terminal — sound must never settle through this shape. */
const terminalResult = (): ServerFrame => ({
  type: "ext-operation-terminal",
  operationId: "0123456789abcdef",
  payload: { kind: "result", value: null },
});

// ---------------------------------------------------------------------------
// WAV byte fixtures (design reference section 1.3 frozen arithmetic)
// ---------------------------------------------------------------------------

const u32le = (value: number): Buffer => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
};

const riffHeader = (declared: number, form = "WAVE"): Buffer =>
  Buffer.concat([Buffer.from("RIFF", "ascii"), u32le(declared), Buffer.from(form, "ascii")]);

const chunk = (id: string, payload: Buffer): Buffer =>
  Buffer.concat([
    Buffer.from(id, "ascii"),
    u32le(payload.length),
    payload,
    ...(payload.length % 2 === 1 ? [Buffer.from([0])] : []),
  ]);

const FMT_PAYLOAD = Buffer.alloc(16, 0x01);

/** fmt(16) + data(4): declared covers "WAVE" + both chunks; total 48 bytes. */
const validWav = (): Buffer =>
  Buffer.concat([riffHeader(4 + (8 + 16) + (8 + 4)), chunk("fmt ", FMT_PAYLOAD), chunk("data", Buffer.alloc(4, 0x02))]);

const wavWith = (parts: readonly Buffer[], declared: number, form = "WAVE", suffix: Buffer = Buffer.alloc(0)): Buffer =>
  Buffer.concat([riffHeader(declared, form), ...parts, suffix]);

const makeTempDir = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "opentray-sound-"));

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("@opentray/ext-sound", () => {
  it("declares the embedded artifact over the frozen four-target staging matrix", () => {
    expect(SOUND_NATIVE_ARTIFACT.kind).toBe("embedded");
    expect(SOUND_NATIVE_ARTIFACT.targets).toEqual({
      "darwin-arm64": {
        libraryPath: "platforms/darwin-arm64/libopentray_ext_sound.dylib",
      },
      "darwin-x64": {
        libraryPath: "platforms/darwin-x64/libopentray_ext_sound.dylib",
      },
      "win32-arm64": {
        libraryPath: "platforms/win32-arm64/opentray_ext_sound.dll",
      },
      "win32-x64": {
        libraryPath: "platforms/win32-x64/opentray_ext_sound.dll",
      },
    });
    expect(SOUND_NATIVE_ARTIFACT.packageJsonUrl).toContain("ext-sound/package.json");
    expect(SOUND_NATIVE_ARTIFACT.contractManifestUrl).toContain("ext-sound/contract.json");
    expect(SoundExt.name).toBe("sound");
    expect(SoundExt.artifact).toBe(SOUND_NATIVE_ARTIFACT);
  });

  it("emits load-ext with expectedIdentity, then camelCase immediate ext-commands for beep", async () => {
    const transport = new ScriptedTransport([
      (frame) => immediateResult(frame.requestId),
      (frame) => immediateResult(frame.requestId),
    ]);
    const sound = attachTestSound("darwin", transport);

    await sound.beep();
    await sound.beep("question");

    expect(transport.frames).toEqual([
      {
        type: "load-ext",
        requestId: "opentray-1",
        appId: "app-1",
        name: "sound",
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
        data: { type: "beep", kind: "default" },
      },
      {
        type: "ext-command",
        requestId: "opentray-3",
        appId: "app-1",
        trayId: "tray-1",
        ext: MOUNT_ID,
        data: { type: "beep", kind: "question" },
      },
    ]);
  });

  it("throws TypeError on an invalid beep kind before any dispatch", async () => {
    const transport = new ScriptedTransport();
    const sound = attachTestSound("darwin", transport);

    await expect(sound.beep("loud" as never)).rejects.toThrow(TypeError);
    expect(transport.frames).toHaveLength(0);
  });

  it("resolves common system sound names through the frozen projection table", async () => {
    const darwin = new ScriptedTransport([
      (frame) => immediateResult(frame.requestId),
      (frame) => immediateResult(frame.requestId),
    ]);
    const darwinSound = attachTestSound("darwin", darwin);
    await darwinSound.playSystemSound("notification");
    await darwinSound.playSystemSound("warning");

    const win32 = new ScriptedTransport([
      (frame) => immediateResult(frame.requestId),
      (frame) => immediateResult(frame.requestId),
    ]);
    const win32Sound = attachTestSound("win32", win32);
    await win32Sound.playSystemSound("notification");
    await win32Sound.playSystemSound("error");

    expect(darwin.frames[1]).toMatchObject({ data: { type: "playSystemSound", name: "Glass" } });
    expect(darwin.frames[2]).toMatchObject({ data: { type: "playSystemSound", name: "Sosumi" } });
    expect(win32.frames[1]).toMatchObject({
      data: { type: "playSystemSound", name: "SystemAsterisk" },
    });
    expect(win32.frames[2]).toMatchObject({
      data: { type: "playSystemSound", name: "SystemHand" },
    });
  });

  it("passes unknown names through as platform-native sound names", async () => {
    const darwin = new ScriptedTransport([(frame) => immediateResult(frame.requestId)]);
    const win32 = new ScriptedTransport([(frame) => immediateResult(frame.requestId)]);
    const darwinSound = attachTestSound("darwin", darwin);
    const win32Sound = attachTestSound("win32", win32);

    await darwinSound.playSystemSound("Basso");
    await win32Sound.playSystemSound("SystemQuestion");

    expect(darwin.frames[1]).toMatchObject({ data: { type: "playSystemSound", name: "Basso" } });
    expect(win32.frames[1]).toMatchObject({
      data: { type: "playSystemSound", name: "SystemQuestion" },
    });
  });

  it("surfaces a native miss as typed sound_not_found with backend details as-is", async () => {
    const transport = new ScriptedTransport([
      () => {
        throw new ExtensionOperationError("sound_not_found", "no such system sound", {
          details: {
            kind: "not-found",
            requested: "Funk",
            platform: "darwin",
            attempted: ["platform-catalog"],
          },
        });
      },
    ]);
    const sound = attachTestSound("darwin", transport);

    const rejection = sound.playSystemSound("Funk");
    await expect(rejection).rejects.toBeInstanceOf(SoundError);
    const error = (await rejection.catch((caught: unknown) => caught)) as SoundError;
    expect(error.code).toBe(SOUND_ERROR_CODES.notFound);
    expect(error.details).toEqual({
      kind: "not-found",
      requested: "Funk",
      platform: "darwin",
      attempted: ["platform-catalog"],
    });
  });

  it("fills the not-found details payload when the backend miss carries no details", async () => {
    const passthrough = new ScriptedTransport([
      () => {
        throw new ExtensionOperationError("sound_not_found", "miss");
      },
    ]);
    const passthroughSound = attachTestSound("darwin", passthrough);
    const passthroughRejection = passthroughSound.playSystemSound("Funk");
    await expect(passthroughRejection).rejects.toBeInstanceOf(SoundError);
    const passthroughError = (await passthroughRejection.catch(
      (caught: unknown) => caught
    )) as SoundError;
    expect(passthroughError.details).toEqual({
      kind: "not-found",
      requested: "Funk",
      platform: "darwin",
      attempted: ["platform-catalog"],
    });

    const commonTable = new ScriptedTransport([
      () => {
        throw new ExtensionOperationError("sound_not_found", "miss");
      },
    ]);
    const commonTableSound = attachTestSound("win32", commonTable);
    const commonRejection = commonTableSound.playSystemSound("notification");
    await expect(commonRejection).rejects.toBeInstanceOf(SoundError);
    const commonError = (await commonRejection.catch((caught: unknown) => caught)) as SoundError;
    expect(commonError.details).toEqual({
      kind: "not-found",
      requested: "notification",
      platform: "win32",
      attempted: ["common-table", "platform-catalog"],
    });
  });

  it("normalizes synchronous broker errors with sound codes and passes others through", async () => {
    const transport = new ScriptedTransport([
      () => {
        throw new BrokerServerError("sound_format_unsupported", "broker rejection", {
          details: { kind: "format", path: "/tmp/x.wav", reason: "riff-magic" },
        });
      },
      () => {
        throw new ExtensionOperationError(
          "extension_transport_closed",
          "the broker transport closed while an extension operation was pending"
        );
      },
    ]);
    const sound = attachTestSound("win32", transport);

    // Any sound-coded {code, message, details} error family normalizes to SoundError.
    const rejection = sound.playSystemSound("notification");
    await expect(rejection).rejects.toBeInstanceOf(SoundError);
    const error = (await rejection.catch((caught: unknown) => caught)) as SoundError;
    expect(error.code).toBe(SOUND_ERROR_CODES.formatUnsupported);
    expect(error.details).toEqual({ kind: "format", path: "/tmp/x.wav", reason: "riff-magic" });

    // The shared transport-close code surfaces unchanged (no sound transport alias).
    const transportRejection = sound.playSystemSound("notification");
    await expect(transportRejection).rejects.toMatchObject({
      code: "extension_transport_closed",
    });
  });

  it("rejects every method on linux with a typed platform error before load", async () => {
    const transport = new ScriptedTransport();
    const sound = attachTestSound("linux", transport);

    const rejections: readonly Promise<unknown>[] = [
      sound.beep(),
      sound.playSystemSound("notification"),
      sound.playSound("/tmp/any.wav"),
      sound.getBackend(),
    ];
    for (const rejection of rejections) {
      await expect(rejection).rejects.toMatchObject({
        code: SOUND_ERROR_CODES.platformUnsupported,
        details: { kind: "platform", platform: "linux" },
      });
    }
    expect(transport.frames).toHaveLength(0);
  });

  it("requires the immediate path: a deferred terminal is a wire contract violation", async () => {
    const transport = new ScriptedTransport([() => terminalResult()]);
    const sound = attachTestSound("darwin", transport);

    await expect(sound.beep()).rejects.toThrow(/immediate path/);
  });

  it("getBackend lazily requests the DTO once and returns one immutable snapshot", async () => {
    const transport = new ScriptedTransport([
      (frame) => backendEventResult(DARWIN_BACKEND, frame.requestId),
    ]);
    const sound = attachTestSound("darwin", transport);

    const first = await sound.getBackend();
    const second = await sound.getBackend();

    expect(first).toBe(second);    expect(first).toBe(second);

    // ABI boundary (sound review R1 P1): the facade must consume the exact
    // immediate-event JSON the native crate emits — the mocked helper alone
    // had masked a native/facade shape mismatch.
    const abiTransport = new ScriptedTransport([
      (frame) => abiShapedBackendEvent(WIN32_BACKEND, frame.requestId),
    ]);
    const abiSound = attachTestSound("win32", abiTransport);
    await expect(abiSound.getBackend()).resolves.toEqual(WIN32_BACKEND);
    const mismatchTransport = new ScriptedTransport([
      (frame) =>
        ({
          ...backendEventResult(WIN32_BACKEND, frame.requestId),
          events: [
            {
              scope: { appId: "app-1", trayId: "tray-1", ext: MOUNT_ID },
              data: { type: "result", op: "getBackend", backend: WIN32_BACKEND },
            },
          ],
        }) as ReturnType<typeof backendEventResult>,
    ]);
    const mismatchSound = attachTestSound("win32", mismatchTransport);
    await expect(mismatchSound.getBackend()).rejects.toThrow();
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.fileFormats)).toBe(true);
    expect(first).toEqual(DARWIN_BACKEND);
    expect(transport.frames).toHaveLength(2);
    expect(transport.frames[1]).toMatchObject({
      type: "ext-command",
      data: { type: "getBackend" },
    });
  });

  it("getBackend rejects a missing payload or a platform-mismatched DTO", async () => {
    const missing = new ScriptedTransport([(frame) => immediateResult(frame.requestId)]);
    const missingSound = attachTestSound("darwin", missing);
    await expect(missingSound.getBackend()).rejects.toThrow(/wire contract violation/);

    const mismatch = new ScriptedTransport([
      (frame) => backendEventResult(WIN32_BACKEND, frame.requestId),
    ]);
    const mismatchSound = attachTestSound("darwin", mismatch);
    await expect(mismatchSound.getBackend()).rejects.toThrow(/reported platform win32/);
  });

  it("playSound dispatches a canonical absolute path after readability preflight", async () => {
    const dir = await makeTempDir();
    tempDirs.push(dir);
    const filePath = join(dir, "tone.wav");
    await writeFile(filePath, validWav());
    const canonical = await realpath(filePath);
    const relativePath = relative(process.cwd(), filePath);

    const darwin = new ScriptedTransport([(frame) => immediateResult(frame.requestId)]);
    const darwinSound = attachTestSound("darwin", darwin);
    // darwin: any readable file dispatches (no content validation; bytes are not a WAV matter there).
    await writeFile(join(dir, "noise.bin"), Buffer.from("not a wav at all, plenty long"));
    await darwinSound.playSound(join(dir, "noise.bin"));

    const win32 = new ScriptedTransport([(frame) => immediateResult(frame.requestId)]);
    const win32Sound = attachTestSound("win32", win32);
    // Relative paths resolve against cwd; win32 requires the WAV structure.
    await win32Sound.playSound(relativePath);

    expect(darwin.frames[1]).toMatchObject({
      data: { type: "playSound", path: await realpath(join(dir, "noise.bin")) },
    });
    expect(win32.frames[1]).toMatchObject({
      data: { type: "playSound", path: canonical },
    });
  });

  it("rejects an unreadable file typed before any dispatch", async () => {
    const transport = new ScriptedTransport();
    const sound = attachTestSound("darwin", transport);

    await expect(sound.playSound("/definitely/not/there/tone.wav")).rejects.toMatchObject({
      code: SOUND_ERROR_CODES.fileUnreadable,
      details: { kind: "unreadable", path: "/definitely/not/there/tone.wav" },
    });
    expect(transport.frames).toHaveLength(0);
  });

  it("rejects win32 files that are not structurally WAV, whatever the extension says", async () => {
    const dir = await makeTempDir();
    tempDirs.push(dir);

    const mp3Disguised = join(dir, "tone.wav");
    await writeFile(mp3Disguised, Buffer.concat([Buffer.from("ID3\x04\x00\x00\x00\x00\x0f\x11"), Buffer.alloc(16)]));
    const truncated = join(dir, "truncated.wav");
    await writeFile(truncated, validWav().subarray(0, 11));
    const headerOnly = join(dir, "header-only.wav");
    await writeFile(headerOnly, riffHeader(4));

    const transport = new ScriptedTransport();
    const sound = attachTestSound("win32", transport);

    await expect(sound.playSound(mp3Disguised)).rejects.toMatchObject({
      code: SOUND_ERROR_CODES.formatUnsupported,
      details: { kind: "format", path: await realpath(mp3Disguised), reason: "riff-magic" },
    });
    await expect(sound.playSound(truncated)).rejects.toMatchObject({
      details: { reason: "too-small" },
    });
    await expect(sound.playSound(headerOnly)).rejects.toMatchObject({
      details: { reason: "fmt-missing" },
    });
    expect(transport.frames).toHaveLength(0);
  });

  it("accepts a win32 WAV regardless of extension case and rejects unknown options", async () => {
    const dir = await makeTempDir();
    tempDirs.push(dir);
    const upperCase = join(dir, "tone.WAV");
    await writeFile(upperCase, validWav());

    const transport = new ScriptedTransport([(frame) => immediateResult(frame.requestId)]);
    const sound = attachTestSound("win32", transport);

    await expect(sound.playSound(upperCase)).resolves.toBeUndefined();
    expect(transport.frames[1]).toMatchObject({
      data: { type: "playSound", path: await realpath(upperCase) },
    });

    await expect(
      sound.playSound(upperCase, { volume: 0.5 } as never)
    ).rejects.toThrow(TypeError);
    expect(transport.frames).toHaveLength(2);
  });
});

describe("win32 WAV validator (pure byte fixtures)", () => {
  it("accepts a minimal fmt+data file and an odd-sized data chunk with its pad byte", () => {
    expect(validateWavBytes(validWav())).toBeNull();

    // data payload of 3 bytes carries 1 pad byte; declared (and physical) cover the pad.
    const oddData = wavWith(
      [chunk("fmt ", FMT_PAYLOAD), chunk("data", Buffer.alloc(3, 0x02))],
      4 + (8 + 16) + (8 + 3 + 1)
    );
    expect(validateWavBytes(oddData)).toBeNull();
  });

  it("rejects a truncated file below the 12-byte header floor", () => {
    expect(validateWavBytes(validWav().subarray(0, 11))).toBe("too-small");
    expect(validateWavBytes(Buffer.alloc(0))).toBe("too-small");
    expect(WAV_MIN_BYTES).toBe(12);
  });

  it("rejects files above the 64 MiB cap before any magic parsing", () => {
    expect(WAV_MAX_BYTES).toBe(64 * 1024 * 1024);
    // All-zero bytes prove the size branch fires before the RIFF magic check.
    expect(validateWavBytes(Buffer.alloc(WAV_MAX_BYTES + 1))).toBe("size-cap");

  });

  // Bounded streamed read (sound review R1 P1 TOCTOU): the facade must
  // reject an over-cap FILE through the open-once bounded loop — never a
  // pre-read stat — and an exactly-cap file must flow through to byte
  // validation (proving the loop does not cut the boundary short).
  it("streams the win32 WAV cap from the file handle, not a pre-read stat", async () => {
    const dir = await makeTempDir();
    tempDirs.push(dir);
    const oversized = join(dir, "oversized.wav");
    const handle = await open(oversized, "w");
    await handle.write(Buffer.alloc(WAV_MIN_BYTES)); // real bytes at the head
    await handle.truncate(WAV_MAX_BYTES + 2); // sparse tail past the cap
    await handle.close();
    const transport = new ScriptedTransport();
    const sound = attachTestSound("win32", transport);
    await expect(sound.playSound(oversized)).rejects.toMatchObject({
      code: SOUND_ERROR_CODES.formatUnsupported,
      details: { kind: "format", reason: "size-cap" },
    });
    expect(transport.frames).toHaveLength(0);

    const exactCap = join(dir, "exact-cap.wav");
    const exactHandle = await open(exactCap, "w");
    await exactHandle.write(Buffer.alloc(WAV_MAX_BYTES)); // exactly the cap, not a WAV
    await exactHandle.close();
    await expect(sound.playSound(exactCap)).rejects.toMatchObject({
      code: SOUND_ERROR_CODES.formatUnsupported,
      details: { kind: "format", reason: "riff-magic" },
    });
  });

  it("rejects missing RIFF and WAVE magic (including disguised MP3 payloads)", () => {
    expect(
      validateWavBytes(wavWith([chunk("fmt ", FMT_PAYLOAD)], 4 + 8 + 16, "AVI "))
    ).toBe("wave-magic");
    expect(
      validateWavBytes(
        Buffer.concat([Buffer.from("RIFX", "ascii"), u32le(40), Buffer.from("WAVE", "ascii"), Buffer.alloc(36)])
      )
    ).toBe("riff-magic");
    // ID3-tagged MP3 and a raw MPEG audio frame both fail the RIFF probe.
    expect(
      validateWavBytes(Buffer.concat([Buffer.from("ID3\x04\x00\x00\x00\x00\x0f\x11"), Buffer.alloc(16)]))
    ).toBe("riff-magic");
    expect(
      validateWavBytes(Buffer.concat([Buffer.from([0xff, 0xfb]), Buffer.alloc(32)]))
    ).toBe("riff-magic");
  });

  it("rejects a declared size that overflows the physical bytes (u32::MAX included)", () => {
    expect(validateWavBytes(Buffer.concat([Buffer.from("RIFF", "ascii"), u32le(0xffffffff), Buffer.from("WAVE", "ascii")]))).toBe(
      "declared-size"
    );
    // One byte more declared than physically present fails.
    const oneOver = validWav();
    expect(validateWavBytes(oneOver.subarray(0, oneOver.length - 1))).toBe("declared-size");
  });

  it("accepts the declared-8 boundary exactly and legal trailing bytes", () => {
    // declared + 8 == actual exactly.
    expect(validateWavBytes(validWav())).toBeNull();
    // Physical trailing bytes beyond the declared region are legal RIFF.
    const withTrailer = wavWith(
      [chunk("fmt ", FMT_PAYLOAD), chunk("data", Buffer.alloc(4, 0x02))],
      4 + (8 + 16) + (8 + 4),
      "WAVE",
      Buffer.from("ID3 trailer bytes", "ascii")
    );
    expect(validateWavBytes(withTrailer)).toBeNull();
  });

  it("rejects a chunk (with odd pad) that escapes the declared region", () => {
    // Odd pad pushes the chunk end one byte past declaredEnd.
    const oddPadOver = wavWith(
      [chunk("fmt ", FMT_PAYLOAD), chunk("data", Buffer.alloc(3, 0x02))],
      4 + (8 + 16) + (8 + 3)
    );
    expect(validateWavBytes(oddPadOver)).toBe("chunk-bounds");
    // Even-size chunk extending past declaredEnd by one byte.
    const over = wavWith(
      [chunk("fmt ", FMT_PAYLOAD), chunk("data", Buffer.alloc(5, 0x02))],
      4 + (8 + 16) + (8 + 4)
    );
    expect(validateWavBytes(over)).toBe("chunk-bounds");
    // Truncated chunk header inside the declared region: the stray bytes are
    // physically present and declared, but less than a full 8-byte chunk header.
    const truncatedHeader = wavWith(
      [chunk("fmt ", FMT_PAYLOAD), Buffer.from("dat", "ascii")],
      4 + (8 + 16) + 3
    );
    expect(validateWavBytes(truncatedHeader)).toBe("chunk-bounds");
  });

  it("distinguishes a chunk past declared-but-within-physical from a chunk past physical", () => {
    // Past declared, within physical: the declared region covers fmt plus the
    // data chunk header, but not its payload; the bytes are all physically present.
    const pastDeclared = wavWith(
      [chunk("fmt ", FMT_PAYLOAD), chunk("data", Buffer.alloc(4, 0x02))],
      4 + (8 + 16) + 8
    );
    expect(validateWavBytes(pastDeclared)).toBe("chunk-bounds");

    // Past physical: declared covers a data chunk whose bytes are not in the file.
    const pastPhysical = Buffer.concat([
      riffHeader(4 + (8 + 16) + (8 + 8)),
      chunk("fmt ", FMT_PAYLOAD),
      Buffer.from("data", "ascii"),
      u32le(8),
      Buffer.alloc(4, 0x02),
    ]);
    expect(validateWavBytes(pastPhysical)).toBe("declared-size");
  });

  it("requires both chunks: fmt-only, data-only, and header-only files reject", () => {
    expect(validateWavBytes(wavWith([chunk("fmt ", FMT_PAYLOAD)], 4 + 8 + 16))).toBe(
      "data-missing"
    );
    expect(validateWavBytes(wavWith([chunk("data", Buffer.alloc(4, 0x02))], 4 + 8 + 4))).toBe(
      "fmt-missing"
    );
    expect(validateWavBytes(riffHeader(4))).toBe("fmt-missing");
  });

  it("requires a fmt payload of at least 16 bytes", () => {
    expect(
      validateWavBytes(wavWith([chunk("fmt ", Buffer.alloc(15, 0x01)), chunk("data", Buffer.alloc(4, 0x02))], 4 + (8 + 15 + 1) + (8 + 4)))
    ).toBe("fmt-payload");
    expect(
      validateWavBytes(wavWith([chunk("fmt ", Buffer.alloc(16, 0x01)), chunk("data", Buffer.alloc(4, 0x02))], 4 + (8 + 16) + (8 + 4)))
    ).toBeNull();
  });
});

describe("shared pure helpers", () => {
  it("expands a leading tilde against the supplied home directory", () => {
    expect(expandHomeDirectory("~", "/home/u")).toBe("/home/u");
    expect(expandHomeDirectory("~/sounds/a.wav", "/home/u")).toBe(
      join("/home/u", "sounds/a.wav")
    );
    expect(expandHomeDirectory("/tmp/x.wav", "/home/u")).toBe("/tmp/x.wav");
    expect(expandHomeDirectory("~other/x.wav", "/home/u")).toBe("~other/x.wav");
  });
});
