// Orthogonal intents (2026-09-18; add-ext-notification batch C):
// 1. Attach the notification capability through the normal tray extension
//    family (tray.extend, session-scoped, isomorphic to
//    attachDialog/attachSound/attachClipboard).
// 2. Fail every preflight branch before any transport use: typed platform
//    rejection on Linux (zero broker frames), the frozen payload bounds
//    matrix including the win32 subtitle-join combined limit, and unknown
//    attach option fields (TypeError) — never a silent truncation and never
//    a silently ignored setting.
// 3. Dispatch notify/getBackend on the V2 immediate path (design reference
//    sections 1-2: notify is non-modal resolve-on-acceptance) and settle the
//    two authorization commands transport-agnostically: darwin's
//    DeferredOperation terminal (O2 ruling — the 10s timeout fires
//    broker-side into typed notification_failed) or win32's Immediate event
//    answer, whichever the broker resolves the request with.

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

import { NOTIFICATION_NATIVE_ARTIFACT } from "./native-artifact";
import {
  NOTIFICATION_ERROR_CODES,
  NotificationError,
  isNotificationAuthorizationDecisionEvent,
  isNotificationAuthorizationEvent,
  isNotificationBackendEvent,
  isNotificationErrorCode,
  notificationErrorFromDescriptor,
  notifyCommandOptions,
  platformUnsupported,
  validateNotifyOptions,
  type NotificationAuthorizationStatus,
  type NotificationBackendCapabilities,
  type NotificationCommand,
  type NotificationNativePlatform,
  type NotificationPlatform,
  type NotifyOptions,
} from "./shared";

export type * from "./shared";
export {
  NOTIFICATION_ERROR_CODES,
  NotificationError,
  isNotificationAuthorizationDecisionEvent,
  isNotificationAuthorizationEvent,
  isNotificationBackendEvent,
  isNotificationErrorCode,
  joinWin32Body,
  notificationErrorFromDescriptor,
  validateNotifyOptions,
} from "./shared";
export { NOTIFICATION_NATIVE_ARTIFACT } from "./native-artifact";

const NOTIFICATION_EXTENSION_NAME = "notification";

const ATTACH_OPTION_KEYS: ReadonlySet<string> = new Set(["mountId", "artifact", "platform"]);

export interface NotificationExtensionOptions {
  mountId?: string;
  artifact?: NativeExtensionArtifact;
  /** Test/seam override for the host platform; Linux rejects typed before any dispatch. */
  platform?: NotificationPlatform;
}

/**
 * Public notification capability (design reference section 1): host-side OS
 * notifications plus the authorization surface. `notify` is
 * resolve-on-acceptance (the sound law): whether and when the user actually
 * sees the notification is not part of the acceptance semantics. On darwin
 * the authorization commands carry real UNUserNotificationCenter semantics;
 * on win32 they are documented always-granted degradations answered
 * Immediate — the facade accepts both settle shapes for either platform.
 */
export interface NotificationCapability {
  notify(options: NotifyOptions): Promise<void>;
  getAuthorizationStatus(): Promise<NotificationAuthorizationStatus>;
  /** darwin: real decision. win32: documented degradation, always `true`. */
  requestAuthorization(): Promise<boolean>;
  getBackend(): Promise<NotificationBackendCapabilities>;
}

export const attachNotification = (
  tray: TrayHandle,
  options: NotificationExtensionOptions = {}
): NotificationCapability => {
  const unknown = Object.keys(options).find((key) => !ATTACH_OPTION_KEYS.has(key));
  if (unknown !== undefined) {
    // v1 has exactly the family option surface; an unknown field is a
    // programming error, never a silently ignored setting (pre-transport).
    throw new TypeError(
      `attachNotification received an unknown option field: ${unknown} (v1 accepts mountId, artifact, platform)`
    );
  }
  return tray.extend(NotificationExt, options);
};

export const NotificationExt = {
  name: NOTIFICATION_EXTENSION_NAME,
  artifact: NOTIFICATION_NATIVE_ARTIFACT,
  resolveMount(options: NotificationExtensionOptions | undefined) {
    return {
      ...(options?.mountId === undefined ? {} : { mountId: options.mountId }),
      ...(options?.artifact === undefined ? {} : { artifact: options.artifact }),
    };
  },
  extend(
    tray: TrayHandle,
    context: TrayExtensionContext,
    options: NotificationExtensionOptions | undefined
  ): NotificationCapability {
    return createNotificationCapability(
      context,
      (options?.platform ?? process.platform) as NotificationPlatform
    );
  },
} satisfies import("opentray").TrayExtension<NotificationCapability, NotificationExtensionOptions>;

function createNotificationCapability(
  context: TrayExtensionContext,
  platform: NotificationPlatform
): NotificationCapability {
  const nativePlatform: NotificationNativePlatform | undefined =
    platform === "darwin" || platform === "win32" ? platform : undefined;

  const requirePlatform = (): NotificationNativePlatform => {
    if (nativePlatform === undefined) {
      throw notificationErrorFromDescriptor(platformUnsupported(platform));
    }
    return nativePlatform;
  };

  const mapTransportError = (error: unknown): unknown => {
    if (error instanceof NotificationError) {
      return error;
    }
    if (
      error instanceof NativeExtensionEmbeddedArtifactError &&
      error.reason === "target-unsupported"
    ) {
      return new NotificationError(
        NOTIFICATION_ERROR_CODES.platformUnsupported,
        `native notification extension ships no library for this platform: ${error.message}`,
        { details: { kind: "platform", platform }, cause: error }
      );
    }
    if (
      (error instanceof ExtensionOperationError || error instanceof BrokerServerError) &&
      isNotificationErrorCode(error.code)
    ) {
      // Includes the broker-side 10s authorization timeout: an error terminal
      // arrives as notification_failed with details {reason:
      // "authorization-timeout"} and normalizes here with details intact.
      return new NotificationError(error.code, error.message, {
        ...(error.details === undefined ? {} : { details: error.details }),
        cause: error,
      });
    }
    // The shared transport-close code and unknown codes surface unchanged:
    // the frozen notification family has no transport alias and core never
    // branches on extension names (add-ext-notification design reference
    // section 3).
    return error;
  };

  const dispatch = async <TValue>(
    command: NotificationCommand
  ): Promise<ExtensionRequestResult<TValue>> => {
    try {
      return await context.request<TValue>(command);
    } catch (error: unknown) {
      throw mapTransportError(error);
    }
  };

  const dispatchImmediate = async (
    command: NotificationCommand
  ): Promise<Extract<ExtensionRequestResult<unknown>, { kind: "immediate" }>> => {
    const result = await dispatch<unknown>(command);
    if (result.kind !== "immediate") {
      throw new Error(
        `notification extension command ${command.type} settles on the immediate path (add-ext-notification design reference sections 1-2; only the authorization commands defer); received ${result.kind}`
      );
    }
    return result;
  };

  /**
   * Transport-agnostic authorization settle (design reference section 4):
   * darwin completes through the DeferredOperation terminal whose result
   * value carries the event shape; win32 answers Immediate with the same
   * event shape in the events array. Either resolution path is accepted for
   * either platform — the facade cannot and must not tell them apart.
   */
  const runAuthorizationCommand = async <TEvent>(
    command: NotificationCommand,
    guard: (value: unknown) => value is TEvent,
    label: string
  ): Promise<TEvent> => {
    const result = await dispatch<unknown>(command);
    if (result.kind === "terminal") {
      if (!guard(result.value)) {
        throw new Error(`${label} deferred terminal payload violated the wire contract`);
      }
      return result.value;
    }
    for (const event of result.events) {
      const data = (event as { data?: unknown } | null)?.data;
      if (guard(data)) {
        return data;
      }
    }
    throw new Error(
      `${label} settled without an authorization payload (wire contract violation; expected a deferred terminal or an immediate authorization event)`
    );
  };

  const backendContractError = (): Error =>
    new Error(
      "notification extension answered getBackend without a backend capabilities payload (wire contract violation)"
    );

  const expectBackendPlatform = (
    backend: NotificationBackendCapabilities,
    native: NotificationNativePlatform
  ): NotificationBackendCapabilities => {
    if (backend.platform !== native) {
      throw new Error(
        `notification backend reported platform ${backend.platform} on a ${native} host (wire contract violation)`
      );
    }
    return backend;
  };

  /** Frozen immutable snapshot: the record is deeply plain, so a shallow freeze is total. */
  const freezeBackend = (backend: NotificationBackendCapabilities): NotificationBackendCapabilities =>
    Object.freeze({ ...backend });

  let backendPromise: Promise<NotificationBackendCapabilities> | undefined;

  const ensureBackend = (
    native: NotificationNativePlatform
  ): Promise<NotificationBackendCapabilities> => {
    backendPromise ??= (async () => {
      const result = await dispatchImmediate({ type: "getBackend" });
      for (const event of result.events) {
        const data = (event as { data?: unknown } | null)?.data;
        if (isNotificationBackendEvent(data)) {
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
    notify: async (options: NotifyOptions): Promise<void> => {
      const native = requirePlatform();
      const issue = validateNotifyOptions(options, native);
      if (issue !== null) {
        throw notificationErrorFromDescriptor(issue);
      }
      // Resolve-on-acceptance: the immediate result IS the acceptance; the
      // win32 broker-internal tray-notification bridge answers with the same
      // immediate shape (design reference section 2, O1 ruling B).
      await dispatchImmediate({
        type: "notify",
        options: notifyCommandOptions(options, native),
      });
    },
    getAuthorizationStatus: async (): Promise<NotificationAuthorizationStatus> => {
      requirePlatform();
      const event = await runAuthorizationCommand(
        { type: "getAuthorizationStatus" },
        isNotificationAuthorizationEvent,
        "getAuthorizationStatus"
      );
      return event.status;
    },
    requestAuthorization: async (): Promise<boolean> => {
      requirePlatform();
      const event = await runAuthorizationCommand(
        { type: "requestAuthorization" },
        isNotificationAuthorizationDecisionEvent,
        "requestAuthorization"
      );
      return event.granted;
    },
    getBackend: async (): Promise<NotificationBackendCapabilities> =>
      ensureBackend(requirePlatform()),
  };
}
