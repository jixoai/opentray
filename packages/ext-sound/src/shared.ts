// Orthogonal intents (2026-09-17; add-ext-sound tasks 4.1/4.2):
// 1. Keep every sound option/DTO/error type plus the common-name resolution
//    law and the win32 WAV content validator as pure, transport-free data
//    (design reference sections 1.2/1.3). The DTO schema and the frozen
//    error-code family are owned by the shared @opentray/spec schema and
//    re-exported here so consumers need one import surface.
// 2. Never perform I/O here; the facade (index.ts) composes these pure pieces
//    with the tray extension transport and the filesystem preflight.

import { join } from "node:path";

import {
  COMMON_SYSTEM_SOUND_PROJECTIONS,
  SOUND_ERROR_CODES,
  isCommonSystemSoundName,
  isSoundBackendCapabilities,
  isSoundErrorCode,
  type SoundErrorCode,
} from "@opentray/spec";

export type SoundPlatform = "darwin" | "win32" | "linux";

export type SoundNativePlatform = "darwin" | "win32";

// Shared schema (add-ext-sound task 2.1): re-exported so the facade public
// surface and the @opentray/spec truth cannot drift.
export type {
  BeepKind,
  CommonSystemSoundName,
  PlaySoundOptions,
  SoundBackendCapabilities,
  SoundErrorDetails,
  SystemSoundAttemptedMode,
  SystemSoundName,
} from "@opentray/spec";
export {
  COMMON_SYSTEM_SOUND_NAMES,
  COMMON_SYSTEM_SOUND_PROJECTIONS,
  SOUND_ERROR_CODES,
  isCommonSystemSoundName,
  isSoundBackendCapabilities,
  isSoundErrorCode,
} from "@opentray/spec";

// ---------------------------------------------------------------------------
// Backend capabilities DTO wire event (design reference section 2)
// ---------------------------------------------------------------------------

/** Wire event that answers the `getBackend` command on the immediate path. */
export interface SoundBackendEvent {
  type: "backend";
  backend: import("@opentray/spec").SoundBackendCapabilities;
}

export const isSoundBackendEvent = (
  value: unknown
): value is SoundBackendEvent =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  (value as { type?: unknown }).type === "backend" &&
  isSoundBackendCapabilities((value as { backend?: unknown }).backend);

// ---------------------------------------------------------------------------
// Typed error family (design reference section 3; codes frozen in @opentray/spec)
// ---------------------------------------------------------------------------

export interface SoundErrorDescriptor {
  code: SoundErrorCode;
  message: string;
  details?: import("@opentray/spec").SoundErrorDetails;
}

/**
 * Typed rejection of the sound facade: facade preflight failures (platform,
 * format, unreadable) and normalized broker/native sound rejections.
 * Consumers match on `code`; the human `message` is not a contract. The
 * shared transport-close code is surfaced unchanged (the frozen sound family
 * has no transport alias; core never branches on extension names).
 */
export class SoundError extends Error {
  readonly code: SoundErrorCode;
  readonly details?: unknown;

  constructor(
    code: SoundErrorCode,
    message: string,
    options: { details?: unknown; cause?: unknown } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "SoundError";
    this.code = code;
    if (options.details !== undefined) {
      this.details = options.details;
    }
  }
}

export const soundErrorFromDescriptor = (
  descriptor: SoundErrorDescriptor,
  options: { cause?: unknown } = {}
): SoundError =>
  new SoundError(descriptor.code, descriptor.message, {
    ...(descriptor.details === undefined ? {} : { details: descriptor.details }),
    ...(options.cause === undefined ? {} : { cause: options.cause }),
  });

export const platformUnsupported = (platform: string): SoundErrorDescriptor => ({
  code: SOUND_ERROR_CODES.platformUnsupported,
  message: `native sound is unsupported on ${platform} (Linux has no native implementation; add-ext-sound design reference section 0)`,
  details: { kind: "platform", platform },
});

export const fileUnreadable = (path: string, cause?: unknown): SoundError =>
  new SoundError(SOUND_ERROR_CODES.fileUnreadable, `sound file is not readable: ${path}`, {
    details: { kind: "unreadable", path },
    ...(cause === undefined ? {} : { cause }),
  });

export const formatUnsupported = (path: string, reason: string): SoundError =>
  new SoundError(
    SOUND_ERROR_CODES.formatUnsupported,
    `sound file is not a playable WAV for this platform (${reason}): ${path}`,
    { details: { kind: "format", path, reason } }
  );

// ---------------------------------------------------------------------------
// playSystemSound resolution law (design reference section 1.2, frozen order):
// common-name table hit -> platform projection constant; miss -> native name
// passthrough. A native miss rejects typed `sound_not_found` with a details
// payload; the facade never falls back and never stays silent.
// ---------------------------------------------------------------------------

export interface SystemSoundResolution {
  readonly mode: "common-table" | "native-passthrough";
  readonly nativeName: string;
}

export const resolveSystemSoundName = (
  name: string,
  platform: SoundNativePlatform
): SystemSoundResolution => {
  if (isCommonSystemSoundName(name)) {
    return { mode: "common-table", nativeName: COMMON_SYSTEM_SOUND_PROJECTIONS[name][platform] };
  }
  return { mode: "native-passthrough", nativeName: name };
};

/** How the facade searched for a name before a typed miss (details payload input). */
export const attemptedModesForResolution = (
  resolution: SystemSoundResolution
): readonly ("common-table" | "platform-catalog")[] =>
  resolution.mode === "common-table"
    ? ["common-table", "platform-catalog"]
    : ["platform-catalog"];

// ---------------------------------------------------------------------------
// win32 WAV content validator (design reference section 1.3, frozen
// arithmetic — R3 P1-1): at least 12 bytes, at most 64 MiB,
// declared_size + 8 <= actual_size (the offset-4 field counts bytes AFTER the
// 8-byte RIFF header), 'RIFF'/'WAVE' magic, and both fmt and data chunks with
// every chunk (offset + 8 + size + odd pad) landing inside the declared RIFF
// region; fmt payload >= 16 bytes; no decoding.
// ---------------------------------------------------------------------------

export const WAV_MIN_BYTES = 12;
export const WAV_MAX_BYTES = 64 * 1024 * 1024;

/** Closed machine reason set for typed `sound_format_unsupported` rejections. */
export type WavRejectionReason =
  | "too-small"
  | "size-cap"
  | "riff-magic"
  | "wave-magic"
  | "declared-size"
  | "chunk-bounds"
  | "fmt-missing"
  | "data-missing"
  | "fmt-payload";

const ascii4 = (bytes: Uint8Array, offset: number): string =>
  String.fromCharCode(...bytes.subarray(offset, offset + 4));

const readU32LE = (bytes: Uint8Array, offset: number): number =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);

/**
 * Pure RIFF/WAV structural validator. Returns `null` when the bytes are a
 * structurally acceptable WAV (fmt + data present inside the declared region)
 * or the closed rejection reason otherwise. It performs no decoding and no
 * I/O; darwin never calls it (its v1 format set is backend-declared).
 */
export const validateWavBytes = (bytes: Uint8Array): WavRejectionReason | null => {
  if (bytes.length < WAV_MIN_BYTES) {
    return "too-small";
  }
  if (bytes.length > WAV_MAX_BYTES) {
    return "size-cap";
  }
  if (ascii4(bytes, 0) !== "RIFF") {
    return "riff-magic";
  }
  // The offset-4 field counts the bytes after the 8-byte RIFF header.
  const declaredEnd = readU32LE(bytes, 4) + 8;
  if (declaredEnd > bytes.length) {
    return "declared-size";
  }
  if (ascii4(bytes, 8) !== "WAVE") {
    return "wave-magic";
  }
  let sawFmt = false;
  let sawData = false;
  let offset = 12;
  while (offset < declaredEnd) {
    if (offset + 8 > declaredEnd) {
      return "chunk-bounds";
    }
    const chunkId = ascii4(bytes, offset);
    const size = readU32LE(bytes, offset + 4);
    const chunkEnd = offset + 8 + size + (size % 2);
    if (chunkEnd > declaredEnd) {
      return "chunk-bounds";
    }
    if (chunkId === "fmt ") {
      sawFmt = true;
      if (size < 16) {
        return "fmt-payload";
      }
    }
    if (chunkId === "data") {
      sawData = true;
    }
    offset = chunkEnd;
  }
  if (!sawFmt) {
    return "fmt-missing";
  }
  if (!sawData) {
    return "data-missing";
  }
  return null;
};

// ---------------------------------------------------------------------------
// Path helpers (design reference section 1.3: `~` expansion, cwd-relative
// resolution, canonicalization) — pure; the facade owns the fs calls.
// ---------------------------------------------------------------------------

/** Expand a leading `~` against the supplied home directory. */
export const expandHomeDirectory = (value: string, home: string): string => {
  if (value === "~") {
    return home;
  }
  if (value.startsWith("~/")) {
    return join(home, value.slice(2));
  }
  return value;
};

/** Wire command surface of the sound extension (camelCase `ext-command` payloads). */
export type SoundCommand =
  | { type: "getBackend" }
  | { type: "beep"; kind: import("@opentray/spec").BeepKind }
  | { type: "playSystemSound"; name: string }
  | { type: "playSound"; path: string };
