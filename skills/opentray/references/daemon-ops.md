# Daemon Operations

Use this reference when the user asks about daemon lifecycle, health, smoke commands, or cleanup.

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

Package-owned smoke:

```bash
opentray smoke daemon-tray
```

## Auto-Start and Idle Exit

- Consumer flows should not require users to start the daemon manually.
- The smoke/demo path auto-starts or reuses the same-version daemon.
- The daemon exits automatically after 30 seconds with no connected clients by default.

Override idle behavior with:

```bash
OPENTRAY_DAEMON_IDLE_TIMEOUT_MS=0
```

Set a positive millisecond value to customize the release window.
