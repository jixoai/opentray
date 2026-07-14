<!--
Orthogonal intents (2026-07-14, original user input):
1. Review Windows tray WebView shell behavior against visible failures.
2. Prove source examples own their broker and Vite runtime identities.
3. Keep native acceptance evidence and residual risks explicit.
-->

# Vision-Driven Self Review

## Review State

- Change: `fix-windows-tray-webview-shell`
- Iteration: 6 (Round 7 Windows overlay colors and AppWindow metrics)
- Recurring issue counts: source broker identity 0; source Vite lifecycle 2 resolved; native drag state reset 1 accepted by user; Windows overlay color/measurement 1 implemented with independent-DLL visual evidence; Windows full-suite path assertions 1, pre-existing and outside this change
- Exit-condition judgment: Automated contracts and a real Windows render pass. Final overlay interaction acceptance remains with the user.
- Next loop action: User verifies the `example:webview-control` caption controls against their Chrome PWA expectation.

## Intent Alignment

| Intent point | Evidence | Verdict |
| ------------ | -------- | ------- |
| Windows shell contract remains intact | Visible retry bridge result was `opentray-bridge-ok:windows:normal:true:gap=2x1:overlay=770x40`. | Met. |
| Source example starts under its own broker | Broker command used source `target/debug/opentray.exe` and caller-scoped endpoint. | Met. |
| Neutral endpoint cannot capture the example | Endpoint used `example-46108-opentray-webview-control`, not neutral `opentray`. | Met. |
| Vite owns the selected Local URL | With `127.0.0.1:5173` reserved, the unmodified command loaded `http://127.0.0.1:5174/webview-control`. | Met. |
| WebView window is actually created | The caller-scoped broker process `27048` had the visible `OpenTray Examples` top-level window. | Met. |
| Vite listener does not survive its owner | Direct `startDevServer()` close released `5173`; no `5173` or `5174` listener remained. | Met. |
| Public SDK compatibility is not changed | The public SDK is unchanged; only source-example support and its fixed loopback host changed. | Met. |
| Pure native drag preserves shell state | An interaction without `WM_SIZE` cannot authorize the white-block `ShowWindow` reset; observed resize retains the throttled repair path. | Met; user accepted the visible drag repair. |
| Configured Windows caption colors reach the native buttons | The isolated extension DLL was loaded by the broker; a captured window contains the requested `#0F6CBD` pixels across the native caption-button cluster. | Met. |
| Overlay safe-area width matches native controls | Bridge geometry reported `overlay=740x32`; the blue native button background begins at screenshot x=748 while the client origin is x=8, yielding the same client x=740 control boundary. | Met. |

## Deviations From Intent

1. None. The repair stays within source example support, changes no public SDK surface, and fixes the source app's loopback address to IPv4.

## New Questions For User

1. None for this repair. Fixing the broad CLI test's Windows/POSIX expected-path mismatch is separate portability work.

## Evidence

- HTML report: `review/self-review.html`
- Focused units: `pnpm --filter opentray exec vitest run examples/_support/dev-server.test.ts examples/_support/webview-example-support.test.ts` passed 8 tests.
- Typecheck: `pnpm --filter opentray typecheck` passed.
- SvelteKit check: `pnpm --dir packages/cli/examples/app run check` passed with 0 errors and 0 warnings.
- Visible retry: after reserving `127.0.0.1:5173`, the unmodified `pnpm --filter opentray example:webview-control` selected `http://127.0.0.1:5174/webview-control`; the caller-scoped broker created the visible `OpenTray Examples` window. No debug or smoke environment variables were set.
- Listener release: a direct `startDevServer('/webview-control')` run selected `5173`; after `close()`, neither `5173` nor `5174` had a listener.
- OpenSpec: both `bun run openspec:vision -- validate fix-windows-tray-webview-shell` and `bun run openspec:vision -- check fix-windows-tray-webview-shell` passed.
- Native interaction guard: `cargo test -p opentray-ext-webview` passed 64 tests, including pure-move and observed-resize white-block cases, color parsing, WinRT color boxing, and titlebar-inset geometry.
- Facade and example gates: `pnpm --filter @opentray/ext-webview test` passed 37 tests; both `pnpm --filter @opentray/ext-webview typecheck` and `pnpm --filter opentray typecheck` passed; focused example support tests passed 3 tests.
- Isolated DLL evidence: `cargo build -p opentray-ext-webview` under `CARGO_TARGET_DIR=%TEMP%/opentray-overlay-controls` produced `opentray_ext_webview.dll` with SHA-256 `7BA86967...537ACED`, distinct from source `target/debug` SHA-256 `E5F11877...4F0C6`.
- Visible overlay evidence: caller-scoped broker PID `7172` loaded the isolated DLL path. Bridge smoke returned `opentray-bridge-ok:windows:normal:true:gap=2x1:overlay=740x32`. The captured native window at `%TEMP%/opentray-overlay-controls/window-controls-overlay.png` contains exact `#0F6CBD` pixels from x=748 through x=885; its client origin is x=8, so the native button boundary is client x=740, equal to the bridge safe-area right edge.
- Full package test note: `pnpm --filter opentray test -- examples/_support/webview-example-support.test.ts` ran the whole package because the script did not forward the filter. Two existing `broker-command.test.ts` assertions expected POSIX paths but received Windows paths; the direct focused Vitest command passed.
- Git commit reviewed: `b0d36ae chore: version packages`.
- Uncommitted paths: existing Windows shell repair, OpenSpec artifacts, vendored `tray-icon`, and source-example support changes remain uncommitted.
- Task checkboxes updated by this working context: 1.6, 1.7, 2.10, 2.11, 3.11-3.16, 4.10-4.13, 5.7, and 5.8. Task 5.9 waits for user overlay acceptance.

## HTML Review Report

`review/self-review.html` presents the native shell, broker identity, and Vite listener evidence in one compact report.

## Exit Handling

- No intent/spec deviation remains for the native interaction or overlay repair.
- Native rendering evidence is captured from the caller-scoped broker that loaded the isolated extension DLL; it is not inferred from the locked source DLL.
- Archive is intentionally deferred until the user accepts the overlay color and control-boundary behavior.
