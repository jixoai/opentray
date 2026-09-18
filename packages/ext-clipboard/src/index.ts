// Orthogonal intents (2026-09-18; add-ext-clipboard tasks 4.1/4.2):
// 1. Attach the clipboard capability through the normal tray extension
//    family (tray.extend, session-scoped, isomorphic to
//    attachDialog/attachSound).
// 2. Fail every preflight branch before any transport use: typed platform
//    rejection on Linux (zero broker frames), unknown attach option fields
//    (TypeError), non-string writeText payloads (TypeError), and the frozen
//    writeText encoding gates — the 1 MiB UTF-16-unit cap and the
//    lone-surrogate rejection (never a silent replacement write).
// 3. Dispatch readText/writeText/clear/getBackend through the camelCase
//    ext-command envelope on the V2 immediate path (design reference
//    sections 1-2: every clipboard command is Immediate — no deferred
//    operations, no operationId handling; readText's null is the
//    first-class empty board state, not an error and not an empty string).

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
import type { ClipboardBackendCapabilities, ClipboardErrorCode } from "@opentray/spec";
import {
  CLIPBOARD_ERROR_CODES,
  CLIPBOARD_MAX_WRITE_UTF16,
  isClipboardBackendCapabilities,
  isClipboardErrorCode,
} from "@opentray/spec";

import { CLIPBOARD_NATIVE_ARTIFACT } from "./native-artifact";

export type { ClipboardBackendCapabilities, ClipboardErrorCode } from "@opentray/spec";
export {
  CLIPBOARD_ERROR_CODES,
  CLIPBOARD_MAX_WRITE_UTF16,
  isClipboardBackendCapabilities,
  isClipboardErrorCode,
} from "@opentray/spec";
export { CLIPBOARD_NATIVE_ARTIFACT } from "./native-artifact";

const CLIPBOARD_EXTENSION_NAME = "clipboard";

const ATTACH_OPTION_KEYS: ReadonlySet<string> = new Set(["mountId", "artifact", "platform"]);

export type ClipboardPlatform = "darwin" | "win32" | "linux";

export type ClipboardNativePlatform = "darwin" | "win32";

export interface ClipboardExtensionOptions {
  mountId?: string;
  artifact?: NativeExtensionArtifact;
  /** Test/seam override for the host platform; Linux rejects typed before any dispatch. */
  platform?: ClipboardPlatform;
}

/**
 * Public clipboard capability (design reference section 1): system
 * clipboard text atoms plus the async backend capabilities snapshot.
 * `readText()` resolves `null` when the board holds no text — the empty
 * state is a first-class value, never an error and never an empty string.
 */
export interface ClipboardCapability {
  readText(): Promise<string | null>;
  writeText(text: string): Promise<void>;
  clear(): Promise<void>;
  getBackend(): Promise<ClipboardBackendCapabilities>;
}

/**
 * Typed rejection of the clipboard facade: facade preflight failures
 * (platform, payload gates) and normalized broker/native clipboard
 * rejections. Consumers match on `code`; the human `message` is not a
 * contract. Details payloads: `clipboard_locked` carries `{attempts,
 * elapsedMs}`; `clipboard_unavailable` carries `{osErrorCode}`;
 * `clipboard_payload_too_large` carries `{lengthUtf16, limit}`;
 * `clipboard_payload_invalid` carries `{reason: "lone-surrogate", index}`.
 * The shared transport-close code is surfaced unchanged (the frozen
 * clipboard family has no transport alias; core never branches on
 * extension names).
 */
export class ClipboardError extends Error {
  readonly code: ClipboardErrorCode;
  readonly details?: unknown;

  constructor(
    code: ClipboardErrorCode,
    message: string,
    options: { details?: unknown; cause?: unknown } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ClipboardError";
    this.code = code;
    if (options.details !== undefined) {
      this.details = options.details;
    }
  }
}

/** Wire command surface of the clipboard extension (camelCase `ext-command` payloads). */
export type ClipboardCommand =
  | { type: "getBackend" }
  | { type: "readText" }
  | { type: "writeText"; text: string }
  | { type: "clear" };

/** Wire event that answers `readText` on the immediate path: the text or the null empty state. */
export interface ClipboardTextEvent {
  type: "text";
  text: string | null;
}

export const isClipboardTextEvent = (value: unknown): value is ClipboardTextEvent =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  (value as { type?: unknown }).type === "text" &&
  ((value as { text?: unknown }).text === null ||
    typeof (value as { text?: unknown }).text === "string");

/** Wire event that answers the `getBackend` command on the immediate path. */
export interface ClipboardBackendEvent {
  type: "backend";
  backend: ClipboardBackendCapabilities;
}

export const isClipboardBackendEvent = (value: unknown): value is ClipboardBackendEvent =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  (value as { type?: unknown }).type === "backend" &&
  isClipboardBackendCapabilities((value as { backend?: unknown }).backend);

/**
 * Pure preflight gate (design reference section 1, frozen): returns the
 * UTF-16 code-unit index of the first unpaired surrogate, or null. A
 * paired high+low unit advances past both; any low unit reached standalone
 * is unpaired by construction. The index unit matches the frozen
 * measurement unit (UTF-16 code units, the `CF_UNICODETEXT` unit).
 */
export const findLoneSurrogateIndex = (text: string): number | null => {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    const isHigh = unit >= 0xd800 && unit <= 0xdbff;
    const isLow = unit >= 0xdc00 && unit <= 0xdfff;
    if (!isHigh && !isLow) {
      continue;
    }
    if (isHigh) {
      const next = index + 1 < text.length ? text.charCodeAt(index + 1) : NaN;
      if (next >= 0xdc00 && next <= 0xdfff) {
        // Paired: skip the low unit.
        index += 1;
        continue;
      }
      return index;
    }
    // A low unit reached standalone is unpaired (its high was consumed).
    return index;
  }
  return null;
};

/** Typed `clipboard_platform_unsupported` descriptor (Linux path; zero broker frames). */
export const platformUnsupported = (platform: string): {
  code: ClipboardErrorCode;
  message: string;
  details: { kind: "platform"; platform: string };
} => ({
  code: CLIPBOARD_ERROR_CODES.platformUnsupported,
  message: `native clipboard is unsupported on ${platform} (Linux has no native implementation; add-ext-clipboard design reference section 0)`,
  details: { kind: "platform", platform },
});

export const attachClipboard = (
  tray: TrayHandle,
  options: ClipboardExtensionOptions = {}
): ClipboardCapability => {
  const unknown = Object.keys(options).find((key) => !ATTACH_OPTION_KEYS.has(key));
  if (unknown !== undefined) {
    // v1 has exactly the family option surface; an unknown field is a
    // programming error, never a silently ignored setting (pre-transport).
    throw new TypeError(
      `attachClipboard received an unknown option field: ${unknown} (v1 accepts mountId, artifact, platform)`
    );
  }
  return tray.extend(ClipboardExt, options);
};

export const ClipboardExt = {
  name: CLIPBOARD_EXTENSION_NAME,
  artifact: CLIPBOARD_NATIVE_ARTIFACT,
  resolveMount(options: ClipboardExtensionOptions | undefined) {
    return {
      ...(options?.mountId === undefined ? {} : { mountId: options.mountId }),
      ...(options?.artifact === undefined ? {} : { artifact: options.artifact }),
    };
  },
  extend(
    tray: TrayHandle,
    context: TrayExtensionContext,
    options: ClipboardExtensionOptions | undefined
  ): ClipboardCapability {
    return createClipboardCapability(
      context,
      (options?.platform ?? process.platform) as ClipboardPlatform
    );
  },
} satisfies import("opentray").TrayExtension<ClipboardCapability, ClipboardExtensionOptions>;

function createClipboardCapability(
  context: TrayExtensionContext,
  platform: ClipboardPlatform
): ClipboardCapability {
  const nativePlatform: ClipboardNativePlatform | undefined =
    platform === "darwin" || platform === "win32" ? platform : undefined;

  const requirePlatform = (): ClipboardNativePlatform => {
    if (nativePlatform === undefined) {
      const descriptor = platformUnsupported(platform);
      throw new ClipboardError(descriptor.code, descriptor.message, {
        details: descriptor.details,
      });
    }
    return nativePlatform;
  };

  const mapTransportError = (error: unknown): unknown => {
    if (error instanceof ClipboardError) {
      return error;
    }
    if (
      error instanceof NativeExtensionEmbeddedArtifactError &&
      error.reason === "target-unsupported"
    ) {
      return new ClipboardError(
        CLIPBOARD_ERROR_CODES.platformUnsupported,
        `native clipboard extension ships no library for this platform: ${error.message}`,
        { details: { kind: "platform", platform }, cause: error }
      );
    }
    if (
      (error instanceof ExtensionOperationError || error instanceof BrokerServerError) &&
      isClipboardErrorCode(error.code)
    ) {
      return new ClipboardError(error.code, error.message, {
        ...(error.details === undefined ? {} : { details: error.details }),
        cause: error,
      });
    }
    // The shared transport-close code and unknown codes surface unchanged:
    // the frozen clipboard family has no transport alias and core never
    // branches on extension names (add-ext-clipboard design reference
    // section 3).
    return error;
  };

  const dispatch = async <TValue>(
    command: ClipboardCommand
  ): Promise<Extract<ExtensionRequestResult<TValue>, { kind: "immediate" }>> => {
    try {
      const result = await context.request<TValue>(command);
      if (result.kind !== "immediate") {
        throw new Error(
          `clipboard extension commands settle on the immediate path (add-ext-clipboard design reference sections 1-2; no deferred operations); received ${result.kind}`
        );
      }
      return result;
    } catch (error: unknown) {
      throw mapTransportError(error);
    }
  };

  const backendContractError = (): Error =>
    new Error(
      "clipboard extension answered getBackend without a backend capabilities payload (wire contract violation)"
    );

  const expectBackendPlatform = (
    backend: ClipboardBackendCapabilities,
    native: ClipboardNativePlatform
  ): ClipboardBackendCapabilities => {
    if (backend.platform !== native) {
      throw new Error(
        `clipboard backend reported platform ${backend.platform} on a ${native} host (wire contract violation)`
      );
    }
    return backend;
  };

  /** Frozen immutable snapshot: the record is deeply plain, so a shallow freeze is total. */
  const freezeBackend = (backend: ClipboardBackendCapabilities): ClipboardBackendCapabilities =>
    Object.freeze({ ...backend });

  let backendPromise: Promise<ClipboardBackendCapabilities> | undefined;

  const ensureBackend = (native: ClipboardNativePlatform): Promise<ClipboardBackendCapabilities> => {
    backendPromise ??= (async () => {
      const result = await dispatch<unknown>({ type: "getBackend" });
      for (const event of result.events) {
        const data = (event as { data?: unknown } | null)?.data;
        if (isClipboardBackendEvent(data)) {
          return freezeBackend(expectBackendPlatform(data.backend, native));
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

  return {
    readText: async (): Promise<string | null> => {
      requirePlatform();
      const result = await dispatch<unknown>({ type: "readText" });
      for (const event of result.events) {
        if (isClipboardTextEvent((event as { data?: unknown }).data)) {
          // null is the first-class empty board state (design section 1).
          return (event as { data: ClipboardTextEvent }).data.text;
        }
      }
      throw new Error(
        "clipboard extension answered readText without a text payload (wire contract violation)"
      );
    },
    writeText: async (text: string): Promise<void> => {
      requirePlatform();
      if (typeof text !== "string") {
        throw new TypeError(
          `writeText requires a string payload (v1 is UTF-8 text only); received ${typeof text}`
        );
      }
      // String.length IS the frozen measurement unit (UTF-16 code units).
      const lengthUtf16 = text.length;
      if (lengthUtf16 > CLIPBOARD_MAX_WRITE_UTF16) {
        throw new ClipboardError(
          CLIPBOARD_ERROR_CODES.payloadTooLarge,
          `writeText payload is ${lengthUtf16} UTF-16 code units; the frozen write cap is ${CLIPBOARD_MAX_WRITE_UTF16}`,
          { details: { lengthUtf16, limit: CLIPBOARD_MAX_WRITE_UTF16 } }
        );
      }
      const loneSurrogate = findLoneSurrogateIndex(text);
      if (loneSurrogate !== null) {
        // Frozen: reject, never silently replace — a replacement write
        // would break read-back round-trip fidelity.
        throw new ClipboardError(
          CLIPBOARD_ERROR_CODES.payloadInvalid,
          `writeText payload contains a lone surrogate at UTF-16 index ${loneSurrogate}; replacement writes are forbidden`,
          { details: { reason: "lone-surrogate", index: loneSurrogate } }
        );
      }
      await dispatch<unknown>({ type: "writeText", text });
    },
    clear: async (): Promise<void> => {
      requirePlatform();
      await dispatch<unknown>({ type: "clear" });
    },
    getBackend: async (): Promise<ClipboardBackendCapabilities> =>
      ensureBackend(requirePlatform()),
  };
}
