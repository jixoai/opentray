// Orthogonal intents (2026-09-17; add-ext-sound tasks 4.1/4.2):
// 1. Attach the sound capability through the normal tray extension family
//    (tray.extend, session-scoped, isomorphic to attachDialog/attachBadge).
// 2. Fail every preflight branch before any transport use: typed platform
//    rejection on Linux, path canonicalization/readability, and the frozen
//    win32 WAV structural validator (no decoding, no silent fallback).
// 3. Dispatch beep/playSystemSound/playSound through the camelCase
//    ext-command envelope on the V2 immediate path (design reference section
//    1.4: fire-and-forget, no deferred operations, no operationId handling).

import { access, open, realpath } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, normalize as normalizePath } from "node:path";

import type {
  ExtensionRequestResult,
  NativeExtensionArtifact,
  TrayExtensionContext,
  TrayHandle,
} from "opentray";
import {
  BrokerServerError,
  ExtensionOperationError,
  NativeExtensionEmbeddedArtifactError,
} from "opentray";
import type { BeepKind, SoundBackendCapabilities, SystemSoundName } from "@opentray/spec";

import { SOUND_NATIVE_ARTIFACT } from "./native-artifact";
import {
  SOUND_ERROR_CODES,
  SoundError,
  attemptedModesForResolution,
  expandHomeDirectory,
  formatUnsupported,
  isSoundBackendEvent,
  isSoundErrorCode,
  platformUnsupported,
  resolveSystemSoundName,
  soundErrorFromDescriptor,
  fileUnreadable,
  validateWavBytes,
  WAV_MAX_BYTES,
  WAV_MIN_BYTES,
  type PlaySoundOptions,
  type SoundCommand,
  type SoundNativePlatform,
  type SoundPlatform,
} from "./shared";

export type * from "./shared";
export {
  COMMON_SYSTEM_SOUND_NAMES,
  COMMON_SYSTEM_SOUND_PROJECTIONS,
  SOUND_ERROR_CODES,
  SoundError,
  isCommonSystemSoundName,
  isSoundBackendCapabilities,
  isSoundBackendEvent,
  isSoundErrorCode,
  resolveSystemSoundName,
  soundErrorFromDescriptor,
  validateWavBytes,
  WAV_MAX_BYTES,
  WAV_MIN_BYTES,
} from "./shared";
export { SOUND_NATIVE_ARTIFACT } from "./native-artifact";

const SOUND_EXTENSION_NAME = "sound";

const BEEP_KINDS: readonly BeepKind[] = ["default", "info", "warning", "error", "question"];

export interface SoundExtensionOptions {
  mountId?: string;
  artifact?: NativeExtensionArtifact;
  /** Test/seam override for the host platform; Linux rejects typed before any dispatch. */
  platform?: SoundPlatform;
}

/**
 * Public sound capability (design reference section 1): fire-and-forget
 * system beep, named system sounds, low-cost file playback, and the async
 * backend capabilities snapshot. All methods resolve when playback is
 * accepted (the native call was taken), not when it completes.
 */
export interface SoundCapability {
  beep(kind?: BeepKind): Promise<void>;
  playSystemSound(name: SystemSoundName): Promise<void>;
  playSound(path: string, options?: PlaySoundOptions): Promise<void>;
  getBackend(): Promise<SoundBackendCapabilities>;
}

export const attachSound = (
  tray: TrayHandle,
  options: SoundExtensionOptions = {}
): SoundCapability => tray.extend(SoundExt, options);

export const SoundExt = {
  name: SOUND_EXTENSION_NAME,
  artifact: SOUND_NATIVE_ARTIFACT,
  resolveMount(options: SoundExtensionOptions | undefined) {
    return {
      ...(options?.mountId === undefined ? {} : { mountId: options.mountId }),
      ...(options?.artifact === undefined ? {} : { artifact: options.artifact }),
    };
  },
  extend(
    tray: TrayHandle,
    context: TrayExtensionContext,
    options: SoundExtensionOptions | undefined
  ): SoundCapability {
    return createSoundCapability(
      context,
      (options?.platform ?? process.platform) as SoundPlatform
    );
  },
} satisfies import("opentray").TrayExtension<SoundCapability, SoundExtensionOptions>;

function createSoundCapability(
  context: TrayExtensionContext,
  platform: SoundPlatform
): SoundCapability {
  const nativePlatform: SoundNativePlatform | undefined =
    platform === "darwin" || platform === "win32" ? platform : undefined;

  const requirePlatform = (): SoundNativePlatform => {
    if (nativePlatform === undefined) {
      throw soundErrorFromDescriptor(platformUnsupported(platform));
    }
    return nativePlatform;
  };

  const mapTransportError = (error: unknown): unknown => {
    if (error instanceof SoundError) {
      return error;
    }
    if (
      error instanceof NativeExtensionEmbeddedArtifactError &&
      error.reason === "target-unsupported"
    ) {
      return new SoundError(
        SOUND_ERROR_CODES.platformUnsupported,
        `native sound extension ships no library for this platform: ${error.message}`,
        { details: { kind: "platform", platform }, cause: error }
      );
    }
    if (
      (error instanceof ExtensionOperationError || error instanceof BrokerServerError) &&
      isSoundErrorCode(error.code)
    ) {
      return new SoundError(error.code, error.message, {
        ...(error.details === undefined ? {} : { details: error.details }),
        cause: error,
      });
    }
    // The shared transport-close code and unknown codes surface unchanged:
    // the frozen sound family has no transport alias and core never branches
    // on extension names (add-ext-sound design reference section 3).
    return error;
  };

  const dispatch = async <TValue>(
    command: SoundCommand
  ): Promise<Extract<ExtensionRequestResult<TValue>, { kind: "immediate" }>> => {
    try {
      const result = await context.request<TValue>(command);
      if (result.kind !== "immediate") {
        throw new Error(
          `sound extension commands settle on the immediate path (add-ext-sound section 1.4; no deferred operations); received ${result.kind}`
        );
      }
      return result;
    } catch (error: unknown) {
      throw mapTransportError(error);
    }
  };

  const backendContractError = (): Error =>
    new Error(
      "sound extension answered getBackend without a backend capabilities payload (wire contract violation)"
    );

  const expectBackendPlatform = (
    backend: SoundBackendCapabilities,
    native: SoundNativePlatform
  ): SoundBackendCapabilities => {
    if (backend.platform !== native) {
      throw new Error(
        `sound backend reported platform ${backend.platform} on a ${native} host (wire contract violation)`
      );
    }
    return backend;
  };

  /** Frozen immutable snapshot: the record and its committed format list are both frozen. */
  const freezeBackend = (backend: SoundBackendCapabilities): SoundBackendCapabilities =>
    Object.freeze({ ...backend, fileFormats: Object.freeze([...backend.fileFormats]) });

  let backendPromise: Promise<SoundBackendCapabilities> | undefined;

  const ensureBackend = (native: SoundNativePlatform): Promise<SoundBackendCapabilities> => {
    backendPromise ??= (async () => {
      const result = await dispatch<unknown>({ type: "getBackend" });
      for (const event of result.events) {
        if (isSoundBackendEvent(event.data)) {
          return freezeBackend(expectBackendPlatform(event.data.backend, native));
        }
      }
      throw backendContractError();
    })().catch((error: unknown) => {
      // Allow a later retry after a failed snapshot (e.g. transport death);
      // a successful snapshot is immutable and shared by every dispatch.
      backendPromise = undefined;
      throw mapTransportError(error);
    });
    return backendPromise;
  };

  // Path preflight (design reference section 1.3): `~` expansion,
  // cwd-relative resolution, canonicalization, readability — all before any
  // transport use. A canonicalization/read failure is typed
  // `sound_file_unreadable`; content validation is win32-only (below).
  const canonicalizeSoundPath = async (input: string): Promise<string> => {
    const expanded = expandHomeDirectory(input, homedir());
    const absolute = isAbsolute(expanded) ? expanded : join(process.cwd(), expanded);
    const normalized = normalizePath(absolute);
    try {
      return await realpath(normalized);
    } catch (error: unknown) {
      throw fileUnreadable(normalized, error);
    }
  };

  const assertReadable = async (path: string): Promise<void> => {
    try {
      await access(path);
    } catch (error: unknown) {
      throw fileUnreadable(path, error);
    }
  };

  const readWavOrReject = async (path: string): Promise<void> => {
    // Sound review R1 P1: a separate stat() then readFile() is TOCTOU —
    // the file can grow between the two calls and an unbounded readFile
    // would slurp past the frozen cap. Open once and read through a
    // bounded loop: at most WAV_MAX_BYTES + 1 bytes ever enter memory,
    // and the +1 byte proves the file is larger than the cap without
    // reading the excess.
    let handle: FileHandle;
    try {
      handle = await open(path, "r");
    } catch (error: unknown) {
      throw fileUnreadable(path, error);
    }
    try {
      const chunks: Buffer[] = [];
      let total = 0;
      const cap = WAV_MAX_BYTES + 1;
      for (;;) {
        const { bytesRead, buffer } = await handle.read({
          buffer: Buffer.alloc(Math.min(64 * 1024, cap - total)),
          position: total,
        });
        if (bytesRead === 0) {
          break;
        }
        chunks.push(buffer.subarray(0, bytesRead));
        total += bytesRead;
        if (total >= cap) {
          // The frozen size bounds reject by streamed length, not by a
          // pre-read stat (design reference section 1.3).
          throw formatUnsupported(path, "size-cap");
        }
      }
      if (total < WAV_MIN_BYTES) {
        throw formatUnsupported(path, "too-small");
      }
      const bytes = Buffer.concat(chunks, total);
      const rejection = validateWavBytes(bytes);
      if (rejection !== null) {
        throw formatUnsupported(path, rejection);
      }
    } finally {
      await handle.close();
    }
  };

  const assertNoUnknownOptions = (options: PlaySoundOptions | undefined): void => {
    if (options === undefined) {
      return;
    }
    const unknown = Object.keys(options).find((key) => key.length > 0);
    if (unknown !== undefined) {
      // v1 carries no options (design reference section 1.3 ruling); a value
      // here is a programming error, never a silently ignored setting.
      throw new TypeError(
        `playSound accepts no options in v1 (reserved empty PlaySoundOptions); unknown field: ${unknown}`
      );
    }
  };

  return {
    beep: async (kind: BeepKind = "default"): Promise<void> => {
      if (!(BEEP_KINDS as readonly string[]).includes(kind)) {
        throw new TypeError(
          `beep kind must be one of ${BEEP_KINDS.join(", ")}; received ${String(kind)}`
        );
      }
      requirePlatform();
      await dispatch<unknown>({ type: "beep", kind });
    },
    playSystemSound: async (name: SystemSoundName): Promise<void> => {
      const native = requirePlatform();
      if (typeof name !== "string" || name.length === 0) {
        throw new TypeError("playSystemSound requires a non-empty system sound name");
      }
      // Resolution law (design reference section 1.2, frozen order): common
      // table hit -> platform projection constant; miss -> native passthrough.
      // A native miss rejects typed `sound_not_found` (backend-owned details,
      // surfaced as-is); the facade never falls back and never stays silent.
      const resolution = resolveSystemSoundName(name, native);
      try {
        await dispatch<unknown>({ type: "playSystemSound", name: resolution.nativeName });
      } catch (error: unknown) {
        if (
          error instanceof SoundError &&
          error.code === SOUND_ERROR_CODES.notFound &&
          error.details === undefined
        ) {
          throw new SoundError(error.code, error.message, {
            details: {
              kind: "not-found",
              requested: name,
              platform: native,
              attempted: attemptedModesForResolution(resolution),
            },
            cause: error,
          });
        }
        throw error;
      }
    },
    playSound: async (path: string, options?: PlaySoundOptions): Promise<void> => {
      const native = requirePlatform();
      if (typeof path !== "string" || path.length === 0) {
        throw new TypeError("playSound requires a non-empty file path");
      }
      assertNoUnknownOptions(options);
      const canonical = await canonicalizeSoundPath(path);
      await assertReadable(canonical);
      if (native === "win32") {
        await readWavOrReject(canonical);
      }
      await dispatch<unknown>({ type: "playSound", path: canonical });
    },
    getBackend: async (): Promise<SoundBackendCapabilities> =>
      ensureBackend(requirePlatform()),
  };
}
