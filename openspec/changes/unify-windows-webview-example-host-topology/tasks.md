## 1. Alignment / Investigation

- [x] 1.1 Confirm both examples already share one Win32 window class and parent-before-child cold-start procedure.
- [x] 1.2 Enumerate every probe-gated topology branch separately from probe counters, titles, and commands.
- [x] 1.3 Record the user's uncommitted webview-control visual changes and preserve them during implementation.
- [x] 1.4 Confirm no destructive production-default migration is authorized; comparator topology remains source-example-only.

## 2. BDD Contract

- [x] 2.1 Scenario: Given comparator topology without probe instrumentation When a Windows host starts Then comparator geometry/style/frame/resize policy applies and probe state does not exist.
- [x] 2.2 Scenario: Given native probe instrumentation When construction policy is resolved Then probe mode implies comparator topology.
- [x] 2.3 Scenario: Given `webview-control --no-overlay` and `win32-bug` use equivalent inputs When both windows start Then their native host topology decisions match.
- [x] 2.4 Scenario: Given webview-control overlay is enabled When the shared base and WebView2 attachment complete Then AppWindow is the sole additional construction stage.
- [x] 2.5 Scenario: Given win32-bug is visible, hidden, and revealed When native `visibleChange` is observed Then its primary tray label is Hide, Show, and Hide respectively, with Quit Demo retained.
- [x] 2.6 Confirm each task checkbox is updated only for work completed and verified in the current context.

## 3. OpenSpec Apply Gate

- [x] 3.1 Run `bun run openspec:vision -- validate unify-windows-webview-example-host-topology`.
- [x] 3.2 Run `bun run openspec:vision -- commit-check unify-windows-webview-example-host-topology --phase research-plan` and commit ready OpenSpec artifacts before product-code work.

## 4. Native Topology Implementation

- [x] 4.1 Add an internal comparator-topology environment fact independent from native probe instrumentation.
- [x] 4.2 Make the existing probe environment imply comparator topology while keeping probe state and commands gated only by the probe fact.
- [x] 4.3 Route initial position/size, ex-style, DWM non-client policy, frame refresh, frameless style, full-client policy, and soft-resize ownership through comparator topology.
- [x] 4.4 Add unit tests proving comparator-only, probe-superset, and production-default policy boundaries.
- [x] 4.5 Add concise comments at the topology/instrumentation boundary.

## 5. Example And Tray Implementation

- [x] 5.1 Enable comparator topology before broker creation in Windows webview-control without enabling probe instrumentation.
- [x] 5.2 Enable the explicit comparator topology switch in win32-bug alongside probe instrumentation.
- [x] 5.3 Keep win32-bug on the shared `createExamplePrimaryMenu` / `syncExamplePrimaryMenu` contract.
- [x] 5.4 Extend win32-bug smoke to prove Hide -> Show -> Hide menu projection and retained-session reuse.
- [x] 5.5 Preserve the user's existing webview-control page, titlebar, and CSS changes unchanged.

## 6. Domain Records

- [x] 6.1 Update `AGENTS.md` with comparator-topology versus probe-instrumentation law and overlay boundary.
- [x] 6.2 Update `i18n.zh.md` with `完全一样的底层路径` and the retained tray wording.
- [x] 6.3 Update package/example guidance with the exact `--no-overlay` A/B command and overlay delta.

## 7. Verification

- [x] 7.1 Run Rust formatting and `cargo test -p opentray-ext-webview --lib`.
- [x] 7.2 Run CLI tests/typecheck and Svelte check without modifying the user's visual files.
- [x] 7.3 Build matching source broker and extension DLL.
- [x] 7.4 Run webview-control bridge smoke with overlay and without overlay using comparator topology.
- [x] 7.5 Run win32-bug transparency, frameless, and retained tray lifecycle smoke.
- [x] 7.6 Run `bun run openspec:vision -- validate unify-windows-webview-example-host-topology` and `git diff --check`.
- [x] 7.7 Hand the source-built webview-control command to the user for visual residue acceptance.

## 8. Self-Review Loop

- [ ] 8.1 Run `bun run openspec:vision -- commit-check unify-windows-webview-example-host-topology --phase self-review`.
- [ ] 8.2 Generate `review/self-review.md` and `review/self-review.html` against `plans/plan.md`.
- [ ] 8.3 If visual review changes intent, back up the plan and commit reopened OpenSpec tasks before another apply loop.
- [ ] 8.4 Archive only after user visual acceptance; otherwise preserve a normal handoff with exact source commands.
- [ ] 8.5 Run `bun run openspec:vision -- check unify-windows-webview-example-host-topology` at the normal exit.