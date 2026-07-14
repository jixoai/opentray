# Vision-Driven Self Review

## Review State

- Change: `fix-windows-frameless-soft-resize`
- Iteration: 1
- Recurring issue counts: none
- Exit-condition judgment: met for the approved Windows scope. The user visibly accepted true frameless rendering and explicit soft resize. Source automatic exit now closes the identified caller and broker.
- Next loop action: archive this change, publish the native release, then verify the consuming `pnpm-pub` application against the published package line.

## Intent Alignment

| Intent point | Evidence | Verdict |
| ------------ | -------- | ------- |
| Frameless removes legacy Windows title and border residue. | Windows style drops `WS_THICKFRAME`, disables DWM non-client rendering, and keeps full-client `WM_NCCALCSIZE`; user visually accepted the result. | Met |
| Frameless remains fixed-size unless `resizable: true` is explicit. | Common effective-style state defaults from chrome and retains explicit overrides; Windows tests cover the derivation. | Met |
| Explicit frameless resize is host-owned rather than page IPC on every pointer move. | The injected capture-phase edge detector delegates a single start request; HWND capture owns cursor, bounds, constraints, cancellation, and resize events. | Met |
| Native scrollbar does not require a workaround for right-edge resize. | User acceptance on the WebView-control page and automated frameless smoke both completed; documentation now states normal Chromium scrollbar coexistence. | Met |
| Source WebView automatic exit releases the launcher and broker. | Windows `ClientFrame::Exit` exits the owned GUI broker after core cleanup. Auto-exit smokes for both default frameless and `--resizable` callers succeeded, and caller IDs `50112` and `31008` were absent after shutdown. | Met |
| macOS maps the common resize intent without Windows soft-resize behavior. | The style mask includes `NSWindowStyleMask::Resizable` only when effective `resizable` is true, with focused source tests. | Implemented, not host-verified |

## Deviations From Intent

1. No macOS binary or visible runtime test was run because this Windows host has no Apple SDK or compiler. This does not alter the approved Windows exit condition.

## New Questions For User

1. None. The user approved the Windows visual result and requested release.

## Evidence

- HTML report: `review/self-review.html`
- Windows visible acceptance: user acceptance of `pnpm --filter opentray example:webview-control -- --frameless --resizable`.
- Windows automatic exit commands:
  - `OPENTRAY_EXAMPLE_EXIT_AFTER_MS=3000 OPENTRAY_EXAMPLE_WEBVIEW_BRIDGE_SMOKE=1 pnpm --filter opentray example:webview-control -- --frameless`
  - `OPENTRAY_EXAMPLE_EXIT_AFTER_MS=3000 OPENTRAY_EXAMPLE_WEBVIEW_BRIDGE_SMOKE=1 pnpm --filter opentray example:webview-control -- --frameless --resizable`
- Both bridge smokes reported `opentray-bridge-ok:windows` and the caller-specific launcher/broker checks passed.
- Release gates: `pnpm run build`, `pnpm run verify`, `git diff --check`, and `bun run openspec:vision -- commit-check fix-windows-frameless-soft-resize --phase self-review` passed.
- Git commits reviewed: `65e56bf docs(spec): define frameless soft resize`, `ac5e781 docs(spec): refine frameless soft resize intent`, and `87f8279 fix(webview): add frameless soft resize`.
- Uncommitted paths: this review, its state checkboxes, and the final archive evidence only.
- Task checkboxes updated by this working context: 3.10, 4.3 through 4.5, and 5.1 through 5.3. Task 3.3 remains unchecked because macOS was not executable on this host.

## HTML Review Report

The separate `review/self-review.html` is the structured evidence view for the Windows interaction and release gates.

## Exit Handling

- No unresolved or recurring issue remains in the approved Windows scope.
- No review-state or abnormal handoff is required.
- Archive after the implementation and self-review commits, then begin release operations.
