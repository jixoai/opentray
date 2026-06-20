# Vision-Driven Self Review

## Review State

- Change: tray-dynamic-state-and-webview-placement-kit
- Iteration: 3
- Recurring issue counts: none
- Exit-condition judgment: normal code-review exit after targeted SDK, WebView facade, Rust, OpenSpec, and placement demo smoke pass, followed by macOS native parity gate repair
- Next loop action: no review loop needed; archive decision can happen after user accepts the implementation batch

## Intent Alignment

| Intent point | Evidence | Verdict |
| ------------ | -------- | ------- |
| Dynamic tray state should be first-class SDK API | `TrayHandle.setMenu/setTooltip/setIcon/setTitle`; TS SDK tests for setters; Rust broker/kernel title tests | aligned |
| Events should follow single trusted principle | `OpenTrayConnection` / `OpenTrayEventSource`; event helpers only attached when transport has `onEvent`; SDK tests for filtering | aligned |
| Placement should be a WebViewExt utility, not a panel abstraction | `WebviewPlacementKit` in `@opentray/ext-webview`; no `createWebviewPanel` API | aligned |
| Placement should be continuous by default | `watch()` / `unwatch()` plus `apply()` alias; `applyOnce()` / `once()` remain explicit one-shot APIs; tests cover replacement and unchanged-result suppression | aligned |
| Edge placement should be modeled as anchor + window + viewport | `edge`, `edge-x`, `edge-y`, and fixed-edge variants resolve from current window bounds against the visible viewport; code carries a `positionTry` TODO at the algorithm point | aligned |
| Page window visibility should be reversible | `navigator.opentrayWindow.show()` / `hide()` are injected and wired on macOS and Windows; TS global typing and Rust bootstrap tests cover the bridge surface | aligned |
| Windows resize residue should reuse the white-block cleanup path | explicit Windows `resizeTo` now calls the host-surface refresh helper after synchronous WebView bounds application | aligned |
| macOS and Windows page window APIs should stay shape-aligned | shared bootstrap exposes the same page verbs; macOS bridge parses and authorizes `execCommand` payloads even when Windows-only repair commands no-op on macOS; `cargo test -p opentray-ext-webview` now covers the macOS command and AppKit logical-point placement path | aligned |
| Portable helpers should fallback with provenance | placement result includes `kind`, `source`, `anchorRect`; fallback test from unavailable tray to screen center | aligned |
| Skills should avoid hidden HTML/CSS mutation | `skills/opentray/references/scenarios.md`; WebView skill guidance says not to auto-inject drag strips/titlebars/CSS | aligned |
| Consumer examples should prefer tray-scoped helpers | `daemon-tray.ts` and `tray-panel.ts` use `tray.onMenuClick`; raw event streams remain only in debug/smoke support code | aligned |
| Skills need a reviewable demo | `example:placement` composes the scenario cards into a small tray-launched WebView panel | aligned |

## Deviations From Intent

1. Host-side `moveTo/resizeTo` commands return `Promise<void>` in the TypeScript facade even though native runtimes emit JSON results. This keeps the existing command-style host facade simple; page APIs still expose typed result payloads.
2. `cursor` placement depends on an injected cursor authority or caller-provided point. OpenTray still has no broker-owned cursor API.
3. Windows live interactive resize can still trail by one WebView2 compositor frame even after synchronous host bounds and host-surface refresh. This is recorded in code and contributor skills as a lower-level composition limitation.

## New Questions For User

1. Should a later release expose a broker/native cursor authority, or should cursor placement remain caller-injected until a second use case proves it?
2. Should `WebviewWindowHandle.moveTo/resizeTo` expose native result payloads in a future breaking API cleanup?

## Evidence

- HTML report: `review/self-review.html`
- Commands run:
  - `pnpm --filter opentray test`
  - `pnpm --filter @opentray/ext-webview test` (27 tests)
  - `pnpm --filter @opentray/ext-webview typecheck`
  - `pnpm --filter opentray typecheck`
  - `cargo test -p opentray-ext-webview --lib`
  - `cargo test -p opentray-ext-webview` (49 tests after macOS fixture repair)
  - `bun run openspec:vision -- validate tray-dynamic-state-and-webview-placement-kit`
  - `bun run openspec:vision -- check tray-dynamic-state-and-webview-placement-kit`
  - `cargo build -p opentray-bin -p opentray-ext-webview`
  - `OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1 pnpm --filter opentray example:placement`
  - `OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1 pnpm --filter opentray example:mediaQuery`
  - `git diff --check`
- Release note: `.changeset/tray-dynamic-state-webview-placement.md` records minor bumps for `opentray`, `@opentray/spec`, and `@opentray/ext-webview`.
- Validation note: this iteration used targeted verification because the user asked for a reviewable demo. Run full repo `pnpm run verify` before release packaging.
- macOS handoff note: native unit coverage now passes for the shared bridge shape and AppKit logical-point placement. Visual/runtime acceptance should still smoke `example:placement`, `example:tray-panel`, and `example:webview-control` before release because unit tests do not prove the visible WebKit/AppKit window path.
- Git commits reviewed: none in this working context
- Uncommitted paths: expected implementation, OpenSpec, docs, and skill files for this change
- Task checkboxes updated by this working context: yes; only tasks completed and verified in this context were marked complete

## Exit Handling

Targeted verification and the placement demo smoke passed. Do not archive automatically before the user reviews this implementation batch.
