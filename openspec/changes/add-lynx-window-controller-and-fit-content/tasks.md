## 1. Alignment / Investigation

- [x] 1.1 Confirm the latest `plans/plan.md` reflects the current `ext-lynx`, `ext-webview`, upstream LynxExplorer host bridge, and official Lynx sizing evidence.
- [x] 1.2 Confirm no destructive migration, cleanup, or persisted state reset is required beyond additive protocol and runtime changes.

## 2. BDD Contract

- [ ] 2.1 Scenario: Given `ext-lynx` native window API is enabled When a Lynx page reads `navigator.window` and `navigator.opentrayWindow` Then both exist, reference the same capability object, and expose async host-window methods traceable to `openspec/changes/add-lynx-window-controller-and-fit-content/specs/lynx-extension/spec.md`.
- [ ] 2.2 Scenario: Given a Lynx page uses `navigator.window.listen("resized", handler)` When the native host resizes or fit-content clamps the window Then the page receives the scoped event without depending on WebView IPC or global `window.postMessage`.
- [ ] 2.3 Scenario: Given a Lynx page uses `navigator.window.setTitle(...)` or `navigator.window.setIcon(...)` When the native runtime applies the metadata Then the page can observe `titlechange` / `iconchange` and the macOS runtime no longer shows a blank Dock icon.
- [ ] 2.4 Scenario: Given a Lynx page reads `navigator.screen` When native screen API is enabled Then `navigator.screen.getScreenDetails()` returns a durable screen-details-like payload and optional `window.getScreenDetails()` stays opt-in.
- [x] 2.5 Scenario: Given no startup feature expression or explicit size When a Lynx bundle is shown Then the window uses the fixed fallback shell and no host-owned fit loop is active.
- [x] 2.6 Scenario: Given startup capability flags are configured independently When the window launches Then the enabled host behavior matches the explicit startup request and disabling a parent feature also disables its dependent binding.
- [ ] 2.7 Scenario: Given explicit `width` / `height` and min/max limits are provided When the window launches or resizes Then the final frame honors the explicit size intent and remains clamped to bounds.
- [ ] 2.8 Scenario: Given a requested style or capability is unsupported When the page invokes that host-window method Then the promise rejects with a typed unsupported error instead of faking success.
- [x] 2.9 Confirm each task checkbox will be updated only by the agent that completed and verified that task in the current working context.

## 3. Implementation

- [ ] 3.1 Run `bun run openspec:vision -- commit-check add-lynx-window-controller-and-fit-content --phase apply` before product-code work starts and commit the ready OpenSpec artifacts.
- [x] 3.2 Extend `@opentray/ext-lynx` public types and commands so `show` can configure native window API, native screen API, initial title/icon, startup frameless mode, fixed size, and sizing bounds.
- [x] 3.3 Extend `crates/opentray-ext-lynx` command parsing and event emission for host-window control, title/icon metadata, screen details, capability queries, style state, and explicit startup controls.
- [x] 3.4 Patch the Lynx sidecar runtime path so it registers the OpenTray Lynx host bridge through Native Modules, runtime-attached globals, and `GlobalEventEmitter`.
- [x] 3.5 Implement native macOS window operations for close, move, resize, title, icon, screen, style, capabilities, and host-window event forwarding without adding Lynx branches to core or daemon.
- [x] 3.6 Remove host-owned fit-content sizing, keep explicit fixed-size precedence, and preserve min/max clamp behavior for standalone Lynx windows.
- [x] 3.7 Add a real `OpenTrayLynxRuntime` app bundle icon resource and wire the macOS carrier metadata so Dock visual identity is never blank at launch.
- [x] 3.8 Add concise intent comments at the critical effect points for host bridge ownership, startup feature gating, and fixed-size precedence.
- [x] 3.9 Update Lynx smoke/demo surfaces so a human can verify the controller, metadata, screen, and startup feature behavior visually instead of only reading logs.
- [x] 3.10 Update the strengthened skills and developer-facing docs so future extension work preserves the Lynx host-window law and sizing policy.
- [x] 3.11 Update only current-context completed task checkboxes and commit them with the matching implementation and BDD evidence.

## 4. Verification

- [x] 4.1 Run targeted Rust, TypeScript, and smoke verification for the new `ext-lynx` command surface and sizing policy.
- [x] 4.2 Run `bun run openspec:vision -- validate add-lynx-window-controller-and-fit-content` for this change.
- [x] 4.3 Run `bun run openspec:vision -- commit-check add-lynx-window-controller-and-fit-content --phase self-review` before writing final review evidence.

## 5. Self-Review Loop

- [x] 5.1 Generate `review/self-review.md` as the macro review thinking record comparing implementation against `plans/plan.md`.
- [x] 5.2 Generate separate `review/self-review.html` as the screenshot, interaction, and structured evidence presentation.
- [x] 5.3 If the review updates OpenSpec artifacts or reopens tasks, commit those artifact changes before the next apply loop.
- [ ] 5.4 If the review is entering a real loop, run `bun run openspec:vision -- review-state add-lynx-window-controller-and-fit-content` to persist iteration and recurrence state.
- [ ] 5.5 If review cannot exit normally, run `bun run openspec:vision -- handoff add-lynx-window-controller-and-fit-content` and commit the handoff evidence before returning to user discussion.
- [ ] 5.6 If review exits normally, run `openspec archive add-lynx-window-controller-and-fit-content` and commit the archive result.
- [x] 5.7 Run `bun run openspec:vision -- check add-lynx-window-controller-and-fit-content` and decide whether to exit or return to `research-plan` with a backed-up plan revision.
