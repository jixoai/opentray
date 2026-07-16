## 1. Accepted Evidence

- [x] 1.1 Record that residue persists outside WebView child coverage and therefore belongs to the top-level HWND/DWM material surface.
- [x] 1.2 Record that framed/frameless mode is not the determining factor.
- [x] 1.3 Record final user visual acceptance of the complete native black material base.
- [x] 1.4 Preserve the full experimental sequence in `plans/plan-v4.md` through `plans/plan-v13.md`.

## 2. Production Law

- [x] 2.1 Paint complete material HWND clients with `BLACK_BRUSH` in `WM_ERASEBKGND` and `WM_PAINT`.
- [x] 2.2 Remove parent `WS_CLIPCHILDREN` for material windows while retaining it for plain hosts.
- [x] 2.3 Publish native paint ownership before style APIs can synchronously paint.
- [x] 2.4 Commit parent host surface before WebView2 background/controller bounds and WRY child bounds.
- [x] 2.5 Keep `WM_WINDOWPOSCHANGED` position-only and move ordered child geometry to `WM_SIZE`.
- [x] 2.6 Keep `clearWhiteBlock` aliases as parent-surface recommit compatibility commands with no shell or geometry side effects.

## 3. Legacy Cleanup

- [x] 3.1 Remove diagnostic command parsing and all `win32Diagnostic*` native handlers.
- [x] 3.2 Remove shell reset, raw host-width pulse, invalidation/update, and DWM-flush experiment helpers.
- [x] 3.3 Remove automatic cleanup flags, schedules, timers, private HWND messages, and resize-terminal repair tracking.
- [x] 3.4 Remove runtime composition logging, Runtime-version capture, diagnostic sequence state, and diagnostic-only tests.
- [x] 3.5 Remove the material-host-paint disable switch; production policy derives directly from background family.
- [x] 3.6 Simplify style transaction refresh suppression to one all-surface guard.
- [x] 3.7 Remove obsolete macOS no-op acceptance for Windows diagnostic commands.

## 4. Regression Surface And Guidance

- [x] 4.1 Reduce `example:win32-bug` to production material/frameless/resize/retained-visibility coverage.
- [x] 4.2 Keep host-surface recommit, surface snapshot, and frameless self-drawn controls.
- [x] 4.3 Remove automatic cleanup, material host paint disable, atomic composition, and width-pulse controls.
- [x] 4.4 Update `AGENTS.md`, `i18n.zh.md`, package README, example guide, and WebView Window Patterns.
- [x] 4.5 Add final root-cause and ordering comments at the Windows host implementation boundaries.

## 5. Verification

- [x] 5.1 Run `cargo check -p opentray-ext-webview`.
- [x] 5.2 Run `cargo test -p opentray-ext-webview`.
- [x] 5.3 Run the Svelte example app check.
- [x] 5.4 Run CLI tests and typecheck.
- [x] 5.5 Build source broker and WebView extension artifacts.
- [x] 5.6 Smoke `example:win32-bug` against matching source broker/DLL artifacts.
- [x] 5.7 Validate OpenSpec, generate self-review, run final workflow check, and archive the change.
- [x] 5.8 Run `git diff --check` and inspect the final scoped diff.
