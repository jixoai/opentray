# Vision-Driven Self Review

## Review State

- Change: `align-windows-webview-host-with-native-material-probe`
- Iteration: 1
- Recurring issue counts: classic outer-frame residue 1 and resolved by probe-shell parity; AppWindow overlay broker exit 1 and resolved by post-WebView initialization; no issue survived this review round.
- Exit-condition judgment: the user accepted the visible comparator result, and the reopened overlay crash now passes the full source-built bridge smoke. Normal archive is appropriate after final workflow validation.
- Next loop action: none; commit this review, run the normal exit check, then archive.

## Intent Alignment

| Intent point | Evidence | Verdict |
| ------------ | -------- | ------- |
| `win32-bug` matches the standalone native probe except for WebView-rendered controls | 900x620 framed Acrylic host, transparent page substrate, centered 3x3+1 controls, and source-host smoke | aligned |
| Material residue belongs to the parent HWND/DWM surface | User one-ninth-WebView evidence in `plans/plan.md`; production material hosts retain complete Black parent paint | aligned |
| Probe-only frameless behavior does not introduce OpenTray's classic outer frame | Probe shell keeps native resize frame/system menu, default non-client calculation, and native resize | aligned |
| Production cold start establishes Win32/DWM parent state before WebView2 | `apply_initial_window_host_style` completes native material, paint ownership, and initial geometry before child construction | aligned |
| AppWindow overlay respects its COM dependency | `complete_initial_webview_attachment` initializes AppWindow only after WebView2 attachment and before final child bounds/show | aligned |
| Broker loss does not create a diagnostic storm | Host event drain is single-flight, stops on the first transport failure, and reports once | aligned |
| Experience is preserved as project law | `AGENTS.md`, `i18n.zh.md`, package README, OpenSpec plan/spec/tasks, and native boundary comments | aligned |

## Deviations From Intent

1. No screenshot artifact is stored in the repository. Pixel-level acceptance is the user's direct Windows observation recorded in `plans/plan.md`; automated smoke proves topology, bridge behavior, transparency contracts, and process survival only.
2. An extra `--no-overlay` bridge-smoke run reached a controlled geometry assertion with a 31px native-titlebar height difference. The broker remained alive and completed the preceding actions. This combination is outside the overlay acceptance gate and exposes a smoke-harness assumption, not the repaired AppWindow failure.

## New Questions For User

1. None. The visible residue result was already accepted, and the subsequently reported `webview-control` crash has deterministic source-built runtime proof.

## Evidence

- HTML report: `review/self-review.html`
- User visual evidence: current conversation; summarized in `plans/plan.md`
- `pnpm --filter @opentray/ext-webview test`: 39 passed
- `pnpm --filter @opentray/ext-webview typecheck`: passed
- `cargo fmt --check`: passed
- `cargo test -p opentray-ext-webview --lib`: 75 passed
- `pnpm --filter opentray test`: 85 passed, 1 skipped
- `pnpm --filter opentray typecheck`: passed
- `pnpm --dir packages/cli/examples/app check`: 0 errors, 0 warnings
- `cargo build -p opentray-bin -p opentray-ext-webview`: passed
- Overlay bridge smoke: `opentray-bridge-ok:windows:normal:true:gap=2x1:overlay=1438x63`
- `win32-bug` smoke: transparent substrate and framed/frameless round trip verified
- `bun run openspec:vision -- validate align-windows-webview-host-with-native-material-probe`: passed
- `bun run openspec:vision -- commit-check align-windows-webview-host-with-native-material-probe --phase self-review`: passed at `9c5ce35`
- `git diff --check`: passed
- Git commits reviewed: `2879a5c`, `ec32a07`, `fd1afdd`, `b2736fc`, `db98de2`, and `9c5ce35`
- Uncommitted paths at review generation: `review/self-review.md`, `review/self-review.html`, and self-review task-state updates only
- Task checkboxes updated by this working context: `4.7`, `6.5`, `7.6`, `7.7`, and the completed self-review gates

## Exit Handling

- Normal exit selected.
- No intent realignment, second apply loop, or abnormal handoff is required.
- Run the workflow check, mark the final exit task, and archive in a dedicated OpenSpec commit.