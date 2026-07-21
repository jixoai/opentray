<!--
Orthogonal intents (maintained 2026-07-22; original user request: troubleshoot published
OpenTray from the consumer project without leaking source-repository controls, including
split production/development endpoint ownership):
1. Diagnose installed dependency and artifact coherence.
2. Diagnose tray, WebView, and app relaunch chains from persistent evidence.
3. Keep manual repair steps outside the normal consumer contract.
-->

# Troubleshooting

Use this reference when a consumer can install OpenTray but native behavior is
missing, stale, or unsupported.

## Establish Installed Truth

Record the requested and resolved graph before changing state:

```bash
pnpm why opentray @opentray/ext-webview
pnpm exec tsc --noEmit
```

Inspect `package.json`, the lockfile, and real module resolution from the
consumer workspace. A manifest declares intent; it does not prove which facade,
platform package, broker, or native extension the running process loaded.

## Tray Does Not Appear

- Confirm the consumer's real process entry remains alive after `createTray()`.
- Confirm `createTray()` is reached and its promise succeeds before blaming the
  native backend.
- Read the caller-scoped `broker.log` named by any startup error.
- Verify the installed current-platform runtime package exists in the resolved
  `opentray` dependency closure.
- Do not look for `opentray daemon health`; there is no public daemon CLI.

## WebView Does Not Appear

- Confirm both `opentray` and `@opentray/ext-webview` resolve from a compatible
  protocol line.
- Keep one `WebviewWindowHandle`; call the first `show()` before expecting warm
  reopen behavior.
- Use `isVisible()`, `visibleChange`, and `toVisible()` instead of a private
  shown/hidden boolean.
- Linux has no official `@opentray/ext-webview` native runtime.

## Pinned Dock Entry Does Not Relaunch

1. Read `opentray-launch.json` and verify that `command`, `args`, and `cwd`
   describe the complete consumer supervisor.
2. Execute that exact vector from the recorded cwd.
3. Read the adjacent `opentray-launch.log` for parse/spawn/child errors.
4. Read the caller-scoped `broker.log` and the consumer's own daemon log.

Persist a public lifecycle command such as `dist/cli.js start`, not a raw daemon
child. A healthy existing owner should receive open/focus; an absent owner should
start the complete graph.

## Stop Reports `ENOENT`, But Development Start Says The Socket Is Occupied

This is usually split endpoint ownership, not a stale socket. Production and
development often derive different homes, socket paths, or registry files. The
stop command queried the production profile while the running development
supervisor owns the development profile.

1. Record the exact `command`, `args`, and `cwd` from `opentray-launch.json`.
2. Read the consumer's lifecycle/daemon log and identify the active profile,
   endpoint, daemon PID, and supervisor PID.
3. Invoke the consumer's public stop operation for that active profile; it must
   be safe when no owner exists and must wait for both PID exit and endpoint
   release.
4. Confirm the old Vite supervisor exits as a consequence of daemon shutdown.
5. Start the replacement supervisor and verify one daemon, one endpoint, one
   Vite server, and one OpenTray session remain.

Do not delete the endpoint file, kill every process matching a package name, or
change OpenTray's endpoint format from the consumer side. If the consumer cannot
discover its active development owner, fix that lifecycle command before
debugging native tray behavior.

## Normal Install Contract

Deleting `node_modules`, clearing caches, manually restarting brokers, setting
source-only artifact paths, or rebuilding OpenTray are diagnostic experiments,
not consumer setup. If ordinary installation yields an incoherent graph, report
the resolved versions, real paths, broker log, and loaded native artifact as an
OpenTray defect.
