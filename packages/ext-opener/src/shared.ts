// Orthogonal intents (2026-09-18; add-ext-opener tasks 4.1/4.2):
// 1. Keep every opener classification law as pure, transport-free data
//    (design reference section 2, frozen): the open() target matrix
//    (absolute paths pass verbatim; win32 `C:x` drive-relative rejects;
//    UNC valid; `\\?\` literal passthrough with no normalization; URLs
//    parse through `new URL()` and must pass the frozen scheme allowlist;
//    `file:` URLs never normalize to paths), the revealInFolder
//    rejection set (quote / any C0 control — reject, never escape), and
//    the trailing-separator trim law with the root boundary. The DTO
//    schema and the frozen error-code family are owned by the shared
//    @opentray/spec schema and re-exported here so consumers need one
//    import surface.
// 2. Never perform I/O here; the facade (index.ts) composes these pure
//    pieces with the tray extension transport.

import {
  OPENER_ERROR_CODES,
  isOpenerAllowedScheme,
  isOpenerBackendCapabilities,
  isOpenerErrorCode,
  type OpenerErrorCode,
} from "@opentray/spec";

export type OpenerPlatform = "darwin" | "win32" | "linux";

export type OpenerNativePlatform = "darwin" | "win32";

// Shared schema (add-ext-opener task 2.1): re-exported so the facade public
// surface and the @opentray/spec truth cannot drift.
export type {
  OpenerAllowedScheme,
  OpenerBackendCapabilities,
  OpenerErrorCode,
} from "@opentray/spec";
export {
  OPENER_ALLOWED_SCHEMES,
  OPENER_ERROR_CODES,
  isOpenerAllowedScheme,
  isOpenerBackendCapabilities,
  isOpenerErrorCode,
} from "@opentray/spec";

// ---------------------------------------------------------------------------
// Backend capabilities DTO wire event (design reference section 3)
// ---------------------------------------------------------------------------

/** Wire event that answers the `getBackend` command on the immediate path. */
export interface OpenerBackendEvent {
  type: "backend";
  backend: import("@opentray/spec").OpenerBackendCapabilities;
}

export const isOpenerBackendEvent = (value: unknown): value is OpenerBackendEvent =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  (value as { type?: unknown }).type === "backend" &&
  isOpenerBackendCapabilities((value as { backend?: unknown }).backend);

// ---------------------------------------------------------------------------
// Typed error family (design reference section 3; codes frozen in @opentray/spec)
// ---------------------------------------------------------------------------

export interface OpenerErrorDescriptor {
  code: OpenerErrorCode;
  message: string;
  details?: unknown;
}

/**
 * Typed rejection of the opener facade: facade preflight failures
 * (platform, target classification, scheme gate, reveal rejection set)
 * and normalized broker/native opener rejections (`opener_failed` from
 * native acceptance failures). Consumers match on `code`; the human
 * `message` is not a contract. The shared transport-close code is
 * surfaced unchanged (the frozen opener family has no transport alias).
 */
export class OpenerError extends Error {
  readonly code: OpenerErrorCode;
  readonly details?: unknown;

  constructor(
    code: OpenerErrorCode,
    message: string,
    options: { details?: unknown; cause?: unknown } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "OpenerError";
    this.code = code;
    if (options.details !== undefined) {
      this.details = options.details;
    }
  }
}

export const openerErrorFromDescriptor = (
  descriptor: OpenerErrorDescriptor,
  options: { cause?: unknown } = {}
): OpenerError =>
  new OpenerError(descriptor.code, descriptor.message, {
    ...(descriptor.details === undefined ? {} : { details: descriptor.details }),
    ...(options.cause === undefined ? {} : { cause: options.cause }),
  });

export const platformUnsupported = (platform: string): OpenerErrorDescriptor => ({
  code: OPENER_ERROR_CODES.platformUnsupported,
  message: `native opener is unsupported on ${platform} (Linux has no native implementation; add-ext-opener design reference section 0)`,
  details: { kind: "platform", platform },
});

/** The frozen reason strings of `opener_target_invalid` details. */
export type OpenerTargetInvalidReason = "relative" | "drive-relative" | "path-quote" | "path-control-char";

export const targetInvalid = (reason: OpenerTargetInvalidReason, target: string): OpenerError =>
  new OpenerError(OPENER_ERROR_CODES.targetInvalid, `opener target is invalid (${reason}): ${target}`, {
    details: { reason },
  });

export const schemeBlocked = (scheme: string, target: string): OpenerError =>
  new OpenerError(
    OPENER_ERROR_CODES.schemeBlocked,
    `opener scheme ${JSON.stringify(scheme)} is not in the v1 allowlist: ${target}`,
    { details: { scheme } }
  );

// ---------------------------------------------------------------------------
// open() target classification (design reference section 2, frozen matrix)
// ---------------------------------------------------------------------------

export type OpenerTargetClassification =
  | { kind: "absolute-path" }
  | { kind: "url"; scheme: string }
  | { kind: "drive-relative" }
  | { kind: "relative" };

const DRIVE_SEPARATOR = /^([A-Za-z]):[\\/]/;
const DRIVE_RELATIVE = /^([A-Za-z]):/;

/**
 * The frozen open() classification: win32 drive forms first (`C:\x`
 * absolute, `C:x` drive-relative — the single-letter-colon form is a
 * drive reference before any URL interpretation), then POSIX `/` and
 * UNC/`\\?\` absolute forms, then the `new URL()` parse (which performs
 * the WHATWG C0/space margin trim). Everything else is relative.
 */
export const classifyOpenerTarget = (target: string): OpenerTargetClassification => {
  if (DRIVE_SEPARATOR.test(target)) {
    return { kind: "absolute-path" };
  }
  if (DRIVE_RELATIVE.test(target)) {
    return { kind: "drive-relative" };
  }
  if (target.startsWith("/")) {
    return { kind: "absolute-path" };
  }
  if (target.startsWith("\\\\")) {
    // UNC (`\\server\share\…`) and `\\?\` literal forms: absolute, passed
    // through verbatim with NO normalization (normalization is the
    // caller's responsibility — this layer rejects semantically
    // ambiguous input instead of normalizing it).
    return { kind: "absolute-path" };
  }
  try {
    const url = new URL(target);
    if (url.protocol.length > 0) {
      // `url.protocol` ends with ':' and is lowercased by the parser —
      // the canonical form used for allowlist matching and details.
      return { kind: "url", scheme: url.protocol.slice(0, -1) };
    }
  } catch {
    // Not a URL — fall through to the relative rejection.
  }
  return { kind: "relative" };
};

/** Applies the frozen v1 scheme allowlist (case-insensitive). */
export const openerSchemeAllowed = (scheme: string): boolean => isOpenerAllowedScheme(scheme);

/**
 * Preflights one open() target: legal targets return `null` (the raw
 * target always dispatches verbatim — never rewritten); illegal targets
 * return the typed rejection. Existence is NOT an acceptance
 * precondition: unreadable or not-yet-existing paths still dispatch.
 */
export const preflightOpenTarget = (target: string): OpenerError | null => {
  const classification = classifyOpenerTarget(target);
  switch (classification.kind) {
    case "absolute-path":
      return null;
    case "url":
      return openerSchemeAllowed(classification.scheme)
        ? null
        : schemeBlocked(classification.scheme, target);
    case "drive-relative":
      return targetInvalid("drive-relative", target);
    case "relative":
      return targetInvalid("relative", target);
  }
};

// ---------------------------------------------------------------------------
// revealInFolder (design reference section 2, frozen rejection set +
// trailing-separator trim law with the root boundary)
// ---------------------------------------------------------------------------

/** The frozen reveal dispatch plan after the rejection set, the absolute
 * gate, and the trim law. */
export type OpenerRevealPlan =
  | { mode: "select"; path: string }
  | { mode: "open-root"; root: string };

const isWin32Separator = (value: string): boolean => value === "\\" || value === "/";

const isDriveRoot = (path: string): boolean => {
  if (path.length !== 3) {
    return false;
  }
  const separator = path[2];
  return separator !== undefined && DRIVE_RELATIVE.test(path.slice(0, 2)) && isWin32Separator(separator);
};

/** True for `server\share\` (either separator style) with nothing after. */
const isUncRootBody = (body: string): boolean => {
  if (body.length === 0) {
    return false;
  }
  const last = body[body.length - 1];
  if (last === undefined || !isWin32Separator(last)) {
    return false;
  }
  const trimmed = body.slice(0, -1);
  let separators = 0;
  for (const character of trimmed) {
    if (isWin32Separator(character)) {
      separators += 1;
    }
  }
  return separators === 1 && trimmed.length > 0;
};

/** True when the path is a root that must never be trimmed (frozen
 * boundary): POSIX `/`, win32 drive roots, the UNC root
 * `\\server\share\`, and the `\\?\`-literal drive/UNC roots. */
export const isRevealRoot = (path: string): boolean => {
  if (path === "/") {
    return true;
  }
  if (isDriveRoot(path)) {
    return true;
  }
  if (path.startsWith("\\\\?\\")) {
    const tail = path.slice(4);
    if (isDriveRoot(tail)) {
      return true;
    }
    if (tail.startsWith("UNC\\")) {
      return isUncRootBody(tail.slice(4));
    }
    return false;
  }
  if (path.startsWith("\\\\")) {
    return isUncRootBody(path.slice(2));
  }
  return false;
};

/** True when the string still satisfies the frozen absolute forms
 * (POSIX `/…`, win32 drive `[A-Za-z]:[\\/]…`, UNC `\\…`) — the
 * trim-law guard (a trim drifting into `C:` or the empty string is not
 * legal). */
export const isLegalAbsolutePath = (path: string): boolean => {
  if (path.length === 0) {
    return false;
  }
  if (path.startsWith("/")) {
    return true;
  }
  if (path.startsWith("\\\\")) {
    return true;
  }
  return DRIVE_SEPARATOR.test(path);
};

const trimOneTrailingSeparator = (path: string, posix: boolean): string => {
  if (path.length === 0) {
    return path;
  }
  const last = path[path.length - 1];
  if (last !== undefined && (posix ? last === "/" : isWin32Separator(last))) {
    const trimmed = path.slice(0, -1);
    if (isLegalAbsolutePath(trimmed)) {
      return trimmed;
    }
  }
  return path;
};

/**
 * The frozen revealInFolder preflight: the rejection set (a quote or any
 * C0 control character — reject-not-escape), the absolute gate
 * (relative and drive-relative reject typed), the root boundary, and the
 * exactly-one-separator trim law. POSIX trims only `/` (a backslash is a
 * legal filename character there); win32 trims either separator.
 */
export const preflightRevealPath = (
  path: string,
  platform: OpenerNativePlatform
): OpenerError | OpenerRevealPlan => {
  if (path.includes('"')) {
    return targetInvalid("path-quote", path);
  }
  for (const character of path) {
    if (character.charCodeAt(0) <= 0x1f) {
      return targetInvalid("path-control-char", path);
    }
  }
  const posix = platform === "darwin";
  const classification = classifyOpenerTarget(path);
  const absolute = posix
    ? path.startsWith("/")
    : classification.kind === "absolute-path";
  if (!absolute) {
    return targetInvalid(
      classification.kind === "drive-relative" ? "drive-relative" : "relative",
      path
    );
  }
  if (isRevealRoot(path)) {
    return { mode: "open-root", root: path };
  }
  const trimmed = trimOneTrailingSeparator(path, posix);
  // A trim that lands ON a root keeps open-the-root semantics.
  if (isRevealRoot(trimmed)) {
    return { mode: "open-root", root: trimmed };
  }
  return { mode: "select", path: trimmed };
};

/** Wire command surface of the opener extension (camelCase `ext-command` payloads). */
export type OpenerCommand =
  | { type: "getBackend" }
  | { type: "open"; target: string }
  | { type: "revealInFolder"; path: string };
