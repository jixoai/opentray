## 1. Alignment / Investigation

- [x] 1.1 Confirm `plans/plan.md` records the Windows native-style diagnosis, shared `resizable` decision, default behavior, and user acceptance gate.
- [x] 1.2 Confirm the requested cleanup is approved: frameless loses retained native resize chrome, while existing programmatic resizing remains unchanged.

## 2. BDD Contract

- [x] 2.1 Scenario: Given the intent declares common `style.resizable` When TypeScript and native protocol surfaces are reviewed Then effective style, patches, recipes, and capabilities expose one typed cross-platform contract.
- [x] 2.2 Scenario: Given resizable was omitted When `frameless` changes Then framed windows default to resizable and frameless windows default to fixed-size; after an explicit `resizable` patch, chrome changes preserve that choice.
- [x] 2.3 Scenario: Given a visible non-maximized Windows frameless window with `resizable: true` When a trusted primary pointer starts in any six-CSS-pixel edge or corner band Then the HWND owns constrained resizing and reports only real interaction outcomes.
- [x] 2.4 Scenario: Given a Windows frameless window When its native style is applied Then no legacy titlebar or resize-frame rendering remains, full-client WebView bounds remain, and background intent is unchanged.
- [x] 2.5 Scenario: Given a macOS borderless window When `resizable` is omitted or explicit Then its `NSWindowStyleMask::Resizable` projection matches the common effective state without Windows soft-resize code.
- [x] 2.6 Confirm task checkboxes are updated only for work completed and verified in this workspace.

## 3. Implementation

- [x] 3.1 Run `bun run openspec:vision -- validate fix-windows-frameless-soft-resize`, commit the validated plan, spec, and tasks before product-code work.
- [x] 3.2 Parse and serialize the common `resizable` intent across Rust show/style commands, the TypeScript facade, style-kit recipes, capabilities, and effective-style state.
- [ ] 3.3 Project the common effective state onto macOS style masks, with focused default and explicit override tests.
- [x] 3.4 Remove `WS_THICKFRAME` from Windows frameless style bits and switch DWM non-client rendering with chrome state so no native frame residue survives.
- [x] 3.5 Add the private WebView bootstrap edge detector and HWND-owned soft-resize session: cursor, capture, physical geometry, constraints, cancellation, and interaction events.
- [x] 3.6 Reuse `WindowProcSizeMoveInteraction` for soft-resize mutation so white-block repair remains resize-only; add concise intent comments where native shell behavior is non-obvious.
- [x] 3.7 Extend the WebView-control example with `--resizable`, visible effective-style information, and interaction-oriented smoke probes.
- [x] 3.8 Update `AGENTS.md` and `i18n.zh.md` with the durable Windows shell law and user vocabulary.
- [x] 3.9 Update only completed current-context task checkboxes and commit implementation, tests, and matching task state together.
- [x] 3.10 Scenario: Given a source WebView example has a live Vite page connection When automatic shutdown begins Then its runtime session closes before Vite and no broker/launcher process remains; document that a regular native scrollbar coexists with right-edge soft resize, while custom edge hit testing remains a page-owned layout choice.

## 4. Verification

- [x] 4.1 Run targeted Rust protocol/bootstrap/native-style tests and the ext-webview TypeScript test/typecheck surface.
- [x] 4.2 Run `bun run openspec:vision -- validate fix-windows-frameless-soft-resize` and `git diff --check`.
- [x] 4.3 Build the Windows WebView extension and run the source example with frameless default and `--resizable` variants.
- [x] 4.4 Run `bun run openspec:vision -- commit-check fix-windows-frameless-soft-resize --phase self-review` before writing review evidence.
- [x] 4.5 Run the auto-exit source WebView example and verify its identified Bun launcher and broker no longer remain after exit.

Verification limitation: task 3.3 remains unchecked. The macOS style projection and its focused source test are implemented, but this Windows host has no Apple SDK or compiler, so no macOS binary or runtime test was executed here.

## 5. Self-Review Loop

- [ ] 5.1 Generate `review/self-review.md` comparing implementation and evidence to `plans/plan.md`.
- [ ] 5.2 Generate `review/self-review.html` with test and visible-interaction evidence.
- [ ] 5.3 If review updates artifacts or reopens tasks, commit them before the next apply loop and persist real recurrence state with `review-state`.
- [ ] 5.4 After Windows visual acceptance, archive in a dedicated commit, run `bun run openspec:vision -- check fix-windows-frameless-soft-resize`, and only then begin release work.
