// Orthogonal intents (2026-09-17; add-ext-dialog batch C):
// 1. Attach the dialog capability through the normal tray extension family
//    (tray.extend, session-scoped, isomorphic to attachBadge/attachWebview).
// 2. Fail every preflight branch before any state change: typed platform,
//    namespace, and option rejections never reach the transport.
// 3. Settle show-class commands through the DeferredOperation terminal frame
//    (design reference section 5.1) and map the shared transport-close code
//    onto this facade's public dialog_transport_closed.

import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, normalize as normalizePath } from "node:path";

import type {
  ExtensionRequestResult,
  NativeExtensionArtifact,
  TrayExtensionContext,
  TrayHandle,
} from "opentray";
import {
  BrokerServerError,
  EXTENSION_TRANSPORT_CLOSED_CODE,
  ExtensionOperationError,
  NativeExtensionEmbeddedArtifactError,
} from "opentray";

import { DIALOG_NATIVE_ARTIFACT } from "./native-artifact";
import {
  DIALOG_ERROR_CODES,
  DialogError,
  dialogErrorFromDescriptor,
  directoryPickCommandOptions,
  expandHomeDirectory,
  filePickCommandOptions,
  isDialogBackendCapabilities,
  isDialogBackendEvent,
  isDialogErrorCode,
  isMessageDialogResult,
  isMultiplePickResult,
  isSinglePickResult,
  messageDialogCapabilityRequirements,
  messageDialogCommandOptions,
  platformUnsupported,
  savePickCommandOptions,
  sugarMessageOptions,
  validateDirectoryPickOptions,
  validateFilePickOptions,
  validateMessageDialogOptions,
  validateSavePickOptions,
  type DialogBackendCapabilities,
  type DialogCommand,
  type DialogNativePlatform,
  type DialogPlatform,
  type DirectoryPickOptions,
  type FilePickOptions,
  type MessageDialogOptions,
  type MessageDialogResult,
  type MessageSugarOptions,
  type SavePickOptions,
} from "./shared";

export type * from "./shared";
export {
  DIALOG_ERROR_CODES,
  DialogError,
  isDialogBackendCapabilities,
  isDialogBackendEvent,
  isDialogErrorCode,
  isMessageDialogResult,
  isMultiplePickResult,
  isSinglePickResult,
} from "./shared";
export { DIALOG_NATIVE_ARTIFACT } from "./native-artifact";

const DIALOG_EXTENSION_NAME = "dialog";

export interface DialogExtensionOptions {
  mountId?: string;
  artifact?: NativeExtensionArtifact;
  /** Test/seam override for the host platform; Linux rejects typed before any dispatch. */
  platform?: DialogPlatform;
}

/**
 * Public dialog capability (design reference section 1): message sugar over
 * the strict messageDialog contract, file/directory/save pickers, and the
 * async backend capabilities snapshot.
 */
export interface DialogCapability {
  alert(message: string, options?: MessageSugarOptions): Promise<void>;
  confirm(message: string, options?: MessageSugarOptions): Promise<boolean>;
  messageDialog(options: MessageDialogOptions): Promise<MessageDialogResult>;
  pickFile(options?: FilePickOptions & { multiple?: false }): Promise<string | null>;
  pickFile(options: FilePickOptions & { multiple: true }): Promise<readonly string[] | null>;
  pickDirectory(options?: DirectoryPickOptions): Promise<string | null>;
  pickSavePath(options?: SavePickOptions): Promise<string | null>;
  getBackend(): Promise<DialogBackendCapabilities>;
}

export const attachDialog = (
  tray: TrayHandle,
  options: DialogExtensionOptions = {}
): DialogCapability => tray.extend(DialogExt, options);

export const DialogExt = {
  name: DIALOG_EXTENSION_NAME,
  artifact: DIALOG_NATIVE_ARTIFACT,
  resolveMount(options: DialogExtensionOptions | undefined) {
    return {
      ...(options?.mountId === undefined ? {} : { mountId: options.mountId }),
      ...(options?.artifact === undefined ? {} : { artifact: options.artifact }),
    };
  },
  extend(
    tray: TrayHandle,
    context: TrayExtensionContext,
    options: DialogExtensionOptions | undefined
  ): DialogCapability {
    return createDialogCapability(
      context,
      (options?.platform ?? process.platform) as DialogPlatform
    );
  },
} satisfies import("opentray").TrayExtension<DialogCapability, DialogExtensionOptions>;

function createDialogCapability(
  context: TrayExtensionContext,
  platform: DialogPlatform
): DialogCapability {
  const nativePlatform: DialogNativePlatform | undefined =
    platform === "darwin" || platform === "win32" ? platform : undefined;

  const requirePlatform = (): DialogNativePlatform => {
    if (nativePlatform === undefined) {
      throw dialogErrorFromDescriptor(platformUnsupported(platform));
    }
    return nativePlatform;
  };

  interface TypedTransportRejection {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
    readonly error: ExtensionOperationError | BrokerServerError;
  }

  const typedTransportRejection = (error: unknown): TypedTransportRejection | undefined => {
    if (error instanceof ExtensionOperationError || error instanceof BrokerServerError) {
      return { code: error.code, message: error.message, details: error.details, error };
    }
    return undefined;
  };

  const mapTransportError = (error: unknown): unknown => {
    if (error instanceof DialogError) {
      return error;
    }
    if (
      error instanceof NativeExtensionEmbeddedArtifactError &&
      error.reason === "target-unsupported"
    ) {
      return new DialogError(
        DIALOG_ERROR_CODES.platformUnsupported,
        `native dialog extension ships no library for this platform: ${error.message}`,
        { details: { kind: "platform", platform }, cause: error }
      );
    }
    const typed = typedTransportRejection(error);
    if (typed === undefined) {
      return error;
    }
    if (typed.code === EXTENSION_TRANSPORT_CLOSED_CODE) {
      return new DialogError(
        DIALOG_ERROR_CODES.transportClosed,
        "the broker transport closed while a dialog operation was pending",
        { details: { kind: "transport" }, cause: typed.error }
      );
    }
    if (isDialogErrorCode(typed.code)) {
      return new DialogError(typed.code, typed.message, {
        ...(typed.details === undefined ? {} : { details: typed.details }),
        cause: typed.error,
      });
    }
    return error;
  };

  const dispatch = async <TValue>(
    command: DialogCommand
  ): Promise<ExtensionRequestResult<TValue>> => {
    try {
      return await context.request<TValue>(command);
    } catch (error: unknown) {
      throw mapTransportError(error);
    }
  };

  const unwrapTerminal = <TValue>(
    result: ExtensionRequestResult<unknown>,
    guard: (value: unknown) => value is TValue,
    label: string
  ): TValue => {
    if (result.kind !== "terminal") {
      throw new Error(
        `${label} must settle through a deferred operation terminal (add-ext-dialog section 5.1); received ${result.kind}`
      );
    }
    if (!guard(result.value)) {
      throw new Error(`${label} deferred terminal payload violated the wire contract`);
    }
    return result.value;
  };

  const freezeBackend = (backend: DialogBackendCapabilities): DialogBackendCapabilities =>
    Object.freeze({ ...backend });

  const backendFromRequestResult = (
    result: ExtensionRequestResult<unknown>,
    native: DialogNativePlatform
  ): DialogBackendCapabilities => {
    if (result.kind === "terminal") {
      if (!isDialogBackendCapabilities(result.value)) {
        throw backendContractError();
      }
      return expectBackendPlatform(result.value, native);
    }
    for (const event of result.events) {
      if (isDialogBackendEvent(event.data) && isDialogBackendCapabilities(event.data.backend)) {
        return expectBackendPlatform(event.data.backend, native);
      }
    }
    throw backendContractError();
  };

  const backendContractError = (): Error =>
    new Error(
      "dialog extension answered getBackend without a backend capabilities payload (wire contract violation)"
    );

  const expectBackendPlatform = (
    backend: DialogBackendCapabilities,
    native: DialogNativePlatform
  ): DialogBackendCapabilities => {
    if (backend.platform !== native) {
      throw new Error(
        `dialog backend reported platform ${backend.platform} on a ${native} host (wire contract violation)`
      );
    }
    return backend;
  };

  let backendPromise: Promise<DialogBackendCapabilities> | undefined;

  const ensureBackend = (native: DialogNativePlatform): Promise<DialogBackendCapabilities> => {
    backendPromise ??= (async () => {
      const result = await dispatch<unknown>({ type: "getBackend" });
      return freezeBackend(backendFromRequestResult(result, native));
    })().catch((error: unknown) => {
      // Allow a later retry after a failed snapshot (e.g. transport death);
      // a successful snapshot is immutable and shared by every dispatch.
      backendPromise = undefined;
      throw mapTransportError(error);
    });
    return backendPromise;
  };

  // Picker-result canonicalization (design reference section 1.2): absolute
  // paths with `~` expanded; an existing path resolves through realpath, a
  // not-yet-existing leaf (save) canonicalizes its deepest existing ancestor
  // and re-attaches the remaining segments lexically. The save result is not
  // guaranteed to exist.
  const canonicalizePickedPath = async (input: string): Promise<string> => {
    const normalized = normalizePath(expandHomeDirectory(input, homedir()));
    const pending: string[] = [];
    let current = normalized;
    for (let depth = 0; depth < 128; depth += 1) {
      let real: string;
      try {
        real = await realpath(current);
      } catch {
        const parent = dirname(current);
        if (parent === current) {
          return normalized;
        }
        pending.unshift(basename(current));
        current = parent;
        continue;
      }
      return pending.length === 0 ? real : join(real, ...pending);
    }
    return normalized;
  };

  const canonicalizeSingle = async (
    value: string | null
  ): Promise<string | null> =>
    value === null ? null : canonicalizePickedPath(value);

  const canonicalizeMultiple = async (
    value: readonly string[] | null
  ): Promise<readonly string[] | null> =>
    value === null ? null : Promise.all(value.map((item) => canonicalizePickedPath(item)));

  const runMessageDialog = async (
    options: MessageDialogOptions
  ): Promise<MessageDialogResult> => {
    const native = requirePlatform();
    const issue = validateMessageDialogOptions(options, native);
    if (issue !== null) {
      throw dialogErrorFromDescriptor(issue);
    }
    const required = messageDialogCapabilityRequirements(options, native);
    if (required.length > 0) {
      const backend = await ensureBackend(native);
      for (const flag of required) {
        if (backend[flag] !== true) {
          throw new DialogError(
            DIALOG_ERROR_CODES.capabilityUnavailable,
            `dialog capability ${flag} is unavailable on ${native} (getBackend snapshot); refusing to silently degrade`,
            { details: { kind: "capability", capability: flag, platform: native } }
          );
        }
      }
    }
    const result = await dispatch<unknown>({
      type: "messageDialog",
      options: messageDialogCommandOptions(options),
    });
    return unwrapTerminal(result, isMessageDialogResult, "messageDialog");
  };

  function pickFile(options?: FilePickOptions & { multiple?: false }): Promise<string | null>;
  function pickFile(options: FilePickOptions & { multiple: true }): Promise<readonly string[] | null>;
  function pickFile(
    options?: FilePickOptions & { multiple?: boolean }
  ): Promise<string | readonly string[] | null>;
  async function pickFile(
    options?: FilePickOptions & { multiple?: boolean }
  ): Promise<string | readonly string[] | null> {
    const native = requirePlatform();
    const issue = validateFilePickOptions(options, native);
    if (issue !== null) {
      throw dialogErrorFromDescriptor(issue);
    }
    const multiple = options?.multiple === true;
    const result = await dispatch<unknown>({
      type: "pickFile",
      options: filePickCommandOptions(options),
    });
    if (multiple) {
      return canonicalizeMultiple(unwrapTerminal(result, isMultiplePickResult, "pickFile"));
    }
    return canonicalizeSingle(unwrapTerminal(result, isSinglePickResult, "pickFile"));
  }

  return {
    alert: async (message: string, options?: MessageSugarOptions): Promise<void> => {
      await runMessageDialog(sugarMessageOptions(message, options, ["OK"], 0));
    },
    confirm: async (message: string, options?: MessageSugarOptions): Promise<boolean> => {
      const result = await runMessageDialog(
        sugarMessageOptions(message, options, ["OK", "Cancel"], 0, 1)
      );
      return result.response === 0;
    },
    messageDialog: runMessageDialog,
    pickFile,
    pickDirectory: async (
      options?: DirectoryPickOptions
    ): Promise<string | null> => {
      const native = requirePlatform();
      const issue = validateDirectoryPickOptions(options, native);
      if (issue !== null) {
        throw dialogErrorFromDescriptor(issue);
      }
      const result = await dispatch<unknown>({
        type: "pickDirectory",
        options: directoryPickCommandOptions(options),
      });
      return canonicalizeSingle(
        unwrapTerminal(result, isSinglePickResult, "pickDirectory")
      );
    },
    pickSavePath: async (options?: SavePickOptions): Promise<string | null> => {
      const native = requirePlatform();
      const issue = validateSavePickOptions(options, native);
      if (issue !== null) {
        throw dialogErrorFromDescriptor(issue);
      }
      const result = await dispatch<unknown>({
        type: "pickSavePath",
        options: savePickCommandOptions(options),
      });
      return canonicalizeSingle(
        unwrapTerminal(result, isSinglePickResult, "pickSavePath")
      );
    },
    getBackend: async (): Promise<DialogBackendCapabilities> =>
      ensureBackend(requirePlatform()),
  };
}
