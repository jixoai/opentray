// Orthogonal intents (2026-09-18; add-ext-opener tasks 4.1/4.2):
// 1. Attach the opener capability through the normal tray extension family
//    (tray.extend, session-scoped, isomorphic to attachSound/attachDialog).
// 2. Fail every preflight branch before any transport use: typed platform
//    rejection on Linux (zero broker frames), the frozen open() target
//    matrix (absolute paths verbatim — existence is NOT a precondition;
//    URL schemes through the frozen allowlist, case-insensitive; `file:`
//    URLs never normalize to paths; drive-relative/relative reject typed),
//    and the revealInFolder rejection set + trim law (reject-not-escape).
// 3. Dispatch open/revealInFolder through the camelCase ext-command
//    envelope on the V2 immediate path (design reference section 1:
//    resolve-on-acceptance — no deferred operations, no operationId
//    handling), and answer getBackend() with the frozen immutable DTO
//    snapshot through the `{type:"backend"}` ABI shape.

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
import type { OpenerBackendCapabilities } from "@opentray/spec";

import { OPENER_NATIVE_ARTIFACT } from "./native-artifact";
import {
  OPENER_ERROR_CODES,
  OpenerError,
  isOpenerBackendEvent,
  isOpenerErrorCode,
  openerErrorFromDescriptor,
  platformUnsupported,
  preflightOpenTarget,
  preflightRevealPath,
  type OpenerCommand,
  type OpenerNativePlatform,
  type OpenerPlatform,
} from "./shared";

export type * from "./shared";
export {
  OPENER_ALLOWED_SCHEMES,
  OPENER_ERROR_CODES,
  OpenerError,
  isOpenerAllowedScheme,
  isOpenerBackendCapabilities,
  isOpenerBackendEvent,
  isOpenerErrorCode,
  classifyOpenerTarget,
  isRevealRoot,
  isLegalAbsolutePath,
  openerSchemeAllowed,
  preflightOpenTarget,
  preflightRevealPath,
} from "./shared";
export { OPENER_NATIVE_ARTIFACT } from "./native-artifact";

const OPENER_EXTENSION_NAME = "opener";

export interface OpenerExtensionOptions {
  mountId?: string;
  artifact?: NativeExtensionArtifact;
  /** Test/seam override for the host platform; Linux rejects typed before any dispatch. */
  platform?: OpenerPlatform;
}

/**
 * v1 reserved-empty options objects: `open`/`revealInFolder` carry no
 * settings; an unknown field is a programming error, never a silently
 * ignored setting.
 */
export interface OpenOptions {
  // Intentionally empty in v1.
}

export interface RevealInFolderOptions {
  // Intentionally empty in v1.
}

/**
 * Public opener capability (design reference section 1): open a URL or
 * absolute file path with the user's default application, reveal a path
 * in the file manager, and read the async backend capabilities snapshot.
 * `open`/`revealInFolder` resolve on acceptance (the native call was
 * taken) — when and whether the target application presents is not part
 * of the acceptance semantics.
 */
export interface OpenerCapability {
  open(target: string, options?: OpenOptions): Promise<void>;
  revealInFolder(path: string, options?: RevealInFolderOptions): Promise<void>;
  getBackend(): Promise<OpenerBackendCapabilities>;
}

export const attachOpener = (
  tray: TrayHandle,
  options: OpenerExtensionOptions = {}
): OpenerCapability => tray.extend(OpenerExt, options);

export const OpenerExt = {
  name: OPENER_EXTENSION_NAME,
  artifact: OPENER_NATIVE_ARTIFACT,
  resolveMount(options: OpenerExtensionOptions | undefined) {
    return {
      ...(options?.mountId === undefined ? {} : { mountId: options.mountId }),
      ...(options?.artifact === undefined ? {} : { artifact: options.artifact }),
    };
  },
  extend(
    tray: TrayHandle,
    context: TrayExtensionContext,
    options: OpenerExtensionOptions | undefined
  ): OpenerCapability {
    return createOpenerCapability(
      context,
      (options?.platform ?? process.platform) as OpenerPlatform
    );
  },
} satisfies import("opentray").TrayExtension<OpenerCapability, OpenerExtensionOptions>;

function createOpenerCapability(
  context: TrayExtensionContext,
  platform: OpenerPlatform
): OpenerCapability {
  const nativePlatform: OpenerNativePlatform | undefined =
    platform === "darwin" || platform === "win32" ? platform : undefined;

  const requirePlatform = (): OpenerNativePlatform => {
    if (nativePlatform === undefined) {
      throw openerErrorFromDescriptor(platformUnsupported(platform));
    }
    return nativePlatform;
  };

  const mapTransportError = (error: unknown): unknown => {
    if (error instanceof OpenerError) {
      return error;
    }
    if (
      error instanceof NativeExtensionEmbeddedArtifactError &&
      error.reason === "target-unsupported"
    ) {
      return new OpenerError(
        OPENER_ERROR_CODES.platformUnsupported,
        `native opener extension ships no library for this platform: ${error.message}`,
        { details: { kind: "platform", platform }, cause: error }
      );
    }
    if (
      (error instanceof ExtensionOperationError || error instanceof BrokerServerError) &&
      isOpenerErrorCode(error.code)
    ) {
      return new OpenerError(error.code, error.message, {
        ...(error.details === undefined ? {} : { details: error.details }),
        cause: error,
      });
    }
    // The shared transport-close code and unknown codes surface unchanged:
    // the frozen opener family has no transport alias and core never
    // branches on extension names (add-ext-opener design reference
    // section 3).
    return error;
  };

  const dispatch = async <TValue>(
    command: OpenerCommand
  ): Promise<Extract<ExtensionRequestResult<TValue>, { kind: "immediate" }>> => {
    try {
      const result = await context.request<TValue>(command);
      if (result.kind !== "immediate") {
        throw new Error(
          `opener extension commands settle on the immediate path (add-ext-opener section 1; no deferred operations); received ${result.kind}`
        );
      }
      return result;
    } catch (error: unknown) {
      throw mapTransportError(error);
    }
  };

  const backendContractError = (): Error =>
    new Error(
      "opener extension answered getBackend without a backend capabilities payload (wire contract violation)"
    );

  const expectBackendPlatform = (
    backend: OpenerBackendCapabilities,
    native: OpenerNativePlatform
  ): OpenerBackendCapabilities => {
    if (backend.platform !== native) {
      throw new Error(
        `opener backend reported platform ${backend.platform} on a ${native} host (wire contract violation)`
      );
    }
    return backend;
  };

  /** Frozen immutable snapshot: the record and its committed scheme list are both frozen. */
  const freezeBackend = (backend: OpenerBackendCapabilities): OpenerBackendCapabilities =>
    Object.freeze({
      ...backend,
      allowedSchemes: Object.freeze([...backend.allowedSchemes]) as OpenerBackendCapabilities["allowedSchemes"],
    });

  let backendPromise: Promise<OpenerBackendCapabilities> | undefined;

  const ensureBackend = (native: OpenerNativePlatform): Promise<OpenerBackendCapabilities> => {
    backendPromise ??= (async () => {
      const result = await dispatch<unknown>({ type: "getBackend" });
      for (const event of result.events) {
        if (isOpenerBackendEvent(event.data)) {
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

  const assertNoUnknownOptions = (
    options: OpenOptions | RevealInFolderOptions | undefined,
    method: "open" | "revealInFolder"
  ): void => {
    if (options === undefined) {
      return;
    }
    const unknown = Object.keys(options).find((key) => key.length > 0);
    if (unknown !== undefined) {
      // v1 carries no options (design reference section 1); a value here is
      // a programming error, never a silently ignored setting.
      throw new TypeError(
        `${method} accepts no options in v1 (reserved empty options object); unknown field: ${unknown}`
      );
    }
  };

  const assertTargetString = (value: unknown, method: "open" | "revealInFolder"): void => {
    if (typeof value !== "string" || value.length === 0) {
      throw new TypeError(`${method} requires a non-empty target string`);
    }
  };

  return {
    open: async (target: string, options?: OpenOptions): Promise<void> => {
      assertTargetString(target, "open");
      assertNoUnknownOptions(options, "open");
      requirePlatform();
      // Frozen preflight matrix (design reference section 2): legal targets
      // dispatch VERBATIM — paths and `\\?\` forms pass literally, URLs
      // pass as-is, `file:` URLs never normalize to paths, and existence
      // is not a precondition.
      const rejection = preflightOpenTarget(target);
      if (rejection !== null) {
        throw rejection;
      }
      await dispatch<unknown>({ type: "open", target });
    },
    revealInFolder: async (path: string, options?: RevealInFolderOptions): Promise<void> => {
      assertTargetString(path, "revealInFolder");
      assertNoUnknownOptions(options, "revealInFolder");
      const native = requirePlatform();
      // Frozen rejection set + trim law (design reference section 2):
      // rejections are typed pre-transport; the raw path dispatches and
      // the native side re-derives the /select construction.
      const plan = preflightRevealPath(path, native);
      if (plan instanceof OpenerError) {
        throw plan;
      }
      await dispatch<unknown>({ type: "revealInFolder", path });
    },
    getBackend: async (): Promise<OpenerBackendCapabilities> =>
      ensureBackend(requirePlatform()),
  };
}
