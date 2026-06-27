# Runtime / Daemon Operations

Use this reference when the user asks about daemon lifecycle, health, or cleanup.

## CLI Truth

The public `opentray` CLI binary does **not** expose daemon subcommands. Running `opentray daemon health` / `start` / `stop` / `restart` is no longer a supported operator path — the CLI only prints a usage pointer.

If a user references `opentray daemon ...`, correct them: those commands belong to an earlier surface model and have been removed.

## How The Runtime Is Owned Now

OpenTray is tray-first and app-owned:

- For the first app path, prefer `runTrayApp()` from `opentray/node`; it hides the visible host / worker split behind one callback.
- The default `createTray()` transport targets the in-process **visible runtime binding** (`opentray_runtime.node` from the platform package). There is no separate long-lived broker process to "start" or "stop" from the CLI for normal consumer flows.
- The native host loop is explicit on Node: call `runVisibleRuntimeHost()` from `opentray/node` on the host main thread after starting the worker that calls `createTray()`. On macOS this preserves AppKit's main-thread law; on Windows it keeps the event loop app-owned.
- Headless and local-broker paths remain for diagnostics:

```ts
import { createTray } from "opentray";

// default: in-process visible runtime binding
await createTray(options);

// headless protocol/session diagnostics
await createTray(options, { runtime: "headless-binding" });

// contributor diagnostics only (source tree)
await createTray(options, { runtime: "local-broker" });
```

## Runtime State Location

Runtime state is versioned under `$OPENTRAY_HOME/.opentray/<package-version>/runtime`, or under the user's home directory when `OPENTRAY_HOME` is unset. The runtime directory can contain coordination files such as pid, ready, and lock files. On Windows the runtime endpoint is a named pipe; on Unix-like systems it is a socket path.

## Cleanup

A tray contribution is tied to its owning session. Normal client exit (or `tray.destroy()` / closing the connection) removes that contribution. There is no `opentray daemon stop` to run from the CLI.

If a process was interrupted or immediate cleanup is desired, the reliable operator action is OS-level: terminate the owning process. The runtime binding dies with its owning process.

## Idle Exit (local-broker path only)

The `local-broker` diagnostic path historically auto-exited after 30 seconds with no connected clients. This does not apply to the default visible-binding path, where the host process owns the loop directly.

```bash
OPENTRAY_DAEMON_IDLE_TIMEOUT_MS=0
```

Set a positive millisecond value to customize the release window for the local-broker diagnostic path.
