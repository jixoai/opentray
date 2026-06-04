# Vision-Driven Self Review

## Review State

- Change: `add-tray-bounds-api`
- Iteration: 1
- Recurring issue counts:
  - `visual-smoke-capture`: 1
- Exit-condition judgment:
  - API law, protocol, SDK, local-broker routing, docs, and skills now align.
  - Automated smoke proves non-null tray bounds on macOS and reaches the WebView `shown` event.
  - A clean on-screen panel screenshot was not captured from the current automation workspace, so visual placement proof is weaker than the protocol/runtime proof.
- Next loop action:
  - Keep the change active until either a clean human-visible tray-panel capture is produced from a non-obscured desktop context, or the user accepts the current command/log-level smoke evidence as sufficient for this branch.

## Intent Alignment

| Intent point | Evidence | Verdict |
| ------------ | -------- | ------- |
| Backend authority should expose tray bounds as a tray-owned capability, not a WebView-owned helper. | `packages/cli/src/client.ts` exposes `TrayHandle.getBounds()`; protocol and kernel/backend tests passed earlier in this working context via `cargo test -p opentray-spec -p opentray-core -p opentray-backend-tray-icon -p opentray-backend-ksni -p opentray-ext-webview` and `pnpm --filter opentray test`. | Pass |
| Page JS should receive the same capability family under `navigator.opentray.tray.getBounds()`. | `packages/ext-webview/src/index.ts` exports `WebviewNavigatorTray`, `WebviewNavigatorNamespace`, browser-global typings, and `crates/opentray-ext-webview` navigator tests passed. | Pass |
| The real local-broker path must resolve tray-bounds responses, not just pure in-memory client tests. | `packages/cli/src/local-broker.ts` now routes `tray-bounds` by request id; `packages/cli/src/local-broker.test.ts` adds a socket-level response-routing test; `pnpm --filter opentray test` now passes with 37 tests. | Pass |
| The SDK/docs/skills surface should feel natural to an experienced engineer and match runtime truth. | `packages/ext-webview/src/index.ts` now exposes `invoke(...)` on `WebviewNavigatorWindow`, exports browser-global typings for injected page APIs, and `packages/ext-webview/README.md` plus `.agents/skills/develop-opentray-ext/references/webview-window-patterns.md` were updated to describe typed helpers, raw `invoke(...)`, tray authority, and scenario-driven usage. | Pass |
| Screen should remain extension-owned until a broader cross-platform law is proven. | `packages/ext-webview/README.md` and `webview-window-patterns.md` explicitly keep `screen` in `@opentray/ext-webview` and frame the next platform-law shift around Windows/Linux material/corner/screen-event modeling. | Pass |
| The tray-launched custom panel story should use tray bounds instead of guessed placement. | `packages/cli/src/smoke/daemon-tray.ts` and `packages/cli/examples/daemon-tray.ts` now call `tray.getBounds()`, log the result, and feed `fallbackRect` from that authority path. `review/artifacts/daemon-tray-smoke.log` records a successful smoke run with non-null tray bounds and a `shown` event. | Pass with weaker visual proof |

## Deviations From Intent

1. The current automation workspace did not yield a clean visual screenshot of the tray-launched panel itself. `review/artifacts/daemon-tray-smoke.png` captures the desktop state during smoke, but the WebView panel is not cleanly visible there even though `review/artifacts/daemon-tray-smoke.log` shows non-null tray bounds and `ext-event { type: "shown" }`.
2. This review does not archive `add-tray-bounds-api` yet because the worktree currently carries multiple concurrent OpenSpec changes and broader uncommitted work. The change is reviewable, but not isolated to a single archive-safe branch boundary yet.

## New Questions For User

1. Do you want `navigator.window.invoke(...)` to remain a documented public escape hatch long-term, or should future cleanup tighten the public page API to typed methods only?
2. Once the surrounding worktree settles, do you want `add-tray-bounds-api` archived as its own isolated change, or folded into a broader branch-level integration step with the other active WebView/tray work?

## Evidence

- HTML report: `review/self-review.html`
- Screenshot / command / log path:
  - `review/artifacts/daemon-tray-smoke.log`
  - `review/artifacts/daemon-tray-smoke.png`
  - `review/artifacts/window-list.json`
- Git commits reviewed:
  - None in the current worktree state; this review covers uncommitted work-in-progress on an active branch with multiple concurrent changes.
- Uncommitted paths, if any:
  - Current-context tray-bounds review paths:
    - `packages/cli/src/local-broker.ts`
    - `packages/cli/src/local-broker.test.ts`
    - `packages/cli/src/smoke/daemon-tray.ts`
    - `packages/cli/examples/daemon-tray.ts`
    - `packages/cli/examples/basic-space.ts`
    - `packages/cli/src/sdk.test.ts`
    - `packages/ext-webview/src/index.ts`
    - `packages/ext-webview/src/index.test.ts`
    - `packages/ext-webview/README.md`
    - `.agents/skills/develop-opentray-ext/references/webview-window-patterns.md`
    - `openspec/changes/add-tray-bounds-api/tasks.md`
    - `openspec/changes/add-tray-bounds-api/review/self-review.md`
    - `openspec/changes/add-tray-bounds-api/review/self-review.html`
  - The branch also contains broader unrelated active changes outside `add-tray-bounds-api`; this review does not reinterpret them as tray-bounds scope.
- Task checkboxes updated by this working context:
  - `openspec/changes/add-tray-bounds-api/tasks.md`

## HTML Review Report

Created as `review/self-review.html`. It presents the verification summary, tray-bounds smoke evidence, and the remaining visual-capture caveat in a scan-friendly form.

## Exit Handling

- Normal exit for this review layer: keep the change ready for continued branch work, then archive once the worktree boundary is isolated enough to do so cleanly.
- Abnormal exit: not needed in this iteration.
- Operator-authored handoff: not needed in this iteration.
- Intent realignment: not needed; the change id still matches the implemented capability.
