## 1. Alignment / Investigation

- [x] 1.1 Confirm the latest `plans/plan.md` reflects the relevant code survey, existing OpenSpec survey, and user Q&A.
- [x] 1.2 Confirm no destructive migration / cleanup / state reset is required; this is an additive style field.
- [x] 1.3 Confirm each task checkbox will be updated only by the agent that completed and verified that task in the current working context.

## 2. BDD Contract

- [x] 2.1 Scenario: Given host code supplies `style.opacity` in `show(...)` When the facade serializes the command Then opacity crosses the extension boundary as common style state without changing `background`.
- [x] 2.2 Scenario: Given page or host code calls `setStyle({ opacity })` When the runtime validates the payload Then finite values in `0..1` apply and invalid values reject without changing native style.
- [x] 2.3 Scenario: Given opacity and background material are both requested When `getStyle()` or `stylechange` reports style Then opacity and background remain separate fields.

## 3. Implementation

- [x] 3.1 Keep the implementation inside `packages/ext-webview` and `crates/opentray-ext-webview`; do not add WebView-specific parser or runtime logic to core or broker code.
- [x] 3.2 Add `opacity` to the TypeScript public style/capability contracts and facade tests.
- [x] 3.3 Add shared native parsing/normalization for initial `show(...).style.opacity`.
- [x] 3.4 Add macOS style state, validation, live mutation, `getStyle()` projection, capability metadata, and AppKit whole-window alpha projection.
- [x] 3.5 Add Windows style state, validation, live mutation, `getStyle()` projection, capability metadata, and Win32 whole-window alpha projection.
- [x] 3.6 Update WebView docs/examples guidance to show opacity as orthogonal to background material/transparent backing.

## 4. Verification

- [x] 4.1 Run `pnpm --filter @opentray/ext-webview test`.
- [x] 4.2 Run `cargo test -p opentray-ext-webview`.
- [x] 4.3 Run `RUSTC=/Users/kzf/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc /Users/kzf/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo check -p opentray-ext-webview --target x86_64-pc-windows-msvc`.
- [x] 4.4 Run `bun run openspec:vision -- validate add-webview-window-opacity`.
- [x] 4.5 Run `git diff --check`.

## 5. Self-Review Loop

- [x] 5.1 Generate `review/self-review.md` comparing implementation against `plans/plan.md`.
- [x] 5.2 Run `bun run openspec:vision -- check add-webview-window-opacity` and decide whether to exit or return to `research-plan` with a backed-up plan revision.
- [x] 5.3 If review updates OpenSpec artifacts or reopens tasks, preserve that in the task list before the next apply loop.
