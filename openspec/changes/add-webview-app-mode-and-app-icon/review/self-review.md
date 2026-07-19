# Self Review: WebView App Mode And App Icon

Date: 2026-07-19

## Intent Coverage

The implementation matches the approved product contract:

- `style.appMode` is the common WebView application-versus-tray-tool intent. The public Windows `showInSwitchers` field was removed without an alias.
- Runtime-level `appIcon` is resolved once at App initialization. Explicit runtime artwork wins, otherwise the Core App identity path can snapshot the first native-capable tray icon. Later tray/window metadata does not replace the App identity.
- Core owns App identity state and mutation frames (`getName`, `setName`, `getIcon`, `setIcon`). WebView window metadata remains extension-owned and badge remains status-only.
- Darwin `.app` carrier source and staging now belong to the matching `@opentray/darwin-*` runtime package. `opentray-core` remains bundle-free.
- `skill-creator-v2` now uses an ordinary framed app-mode window with `keepOnTop: false`; its retained `primaryEvent` flow still uses `show`, `toVisible`, `close`, `isVisible`, and `visibleChange`.

## Evidence

Automated evidence completed in this review context:

| Gate | Result |
| --- | --- |
| `cargo test -p opentray-core --lib` | 27/27 passed |
| `cargo test -p opentray-ext-webview` | 71/71 passed |
| `cargo test -p opentray-runtime-node`, `cargo test -p opentray-bin`, `cargo test -p opentray-backend-tray-icon` | passed |
| `pnpm --filter opentray test -- src/sdk.test.ts src/index.test.ts` | 90/90 passed |
| `pnpm --filter @opentray/ext-webview test` | 40/40 passed |
| `bun test scripts/binaries` | 52/52 passed |
| `pnpm -C ../skill-creator-v2 test` | 77/77 passed |
| `tsc --noEmit` for `opentray`, `@opentray/spec`, and `@opentray/ext-webview` | all passed |
| `cargo fmt --all -- --check` | passed |
| `bun run openspec:vision -- validate add-webview-app-mode-and-app-icon` | passed |
| `git diff --check` | passed |

Darwin carrier packaging, plist coverage, badge helper separation, and temporary arm64 staging were independently verified. No generated native binaries are included in the source change.

## Residual Risk

The following items are intentionally not marked complete in `tasks.md`:

1. Real Windows taskbar/Alt+Tab close-and-reveal smoke was not available on this macOS host.
2. Real macOS Dock/Application Switcher smoke was not completed. The native close delegate and activation-policy projection are covered by code and unit-level paths, but Dock behavior needs a human-visible run.
3. The macOS extension runtime currently owns one native WebView slot per extension runtime. Its local `app_mode_windows` set protects that slot, but a process-wide aggregation keyed by `(appId, sessionId, windowId)` across multiple extension runtimes is not yet implemented. The multi-window Darwin requirement therefore remains open.
4. Windows-specific native unit coverage and cross-platform packed-consumer execution require a Windows runner.

These are acceptance and architecture follow-ups, not hidden compatibility shims. The public contract deliberately remains breaking and does not reintroduce `showInSwitchers`.

## Decision

The implementation slice is internally consistent and passes all available automated gates. Keep this OpenSpec change active until the platform GUI and multi-runtime Darwin aggregation evidence is available; do not archive it as fully complete yet.

## Review Reopened: Darwin Carrier Launch Identity

The 2026-07-19 consumer acceptance invalidated the earlier carrier conclusion. `skill-creator-v2`
did enter Dock, but macOS displayed `opentray` and the generic executable icon. Repository evidence
shows why: the runtime package staged an independent idle Swift `.app`, while the SDK continued to
spawn raw `bin/opentray`. Tasks 6.8-6.10 and 7.6 are reopened/new apply work. Visual acceptance is
delegated to the user after the linked local preparation path is ready.
