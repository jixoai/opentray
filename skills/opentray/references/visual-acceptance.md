<!--
Orthogonal intents (maintained 2026-07-21; original user request: public acceptance must
run inside projects such as skill-creator-v2, never inside the OpenTray source workspace):
1. Verify the installed dependency graph through the consumer's real entrypoint.
2. Separate automated checks from human-visible native acceptance.
3. Preserve platform-specific claims and teardown evidence.
-->

# Consumer Acceptance

Use this reference after integrating published OpenTray packages into an
application. The consumer project is the test surface; do not clone or build the
OpenTray repository to validate a registry installation.

## Before Starting

1. Run the consumer's normal package-manager install.
2. Inspect its `package.json` and identify the real development and production
   entrypoints.
3. Confirm paired official packages resolve to one compatible protocol line.
4. Record the consumer's own supervisor/daemon log location.

Useful dependency evidence:

```bash
pnpm why opentray @opentray/ext-webview
pnpm exec tsc --noEmit
```

Do not delete `node_modules`, clear caches, stage source artifacts, or set an
extension path before collecting the installed-graph evidence.

## Tray Acceptance

Run the consumer's actual entrypoint and verify:

- one visible tray contribution appears
- the primary tray action emits the expected ordinary `menuClick`
- menu text follows authoritative application/window state
- repeated activation reuses the same retained window or command owner
- application teardown removes the tray exactly once

## App-Mode Acceptance

For `style.appMode: true`:

- Windows: the visible window participates in taskbar and Alt+Tab
- macOS: the visible window participates in Dock and Command-Tab
- closing or minimizing a running window, then activating the live app entry,
  restores and focuses the most recently active retained app-mode window
- `keepOnTop` remains unnecessary unless the product explicitly wants z-order

For a pinned macOS Dock entry, fully exit the consumer and activate the entry
again. The stable carrier must start the complete application supervisor and
open usable content, not only a raw child daemon.

## Development And Production

When both modes share one app identity, verify each direction independently:

```text
production owner -> start development -> one development owner
development owner -> start production -> one production owner
```

The consumer must wait for its old PID and IPC endpoint to release before the
new supervisor claims OpenTray. Duplicate Dock identities or trays indicate an
application ownership defect, not an acceptance pass.

## Evidence Boundary

Automated typechecks and unit tests prove API usage, not native visibility.
Human-visible verification owns tray appearance, window focus, Dock/taskbar
membership, icon quality, and close/reopen behavior. Linux core support must not
be reported as Linux WebView support; `@opentray/ext-webview` currently provides
native runtimes only for macOS and Windows.
