// Typed result/error model for create-opentray Core (openspec change
// unify-create-opentray-core). Core procedures return typed results instead
// of throwing so CLI and WebUI adapters can map failures to stable exit
// categories and rendered states without string matching.

export type CreateErrorCode =
  | "invalid_config"
  | "incompatible_version"
  | "identity_mismatch"
  | "already_exists"
  | "not_found"
  | "not_empty"
  | "ownership_unverified"
  | "resource_invalid"
  | "resource_fetch_failed"
  | "path_escape"
  | "app_running"
  | "pid_reused"
  | "process_unverified"
  | "link_unsupported"
  | "registry_io"
  | "capability_unavailable"
  | "export_unsafe"
  | "env_ack_required"
  | "internal";

export interface CreateError {
  readonly code: CreateErrorCode;
  readonly message: string;
  /** Stable machine-readable details (paths, keys); never environment values. */
  readonly details?: Readonly<Record<string, string | number | boolean>>;
}

export type Result<T> = { readonly ok: true; readonly value: T } | {
  readonly ok: false;
  readonly error: CreateError;
};

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export const err = (
  code: CreateErrorCode,
  message: string,
  details?: Readonly<Record<string, string | number | boolean>>,
): Result<never> => ({ ok: false, error: { code, message, ...(details === undefined ? {} : { details }) } });

export const isCreateError = (value: unknown): value is CreateError =>
  typeof value === "object" &&
  value !== null &&
  "code" in value &&
  "message" in value &&
  typeof (value as { code: unknown }).code === "string" &&
  typeof (value as { message: unknown }).message === "string";

/** Wrap a throwing procedure into a typed internal result. */
export const attempt = async <T>(
  code: CreateErrorCode,
  run: () => Promise<T> | T,
): Promise<Result<T>> => {
  try {
    return ok(await run());
  } catch (error) {
    if (isCreateError(error)) {
      return { ok: false, error };
    }
    return {
      ok: false,
      error: {
        code,
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
};
