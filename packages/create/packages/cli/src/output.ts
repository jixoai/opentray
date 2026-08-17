// Machine-readable output contract (openspec change add-create-opentray-cli).
//
// In --json mode stdout carries ONLY the result document; progress and
// diagnostics use stderr. Environment values are never echoed into ordinary
// diagnostic output.

export interface CliStreams {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

export const consoleStreams: CliStreams = {
  out: (line) => {
    process.stdout.write(`${line}\n`);
  },
  err: (line) => {
    process.stderr.write(`${line}\n`);
  },
};

export interface TypedFailure {
  readonly ok: false;
  readonly error: { readonly code: string; readonly message: string; readonly details?: unknown };
}

export interface TypedSuccess<T> {
  readonly ok: true;
  readonly result: T;
}

export type CliOutcome<T = unknown> = TypedSuccess<T> | TypedFailure;

/** Stable exit-code categories shared by every command. */
export const exitCodeFor = (code: string): number => {
  switch (code) {
    case "invalid_config":
    case "incompatible_version":
    case "identity_mismatch":
    case "export_unsafe":
    case "env_ack_required":
      return 2; // usage/validation
    case "not_found":
      return 4;
    case "already_exists":
    case "not_empty":
    case "ownership_unverified":
      return 5;
    case "app_running":
      return 6;
    case "pid_reused":
    case "process_unverified":
      return 7;
    case "resource_invalid":
    case "resource_fetch_failed":
      return 8;
    case "path_escape":
      return 9;
    case "link_unsupported":
    case "capability_unavailable":
      return 10;
    default:
      return 1; // internal/unknown
  }
};

export const emitOutcome = <T>(
  outcome: CliOutcome<T>,
  streams: CliStreams,
  json: boolean,
  render?: (result: T) => string,
): number => {
  if (json) {
    // JSON mode: stdout is ONLY the typed result document.
    streams.out(JSON.stringify(outcome.ok ? { ok: true, result: outcome.result } : { ok: false, error: outcome.error }));
    return outcome.ok ? 0 : exitCodeFor(outcome.error.code);
  }
  if (!outcome.ok) {
    streams.err(`error [${outcome.error.code}]: ${outcome.error.message}`);
    return exitCodeFor(outcome.error.code);
  }
  if (render !== undefined) {
    const text = render(outcome.result);
    if (text.length > 0) {
      streams.out(text);
    }
  }
  return 0;
};

export const emitProgress = (message: string, streams: CliStreams, json: boolean): void => {
  // Progress NEVER pollutes JSON stdout.
  if (!json) {
    streams.err(message);
  }
};
