## 1. Alignment / Investigation

- [ ] 1.1 Confirm the latest `plans/plan.md` reflects the current `ext-lynx`, `ext-webview`, upstream LynxExplorer host bridge, and official Lynx sizing evidence.
- [ ] 1.2 Confirm no destructive migration, cleanup, or persisted state reset is required beyond additive protocol and runtime changes.

## 2. BDD Contract

- [ ] 2.1 Scenario: Given `ext-lynx` native window API is enabled When a Lynx page reads `navigator.window` and `navigator.opentrayWindow` Then both exist, reference the same capability object, and expose async host-window methods traceable to `openspec/changes/add-lynx-window-controller-and-fit-content/specs/lynx-extension/spec.md`.
- [ ] 2.2 Scenario: Given a Lynx page uses `navigator.window.listen("resized", handler)` When the native host resizes or fit-content clamps the window Then the page receives the scoped event without depending on WebView IPC or global `window.postMessage`.
- [ ] 2.3 Scenario: Given `fitContentSize` is left unspecified When a Lynx bundle is shown with no explicit fixed size Then the first visible window size follows fit-content policy instead of a large arbitrary fixed shell.
- [ ] 2.4 Scenario: Given `fitContentSize: false` or explicit `width` / `height` are provided When the window launches Then fixed host sizing wins and content-fit does not override those explicit dimensions.
- [ ] 2.5 Scenario: Given fit-content computes a size outside configured bounds When min/max limits are present Then the final frame is clamped and emitted events report the clamped size.
- [ ] 2.6 Scenario: Given a requested style or capability is unsupported When the page invokes that host-window method Then the promise rejects with a typed unsupported error instead of faking success.
- [ ] 2.7 Confirm each task checkbox will be updated only by the agent that completed and verified that task in the current working context.

## 3. Implementation

- [ ] 3.1 Run `bun run openspec:vision -- commit-check add-lynx-window-controller-and-fit-content --phase apply` before product-code work starts and commit the ready OpenSpec artifacts.
- [ ] 3.2 Extend `@opentray/ext-lynx` public types and commands so `show` can configure native window API, fit-content policy, fixed size, and sizing bounds.
- [ ] 3.3 Extend `crates/opentray-ext-lynx` command parsing and event emission for host-window control, capability queries, style state, and fit-content lifecycle.
- [ ] 3.4 Patch the Lynx sidecar runtime path so it registers the OpenTray Lynx host bridge through Native Modules, runtime-attached globals, and `GlobalEventEmitter`.
- [ ] 3.5 Implement native macOS window operations for close, move, resize, style, capabilities, and host-window event forwarding without adding Lynx branches to core or daemon.
- [ ] 3.6 Implement default-on fit-content sizing with explicit opt-out, explicit fixed-size precedence, and min/max clamp behavior for standalone Lynx windows.
- [ ] 3.7 Add concise intent comments at the critical effect points for host bridge ownership, fit-content defaulting, and fixed-size precedence.
- [ ] 3.8 Update Lynx smoke/demo surfaces so a human can verify the controller and fit-content behavior visually instead of only reading logs.
- [ ] 3.9 Update the strengthened skills and developer-facing docs so future extension work preserves the Lynx host-window law and sizing policy.
- [ ] 3.10 Update only current-context completed task checkboxes and commit them with the matching implementation and BDD evidence.

## 4. Verification

- [ ] 4.1 Run targeted Rust, TypeScript, and smoke verification for the new `ext-lynx` command surface and sizing policy.
- [ ] 4.2 Run `bun run openspec:vision -- validate add-lynx-window-controller-and-fit-content` for this change.
- [ ] 4.3 Run `bun run openspec:vision -- commit-check add-lynx-window-controller-and-fit-content --phase self-review` before writing final review evidence.

## 5. Self-Review Loop

- [ ] 5.1 Generate `review/self-review.md` as the macro review thinking record comparing implementation against `plans/plan.md`.
- [ ] 5.2 Generate separate `review/self-review.html` as the screenshot, interaction, and structured evidence presentation.
- [ ] 5.3 If the review updates OpenSpec artifacts or reopens tasks, commit those artifact changes before the next apply loop.
- [ ] 5.4 If the review is entering a real loop, run `bun run openspec:vision -- review-state add-lynx-window-controller-and-fit-content` to persist iteration and recurrence state.
- [ ] 5.5 If review cannot exit normally, run `bun run openspec:vision -- handoff add-lynx-window-controller-and-fit-content` and commit the handoff evidence before returning to user discussion.
- [ ] 5.6 If review exits normally, run `openspec archive add-lynx-window-controller-and-fit-content` and commit the archive result.
- [ ] 5.7 Run `bun run openspec:vision -- check add-lynx-window-controller-and-fit-content` and decide whether to exit or return to `research-plan` with a backed-up plan revision.
