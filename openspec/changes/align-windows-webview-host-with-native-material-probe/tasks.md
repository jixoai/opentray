## 1. Alignment / Investigation

- [x] 1.1 Compare the native probe and OpenTray window class, CreateWindowExW inputs, initial geometry, DWM projection, WebView2 creation, show order, and WndProc paint behavior.
- [x] 1.2 Record the user's direct visual evidence and the superseded archive conclusion in `plans/plan.md` without rewriting archived history.
- [x] 1.3 Confirm destructive scope: the user explicitly allowed bold changes and requested replacement of the existing win32-bug UI.

## 2. BDD Contract

- [x] 2.1 Scenario: Given a material host cold-starts When WebView2 is created Then native style, material, paint ownership, and initial geometry already belong to the parent.
- [x] 2.2 Scenario: Given probe mode is enabled When host paint changes among no-fill, Black, and Gray Then only native WndProc paint behavior changes.
- [x] 2.3 Scenario: Given probe mode is enabled When material changes among Acrylic, Mica, and None Then one retained redirection HWND is reused.
- [x] 2.4 Scenario: Given win32-bug loads When controls are visible Then every page pixel outside the centered probe controls remains transparent.
- [x] 2.5 Confirm each task checkbox is updated only for work completed and verified in the current context.

## 3. OpenSpec Apply Gate

- [x] 3.1 Run `bun run openspec:vision -- validate align-windows-webview-host-with-native-material-probe`.
- [x] 3.2 Run `bun run openspec:vision -- commit-check align-windows-webview-host-with-native-material-probe --phase research-plan` and commit the ready OpenSpec artifacts before product-code work.

## 4. Native Host Implementation

- [x] 4.1 Remove `CS_OWNDC` from the OpenTray top-level WebView window class and add a regression assertion for the class style.
- [x] 4.2 Split cold-start host projection from retained style updates so initial native style/material/geometry completes before WebView2 construction.
- [x] 4.3 Prevent the pre-material initial SetWindowPos resize and keep later native resize ordering parent-before-child.
- [x] 4.4 Keep production material host paint Black while adding environment-gated native probe material/paint state and commands.
- [x] 4.5 Add concise intent comments at cold-start, DWM projection, and WndProc ownership boundaries.
- [x] 4.6 Make probe-only frameless use the standalone comparator shell while leaving production frameless unchanged.

## 5. Probe-Equivalent Example

- [x] 5.1 Start win32-bug at 900x620, framed, resizable, Acrylic, with the native probe environment switch enabled.
- [x] 5.2 Replace WindowPanel/cards/titlebar/event-log UI with the centered 3x3+1 probe control matrix.
- [x] 5.3 Implement the probe keyboard shortcuts and typed bridge actions while keeping the page substrate transparent.
- [x] 5.4 Remove obsolete win32-bug components and update smoke assertions for the new controls.

## 6. Domain Records

- [x] 6.1 Update `AGENTS.md` with the cold-start parent-before-WebView law and probe/production boundary.
- [x] 6.2 Update `i18n.zh.md` with the user's phrases `??????????` and `webview?????`.
- [x] 6.3 Update the main Windows material-host spec so the durable law no longer depends only on the archived delta.
- [x] 6.4 Record the distinction between material-host residue and OpenTray-only non-client-frame residue.

## 7. Verification

- [x] 7.1 Run Rust formatting, targeted Windows ext-webview tests, and `cargo check -p opentray-ext-webview`.
- [x] 7.2 Run the Svelte example check, CLI typecheck, and focused example support tests.
- [x] 7.3 Build matching source broker and extension DLL and smoke `example:win32-bug`.
- [x] 7.4 Run `bun run openspec:vision -- validate align-windows-webview-host-with-native-material-probe` and `git diff --check`.
- [x] 7.5 Hand the exact source-built example to the user for visual equivalence testing; do not claim pixel acceptance from logs.

## 8. Self-Review Loop

- [ ] 8.1 Run `bun run openspec:vision -- commit-check align-windows-webview-host-with-native-material-probe --phase self-review`.
- [ ] 8.2 Generate `review/self-review.md` and `review/self-review.html` against `plans/plan.md`.
- [ ] 8.3 Commit reopened OpenSpec tasks before another apply loop if visual review changes intent.
- [ ] 8.4 Archive only after user visual acceptance; otherwise back up and revise `plans/plan.md`.
- [ ] 8.5 Run `bun run openspec:vision -- check align-windows-webview-host-with-native-material-probe` at the normal exit.
