<!--
Orthogonal intents (2026-07-14, user input):
1. Convert the Windows review into executable BDD gates.
2. Repair switcher, overlay, tray icon identity, and placement.
3. Verify focused examples and pnpm-pub without false cross-platform claims.
-->

## 1. Alignment / Investigation

- [x] 1.1 Read `windows.HANDOFF.md`, current diffs, prior Windows overlay commits, current OpenSpec laws, and pnpm-pub's real mount/placement flow.
- [x] 1.2 Record the inferred breaking default: Windows tray WebViews stay out of taskbar/Alt+Tab unless `showInSwitchers` explicitly opts in.
- [x] 1.3 Prove the placement regression source: GUID registration and `(hwnd, uID)` bounds lookup address different shell identities.
- [x] 1.4 Run `bun run openspec:vision -- commit-check fix-windows-tray-webview-shell --phase apply`; change and implementation paths are reported.
- [x] 1.5 Prove the source example and a same-version neutral-label runtime can share the Windows pipe name, then record caller-scoped isolation as the repair.
- [x] 1.6 Prove a formatted Vite CLI URL can be unavailable to the source helper even while the listener is healthy; record Vite's server API as the readiness authority.
- [x] 1.7 Prove Windows `WM_EXITSIZEMOVE` covers pure dragging and was invoking the legacy white-block minimize/restore reset for translucent WebViews.
- [x] 1.8 Prove the current DWM caption-button rectangle is only a fallback approximation and identify owner-thread `AppWindowTitleBar` insets as the safe-area authority.

## 2. BDD Contract

- [x] 2.1 Scenario: Given default Windows style When native ex-style is derived Then tool-window switcher exclusion is present and app-window forcing is absent.
- [x] 2.2 Scenario: Given `showInSwitchers: true` When native ex-style is derived Then tool-window exclusion is removed and app-window participation is explicit.
- [x] 2.3 Scenario: Given overlay is requested When Windows native configuration runs Then the HWND-owning STA completes AppWindow mutation before client bounds and first show continue.
- [x] 2.4 Scenario: Given overlay metrics are requested repeatedly When the native safe area is read Then DWM geometry resolves without cross-apartment AppWindow objects.
- [x] 2.5 Scenario: Given the vendored tray icon registers with `(hwnd, uID)` When bounds are queried Then the same identity returns a non-zero rect.
- [x] 2.6 Scenario: Given RGBA anti-aliased pixels When a Windows HICON mask is built Then alpha zero is transparent and alpha greater than zero remains visible.
- [x] 2.7 Scenario: Given native tray bounds When `WebviewPlacementKit` resolves tray placement Then provenance is native and screen-center fallback is not selected.
- [x] 2.8 Scenario: Given invisible DWM resize borders When public window geometry is read or changed Then visible-frame bounds remain stable without cumulative drift.
- [x] 2.9 Scenario: Given a same-version neutral-label broker When a source WebView example starts Then it uses a distinct caller-scoped endpoint.
- [x] 2.10 Scenario: Given `127.0.0.1:5173` is occupied When Vite selects a non-default loopback port Then the source example consumes `resolvedUrls.local` and creates its WebView.
- [x] 2.11 Scenario: Given a translucent Windows WebView completes a native move interaction without `WM_SIZE` When `WM_EXITSIZEMOVE` arrives Then no white-block shell-state reset runs.
- [x] 2.12 Scenario: Given explicit Windows overlay colors When a native overlay is shown Then `IReference<Color>` values reach the native caption controls before first visible paint.
- [x] 2.13 Scenario: Given a Windows overlay geometry query When the page reads the titlebar rect Then AppWindow left/right insets determine its usable width.

## 3. Implementation

- [x] 3.1 Add typed `style.platform.windows.showInSwitchers` state, default false, including parser/state JSON and runtime patching.
- [x] 3.2 Project switcher state through Windows extended styles without coupling it to icon metadata; update the normal-window example to opt in.
- [x] 3.3 Discover CBS bootstrapper locations while resolving runtime DLLs from the selected package graph; initialize WinRT on the HWND-owning thread.
- [x] 3.4 Apply overlay before first visible show and refit the WebView child after completion; reject requested-overlay failures.
- [x] 3.5 Remove the ineffective `WM_GETICON` taskbar workaround and use full-client `WM_NCCALCSIZE` for frameless and overlay windows.
- [x] 3.6 Reduce the vendored tray-icon patch to the RGBA mask correction and restore consistent shell identity for add/modify/delete/bounds.
- [x] 3.7 Use DWM visible-frame bounds publicly and compensate invisible borders in Windows move/resize operations.
- [x] 3.8 Update `AGENTS.md` architecture diagnosis and create/update `i18n.zh.md` with the user's Windows terms.
- [x] 3.9 Add a changeset describing the Windows-visible behavior change.
- [x] 3.10 Derive and pass a process-scoped caller label from the shared source WebView example runtime.
- [x] 3.11 Create Vite through its Node API, use `listen()` plus `resolvedUrls.local` for readiness, bound probes by the shared deadline, and call `close()` during shutdown.
- [x] 3.12 Track native size/move interaction state and require observed `WM_SIZE` before the legacy white-block reset can run at interaction exit.
- [x] 3.13 Add typed `windowControlsOverlay` color options, parse only opaque `#RRGGBB`, and preserve the Boolean compatibility path.
- [x] 3.14 Apply native caption-button background/symbol colors through `AppWindowTitleBar` on the HWND-owning STA.
- [x] 3.15 Restore owner-thread AppWindow titlebar measurements without reintroducing cross-apartment `Send`/`Sync`.
- [x] 3.16 Update the Windows visual example, public README, `AGENTS.md`, and `i18n.zh.md` with the overlay-color and safe-area authorities.
- [x] 3.17 Keep `example:webview-control` as a tray-utility acceptance surface by inheriting the default Windows switcher exclusion.

## 4. Verification

- [x] 4.1 Run focused Rust tests for `opentray-backend-tray-icon`, `opentray-ext-webview`, and vendored `tray-icon`.
- [x] 4.2 Run `pnpm --filter @opentray/ext-webview test`, both affected typechecks, and the ext-webview build.
- [x] 4.3 Run `cargo build -p opentray-bin -p opentray-ext-webview`, Rust formatting, and `git diff --check`.
- [x] 4.4 Run `bun run openspec:vision -- validate fix-windows-tray-webview-shell`.
- [x] 4.5 Smoke `example:webview-control`: overlay gap `2x1`, titlebar safe area `769x27`; frameless gap `0x0`.
- [x] 4.6 Smoke `example:placement`: tray and placement both report `backend.nativeTrayBounds` rather than screen-center fallback.
- [x] 4.7 Run pnpm-pub against local `OPENTRAY_BROKER_BIN`/`OPENTRAY_EXT_PATH`: `WS_EX_TOOLWINDOW=true`, `WS_EX_APPWINDOW=false`, overlay controls visible, tray-relative work-area placement, rendered tray icon.
- [x] 4.8 Do not claim macOS visual/runtime acceptance from this Windows session.
- [x] 4.9 Run the focused example-support test and visible `example:webview-control` smoke, confirming the caller-scoped endpoint.
- [x] 4.10 Run the direct Vite-server API close test and the unmodified visible `example:webview-control` command with `127.0.0.1:5173` occupied; prove URL selection, window creation, and listener release.
- [x] 4.11 Run focused Rust interaction-state tests proving pure moves cannot authorize the white-block reset while real resize remains eligible.
- [x] 4.12 Run parser, ABI boxing, and AppWindow-metric unit tests plus the facade typecheck.
- [x] 4.13 Smoke `example:webview-control` with a visibly non-default Windows button background and verify the titlebar safe-area right edge against native controls.
- [x] 4.14 Verify the default `example:webview-control` extended style contains `WS_EX_TOOLWINDOW` and excludes `WS_EX_APPWINDOW`.

## 5. Self-Review Loop

- [x] 5.1 Run `bun run openspec:vision -- commit-check fix-windows-tray-webview-shell --phase self-review` before final review evidence.
- [x] 5.2 Generate `review/self-review.md` comparing implementation with `plans/plan.md` and listing residual risks.
- [x] 5.3 Generate `review/self-review.html` with structured command/visual evidence.
- [x] 5.4 Round 2 self-review did not reopen the original Windows shell intent/spec/tasks.
- [x] 5.5 Run `bun run openspec:vision -- check fix-windows-tray-webview-shell`; check passes and archive remains deferred until user acceptance.
- [x] 5.6 Refresh the self-review for source-example broker isolation; record the focused test, visible smoke, and unrelated Windows baseline-test failure.
- [x] 5.7 Refresh the self-review for Vite server-API ownership and record the occupied-port retry, created native window, and listener-release evidence.
- [x] 5.8 Refresh the self-review with native drag acceptance after user validation.
- [x] 5.9 Refresh the self-review with overlay color, AppWindow geometry, and default-switcher evidence after user validation.
