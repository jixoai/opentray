# Daemon Best Practices

Use this reference when designing, reintroducing, or auditing a **daemon / broker process** for OpenTray (or any desktop status platform that needs a long-lived native owner).

> **Context.** OpenTray is currently tray-first and owns its native loop **in-process** (`opentray/node` `runVisibleRuntimeHost()`). The public `opentray` CLI no longer exposes `opentray daemon ...` subcommands. The lessons below come from the daemon model OpenTray *did* ship and harden in earlier lines. They are generic, portable, and worth reusing when a future version (or a new platform substrate) needs a dedicated broker process again.

Read `references/daemon-ops.md` for the current "no CLI daemon" truth. Read this file for the engineering patterns to reach for *when* a daemon is reintroduced.

## When A Daemon Is The Right Call

Reach for a separate broker process only when an honest constraint forces it — not as a default. Real triggers OpenTray hit:

- The native tray/window authority **must** live on a specific thread (AppKit main thread) or in a process whose event loop a library worker cannot share safely.
- Multiple independent client processes need to **co-own or aggregate** onto one native status surface without each spawning its own GUI loop.
- A native capability (extension dylib) needs a stable, addressable host that outlives any single short-lived CLI invocation.

If none of these are true, prefer in-process ownership — it has no IPC, no pid files, no orphan risk. OpenTray's current tray-first model chose exactly this.

## The Six Patterns That Earned Their Keep

These are not theoretical. Each one closed a real failure class in the old daemon.

### 1. Versioned + caller-scoped runtime directory

State must be partitioned so a version mismatch or a second caller cannot corrupt another session's files.

```
$OPENTRAY_HOME/.opentray/<package-version>/<caller-label>/runtime/
├── broker.pid      # who owns this runtime
├── broker.lock     # startup mutual exclusion
├── ready.json      # readiness handshake payload
└── <endpoint>      # socket / named pipe
```

Law: **every coordination artifact is scoped by package version AND caller label.** Two daemons from different package versions must never share a pid file. Two different host apps must never share an endpoint. When the partition key is wrong, the symptom is always "stale daemon" or "wrong tray shows up" — both are state-collision bugs, not logic bugs.

When `OPENTRAY_HOME` is unset, fall back to the user home dir, never a system temp dir.

### 2. File-lock guarded startup (no races)

Two client starts racing must not spawn two brokers. Use an exclusive create lock with a bounded timeout, and hold it across the full "check existing → spawn → ready" sequence:

```ts
const handle = await open(lockFile, O_CREAT | O_EXCL | O_WRONLY);
// ... read pid, check alive, spawn, wait ready, write pid ...
// finally: close + unlink lock
```

Law: **the lock protects the whole start critical section, not just pid-file write.** Releasing before readiness lets a second start see a half-spawned daemon. `O_EXCL` gives atomic test-and-create; on `EEXIST`, retry with a short backoff up to a deadline, then fail explicitly.

### 3. Pid file + liveness probe (orphan recovery)

Before deciding to spawn, check whether the recorded pid is *actually alive*:

```ts
try { process.kill(pid, 0); return true; }  // signal 0 = "are you there?"
catch { return false; }
```

Law: **a pid file is a hint, not authority.** Pids are recycled. Always pair the pid read with a liveness probe (`kill(pid, 0)`), and treat a stale pid file as "clean up and start fresh", never as "already running". Report the stale pid (`stalePid`) in the inspect result so an operator can diagnose a zombie.

### 4. Ready-file handshake (no sleep())

Never sleep a fixed delay to "wait for the broker to come up". Have the broker write a `ready.json` the moment it is bound and serving, then poll for that file with a deadline — and fail loudly if the broker pid dies before readiness:

```
while deadline not reached:
  if readyFile exists: return        # broker is serving
  if !isAlive(pid): throw            # broker died during startup
  sleep(short)
throw "timed out waiting for readiness"
```

The ready payload should carry self-describing truth — `pid`, `endpoint`, `packageVersion`, `protocolVersion`, `appId`, `appName`, `callerLabel` — so the client can *verify* the daemon it connected to is the one it expected, not a leftover.

When startup fails, point the operator at a way to see broker stderr (e.g. set `OPENTRAY_DAEMON_STDIO=inherit`) instead of leaving them with a blind timeout.

### 5. Idle auto-exit (no leaked daemons)

A per-caller daemon that nobody is using must clean itself up. The broker serves exactly one caller session; when that session ends, it starts an idle timer, and exits when it elapses with no reconnect:

```
idle_since = None
on client disconnect: idle_since = now
while waiting: if idle_since and elapsed >= idle_timeout: exit
on reconnect: idle_since = None
```

Law: **idle exit belongs to the broker, not the client.** The client may crash; only the broker can authoritatively know it has no live session. Default the timeout short (`30s`), let it be disabled (`OPENTRAY_DAEMON_IDLE_TIMEOUT_MS=0`) for operator/debug sessions, and never make auto-exit fight an explicit operator stop.

This is also why OpenTray pinned the broker to **one caller session per process** — a shared multi-caller broker has no clean idle signal, so isolation became the cheaper, more honest design.

### 6. Explicit, bounded graceful stop

Stop is a two-phase act: signal, then confirm.

```ts
await driver.stop(pid);          // SIGTERM
await waitUntilStopped(driver, pid);  // poll liveness up to N tries
await cleanupRuntimeFiles(paths);     // rm pid/ready/endpoint
```

Law: **SIGTERM is a request, not a guarantee.** Always follow with a bounded liveness poll, *then* clean up the runtime files. Cleanup-on-start (clearing stale pid/ready/endpoint) is the safety net for the case where a previous process was killed without cleanup. On Windows, a socket/pipe path needs explicit unlinking only where the transport doesn't GC it.

## Transport Truth

One endpoint identity, two physical shapes, decided by platform:

- **Unix-like:** a filesystem socket path under the versioned runtime dir.
- **Windows:** a named pipe (`\\.\pipe\...`).

Keep the *identity* (derived from caller label + package version) as the source of truth, and let platform code format the physical address from it. Never let client code hard-code a socket path or pipe name.

## Why The Current Model Could Drop All Of This

These patterns are the cost of a *separate* broker process. The tray-first model removed them by moving the native loop **into** the host process: the host main thread runs the visible runtime binding directly, so:

- no pid file (the host pid *is* the authority),
- no ready handshake (binding load is synchronous),
- no idle timer (the host owns its own lifetime),
- no IPC socket (calls are in-process),
- no orphan daemons (the binding dies with the host).

The daemon patterns above become worth reintroducing precisely when a constraint makes in-process ownership impossible again. Carry them forward as a tested playbook, not as default architecture.

## Anti-Patterns That Bite

- **Fixed-delay startup wait** (`await sleep(500); connect()`). Hides a missing ready handshake; breaks on slow machines; hangs on a dead broker.
- **Pid file without liveness probe.** Pid recycling produces "daemon already running" for a totally unrelated process.
- **Shared state directory across versions.** An older daemon and a newer runtime stomp each other's pid/ready files.
- **Lock released before readiness.** Opens a race where a second start spawns a duplicate broker.
- **Idle exit owned by the client.** A crashed client leaks a headless daemon forever.
- **Stop without liveness confirmation.** `SIGTERM` then immediately deleting state leaves a still-running orphan that looks stopped.
- **CLI subcommands as the only operator surface.** If the daemon model returns, expose lifecycle through a real CLI contract, document it, and version it — do not let it drift silently between releases.
