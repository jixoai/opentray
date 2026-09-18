// Orthogonal intents (2026-09-18; add-ext-notification batch C):
// 1. Keep every notification option/wire-event/error type plus the payload
//    preflight matrix and the win32 subtitle join as pure, transport-free
//    data (design reference sections 1-3). The DTO schema and the frozen
//    error-code family are owned by the shared @opentray/spec schema and
//    re-exported here so consumers need one import surface.
// 2. Never perform I/O here; the facade (index.ts) composes these pure
//    pieces with the tray extension transport.

import {
  NOTIFICATION_BODY_LIMIT_UTF16,
  NOTIFICATION_ERROR_CODES,
  NOTIFICATION_SUBTITLE_LIMIT_UTF16,
  NOTIFICATION_TITLE_LIMIT_UTF16,
  isNotificationBackendCapabilities,
  type NotificationAuthorizationStatus,
  type NotificationBackendCapabilities,
  type NotificationErrorCode,
} from "@opentray/spec";

export type NotificationPlatform = "darwin" | "win32" | "linux";

export type NotificationNativePlatform = "darwin" | "win32";

// Shared schema (add-ext-notification batch A): re-exported so the facade
// public surface and the @opentray/spec truth cannot drift.
export type {
  NotificationAuthorizationModel,
  NotificationAuthorizationStatus,
  NotificationBackendCapabilities,
  NotificationChannel,
  NotificationErrorCode,
} from "@opentray/spec";
export {
  NOTIFICATION_BODY_LIMIT_UTF16,
  NOTIFICATION_ERROR_CODES,
  NOTIFICATION_SUBTITLE_LIMIT_UTF16,
  NOTIFICATION_TITLE_LIMIT_UTF16,
  isNotificationBackendCapabilities,
  isNotificationErrorCode,
} from "@opentray/spec";

// ---------------------------------------------------------------------------
// Options (design reference section 1; v1 has NO platform namespace)
// ---------------------------------------------------------------------------

export interface NotifyOptions {
  /** Required, non-empty, at most 64 UTF-16 code units (platform-independent common contract). */
  title: string;
  /** At most 256 UTF-16 code units. */
  body?: string;
  /**
   * Distinct native field on darwin. win32 documented degradation: the facade
   * joins it into the body as a prefix (combined post-join limit 256 UTF-16
   * code units; never truncated). At most 64 UTF-16 code units.
   */
  subtitle?: string;
  /** Default `false` (platform default alert sound); `true` means no sound. */
  silent?: boolean;
}

/** Wire form of a notify payload after facade preflight (`silent` always explicit). */
export interface NotifyWireOptions {
  title: string;
  body?: string;
  subtitle?: string;
  silent: boolean;
}

/** Wire command surface of the notification extension (camelCase `ext-command` payloads). */
export type NotificationCommand =
  | { type: "getBackend" }
  | { type: "notify"; options: NotifyWireOptions }
  | { type: "getAuthorizationStatus" }
  | { type: "requestAuthorization" };

// ---------------------------------------------------------------------------
// Wire events (design reference section 4): the two authorization commands
// settle darwin-side through DeferredOperation terminals whose result value
// carries the same event shape the win32 Immediate path emits as an ext
// event — the facade stays transport-agnostic across both.
// ---------------------------------------------------------------------------

/** Wire event that answers the `getBackend` command on the immediate path. */
export interface NotificationBackendEvent {
  type: "backend";
  backend: NotificationBackendCapabilities;
}

/** Authorization read result: the `getAuthorizationStatus` answer. */
export interface NotificationAuthorizationEvent {
  type: "authorization";
  status: NotificationAuthorizationStatus;
}

/** Authorization request decision: the `requestAuthorization` answer. */
export interface NotificationAuthorizationDecisionEvent {
  type: "authorizationDecision";
  granted: boolean;
}

// ---------------------------------------------------------------------------
// Typed error family (design reference section 3; codes frozen in @opentray/spec)
// ---------------------------------------------------------------------------

/**
 * Facade-originated details payloads (broker-originated details pass through
 * unchanged: `notification_denied` carries `{status}`; `notification_failed`
 * carries `{reason}` or an OS error code; the win32 bridge's
 * `notification_tray_absent` carries its own scope payload).
 */
export type NotificationErrorDetails =
  | { kind: "platform"; platform: string }
  | { field: string; lengthUtf16?: number; limit?: number };

export interface NotificationErrorDescriptor {
  code: NotificationErrorCode;
  message: string;
  details?: NotificationErrorDetails;
}

/**
 * Typed rejection of the notification facade: facade preflight failures
 * (platform, payload bounds/shape) and normalized broker/native notification
 * rejections. Consumers match on `code`; the human `message` is not a
 * contract. The shared transport-close code is surfaced unchanged (the frozen
 * notification family has no transport alias; core never branches on
 * extension names).
 */
export class NotificationError extends Error {
  readonly code: NotificationErrorCode;
  readonly details?: unknown;

  constructor(
    code: NotificationErrorCode,
    message: string,
    options: { details?: unknown; cause?: unknown } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "NotificationError";
    this.code = code;
    if (options.details !== undefined) {
      this.details = options.details;
    }
  }
}

export const notificationErrorFromDescriptor = (
  descriptor: NotificationErrorDescriptor,
  options: { cause?: unknown } = {}
): NotificationError =>
  new NotificationError(descriptor.code, descriptor.message, {
    ...(descriptor.details === undefined ? {} : { details: descriptor.details }),
    ...(options.cause === undefined ? {} : { cause: options.cause }),
  });

export const platformUnsupported = (platform: string): NotificationErrorDescriptor => ({
  code: NOTIFICATION_ERROR_CODES.platformUnsupported,
  message: `native notifications are unsupported on ${platform} (Linux has no native implementation; add-ext-notification design reference section 0)`,
  details: { kind: "platform", platform },
});

// ---------------------------------------------------------------------------
// Runtime shape guards (wire results and DTO)
// ---------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const AUTHORIZATION_STATUSES: readonly string[] = ["granted", "denied", "notDetermined"];

export const isNotificationBackendEvent = (
  value: unknown
): value is NotificationBackendEvent =>
  isRecord(value) &&
  value.type === "backend" &&
  isNotificationBackendCapabilities(value.backend);

export const isNotificationAuthorizationEvent = (
  value: unknown
): value is NotificationAuthorizationEvent =>
  isRecord(value) &&
  value.type === "authorization" &&
  typeof value.status === "string" &&
  AUTHORIZATION_STATUSES.includes(value.status);

export const isNotificationAuthorizationDecisionEvent = (
  value: unknown
): value is NotificationAuthorizationDecisionEvent =>
  isRecord(value) && value.type === "authorizationDecision" && typeof value.granted === "boolean";

// ---------------------------------------------------------------------------
// Preflight validation (design reference section 1, frozen bounds; UTF-16
// code units counted by String.length; deterministic order: object shape ->
// unknown fields -> title -> body -> subtitle -> silent -> win32 joined
// body). Everything here fails before any state change or transport use, and
// payloads are never silently truncated.
// ---------------------------------------------------------------------------

const NOTIFY_FIELDS = ["title", "body", "subtitle", "silent"] as const;

const payloadInvalid = (
  reason: string,
  field?: string,
  lengthUtf16?: number,
  limit?: number
): NotificationErrorDescriptor => ({
  code: NOTIFICATION_ERROR_CODES.payloadInvalid,
  message:
    field === undefined
      ? `invalid notify options: ${reason}`
      : `invalid notify options (${field}): ${reason}`,
  ...(field === undefined
    ? {}
    : {
        details: {
          field,
          ...(lengthUtf16 === undefined ? {} : { lengthUtf16 }),
          ...(limit === undefined ? {} : { limit }),
        },
      }),
});

/**
 * win32 documented degradation (design reference section 1): the subtitle
 * prefixes the body through a single em dash; a subtitle without a body is
 * the subtitle alone (no dangling separator). The joined string is what the
 * combined 256-unit limit measures.
 */
export const joinWin32Body = (subtitle: string, body: string | undefined): string =>
  body === undefined ? subtitle : `${subtitle}—${body}`;

export const validateNotifyOptions = (
  options: unknown,
  platform: NotificationNativePlatform
): NotificationErrorDescriptor | null => {
  if (!isRecord(options)) {
    return payloadInvalid("options must be an object");
  }
  for (const key of Object.keys(options)) {
    if (!(NOTIFY_FIELDS as readonly string[]).includes(key)) {
      // v1 has no platform namespace and no passthrough fields (design
      // reference section 1); an unknown field is never silently ignored.
      return payloadInvalid("unknown field", key);
    }
  }
  if (typeof options.title !== "string") {
    return payloadInvalid("must be a string", "title");
  }
  if (options.title.length === 0) {
    return payloadInvalid("must be non-empty", "title", 0, NOTIFICATION_TITLE_LIMIT_UTF16);
  }
  if (options.title.length > NOTIFICATION_TITLE_LIMIT_UTF16) {
    return payloadInvalid(
      `exceeds the ${NOTIFICATION_TITLE_LIMIT_UTF16} UTF-16 code unit limit`,
      "title",
      options.title.length,
      NOTIFICATION_TITLE_LIMIT_UTF16
    );
  }
  if (options.body !== undefined) {
    if (typeof options.body !== "string") {
      return payloadInvalid("must be a string when present", "body");
    }
    if (options.body.length > NOTIFICATION_BODY_LIMIT_UTF16) {
      return payloadInvalid(
        `exceeds the ${NOTIFICATION_BODY_LIMIT_UTF16} UTF-16 code unit limit`,
        "body",
        options.body.length,
        NOTIFICATION_BODY_LIMIT_UTF16
      );
    }
  }
  if (options.subtitle !== undefined) {
    if (typeof options.subtitle !== "string") {
      return payloadInvalid("must be a string when present", "subtitle");
    }
    if (options.subtitle.length > NOTIFICATION_SUBTITLE_LIMIT_UTF16) {
      return payloadInvalid(
        `exceeds the ${NOTIFICATION_SUBTITLE_LIMIT_UTF16} UTF-16 code unit limit`,
        "subtitle",
        options.subtitle.length,
        NOTIFICATION_SUBTITLE_LIMIT_UTF16
      );
    }
  }
  if (options.silent !== undefined && typeof options.silent !== "boolean") {
    return payloadInvalid("must be a boolean when present", "silent");
  }
  if (platform === "win32" && options.subtitle !== undefined) {
    // The degradation join is jointly validated against the post-join 256
    // limit — an overflow rejects typed rather than truncating.
    const joined = joinWin32Body(options.subtitle, options.body);
    if (joined.length > NOTIFICATION_BODY_LIMIT_UTF16) {
      return payloadInvalid(
        `the joined subtitle-prefixed body exceeds the ${NOTIFICATION_BODY_LIMIT_UTF16} UTF-16 code unit limit (win32 subtitle degradation)`,
        "body",
        joined.length,
        NOTIFICATION_BODY_LIMIT_UTF16
      );
    }
  }
  return null;
};

/** Apply the frozen wire projection: `silent` explicit; win32 joins the subtitle into `body` (no `subtitle` on the win32 wire). */
export const notifyCommandOptions = (
  options: NotifyOptions,
  platform: NotificationNativePlatform
): NotifyWireOptions => {
  if (platform === "win32" && options.subtitle !== undefined) {
    const joined = joinWin32Body(options.subtitle, options.body);
    return {
      title: options.title,
      body: joined,
      silent: options.silent === true,
    };
  }
  return {
    title: options.title,
    ...(options.body !== undefined ? { body: options.body } : {}),
    ...(options.subtitle !== undefined ? { subtitle: options.subtitle } : {}),
    silent: options.silent === true,
  };
};
