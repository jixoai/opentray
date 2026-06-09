# Daemon Operations

Use this reference when the user asks about daemon lifecycle, health, or cleanup.

## Main Commands

Health:

```bash
opentray daemon health
```

Operator/debug lifecycle:

```bash
opentray daemon start
opentray daemon stop
opentray daemon restart
```

Runtime state is versioned under `$OPENTRAY_HOME/.opentray/<package-version>/runtime`, or under the user's home directory when `OPENTRAY_HOME` is unset. The runtime directory can contain coordination files such as pid, ready, and lock files. On Windows the broker endpoint is a named pipe; on Unix-like systems it is a socket path.

The public CLI does not include `opentray smoke ...`. For real tray/window smoke, use `visual-acceptance.md`; those recipes own their space/tray contributions through the session lease. Normal client exit should remove those contributions. If the process is interrupted or immediate cleanup is desired, run:

```bash
opentray daemon stop
```

## Auto-Start and Idle Exit

- Consumer flows should not require users to start the daemon manually.
- SDK and example flows auto-start or reuse the same-version daemon.
- The daemon exits automatically after 30 seconds with no connected clients by default.

Override idle behavior with:

```bash
OPENTRAY_DAEMON_IDLE_TIMEOUT_MS=0
```

Set a positive millisecond value to customize the release window.
