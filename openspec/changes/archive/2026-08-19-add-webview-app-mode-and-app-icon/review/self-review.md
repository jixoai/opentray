# Self Review: WebView App Mode And App Icon

Date: 2026-07-20

## Intent Coverage

The implementation matches the approved product contract:

- `style.appMode` is the common WebView application-versus-tray-tool intent. The public Windows `showInSwitchers` field was removed without an alias.
- Runtime-level `appIcon` is a strict platform-standard asset array: Darwin ICNS, Windows ICO, and Linux sized PNG/SVG assets. It is validated before broker startup, never inherits tray artwork, and relative files are normalized to absolute paths before dispatch. Later tray/window metadata does not replace the App identity.
- Core owns the complete App icon catalog and active semantic variant. The public App handle uses `getName`, `setName`, `getAppIcon`, `getAppIconVariant`, and `setAppIcon`; WebView window metadata remains extension-owned and badge remains status-only.
- App icon assets may omit `variant` for `default`, alias one asset through names such as `default/light`, or model domain states such as `empty/files`. Selection projects only matching assets and a typed rejection preserves the previous Core/native projection.
- Darwin `.app` carrier source and staging now belong to the matching `@opentray/darwin-*` runtime package. `opentray-core` remains bundle-free.
- `skill-creator-v2` now uses an ordinary framed app-mode window with `keepOnTop: false`; its retained `primaryEvent` flow still uses `show`, `toVisible`, `close`, `isVisible`, and `visibleChange`.

## Evidence

Automated evidence completed in this review context:

| Gate | Result |
| --- | --- |
| `cargo test -p opentray-core --lib` | 31/31 passed, including variant selection, idempotence, and rollback |
| `cargo test -p opentray-spec` | 25/25 passed, including alias normalization and per-variant uniqueness |
| `cargo test -p opentray-backend-tray-icon --lib` | 29/29 passed |
| `cargo test -p opentray-ext-webview` | 71/71 passed |
| `cargo test -p opentray-runtime-node`, `cargo test -p opentray-bin`, `cargo test -p opentray-backend-tray-icon` | passed |
| `pnpm --filter opentray test` | 102/102 passed |
| `pnpm --filter @opentray/vite-plugin test` | 4/4 passed, including AppKit ICNS representation inspection on macOS |
| `pnpm --filter @opentray/ext-webview test` | 40/40 passed |
| `bun test scripts/binaries` | 52/52 passed |
| `pnpm -C ../skill-creator-v2 test` | 70/70 passed |
| `tsc --noEmit` for `opentray`, `@opentray/spec`, `@opentray/vite-plugin`, and `@opentray/ext-webview` | all passed |
| `pnpm run prepare:opentray` from `skill-creator-v2` | rebuilt linked facades, broker, carrier, and WebView artifacts |
| `skill-creator-v2` root typecheck, Svelte check, and WebUI production build | passed; Svelte reported 0 errors and 0 warnings |
| Generated asset/cache inspection | schema 6 matched the source image, generator source, bundled implementation, recipe, and encoder versions; a second WebUI build preserved every cache/output mtime |
| Skill Creator native variant staging | `default/light` and `dark` resolve to hand-generated ICNS/ICO; staged output contains exactly four files with source-identical SHA-256 and no `.DS_Store` or Icon Composer source |
| `cargo fmt --all -- --check` | passed |
| `bun run openspec:vision -- validate add-webview-app-mode-and-app-icon` | passed |
| `pnpm run build`, `pnpm run verify` | passed across the complete workspace; the native icon integration test has an explicit 20-second budget and completed in 6.31 seconds under parallel load |
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

## Review Reopened: Strict AppIcon Boundary

The 2026-07-20 contract review invalidated the earlier generic `Icon` input and tray-inheritance
rule. The implementation now carries a dedicated `AppIcon` array through TypeScript, protocol,
Core, native projection, and App mutation APIs. Explicit arrays must contain the current platform,
Darwin and Windows accept one native asset each, Linux accepts unique sized PNG assets and/or one
SVG, and every source is a native file or encoded payload. The optional Vite toolchain emits ICNS,
ICO, Linux theme assets, and a relocatable manifest; consumers remain free to generate compliant
assets independently.

This refresh proves the build and runtime-input chain only. Dock/Application Switcher artwork and
window lifecycle remain human-visible acceptance owned by the user; no visual pass is claimed here.

## Review Reopened: Semantic App Icon Variants

The 2026-07-20 variant decision extends the strict native asset catalog without turning theme into
Core policy. Omission normalizes to `default`; one asset may alias multiple names; names may express
theme or application state. Core retains the complete catalog and selected name, while native
adapters receive only the selected subset. Missing selection is rejected with
`app-icon-variant-not-found` before state or native projection changes. Skill Creator declares the
hand-generated light asset as `default/light`, the dark asset as `dark`, and intentionally exposes
no WebView theme IPC. Visual judgment of those native files remains assigned to the user.

## Review Reopened: Stable App Bundle Provisioning

The 2026-07-20 runtime-carrier review supersedes the version/caller-scoped carrier zip. The approved
contract uses a stable npm-package-derived `.app` path, regenerates managed files for every new
broker process, and supports an explicitly read-only prebuilt bundle generated by any official
build-plugin adapter. The published Darwin package must not carry a second compressed broker copy.
Tasks 10.1-10.10 reopen the packaging/runtime/plugin slice; prior verification does not cover it.
