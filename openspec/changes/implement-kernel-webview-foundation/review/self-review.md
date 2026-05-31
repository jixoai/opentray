# Vision-Driven Self Review

## Review State

- Change: implement-kernel-webview-foundation
- Iteration: 1
- Recurring issue counts: none
- Exit-condition judgment: The first-stage kernel, extension host law, TypeScript contracts, webview facade, and backend adapter boundaries are implemented and verified. Native OS tray rendering and native webview runtime behavior remain the next implementation layer, not completed work.
- Next loop action: Ask for user acceptance of this foundation, then continue with native backend behavior and webview runtime implementation before archive.

## Intent Alignment

| Intent point | Evidence | Verdict |
| ------------ | -------- | ------- |
| Build real base kernel, not package placeholders | `crates/opentray-core` implements surface, tray, lease, projection, backend, and extension dispatch laws with BDD tests. | Met |
| Keep `tray-icon` as a backend atom, not a core law | `opentray-core` has no `tray-icon` dependency; `crates/opentray-backend-tray-icon` is a separate workspace member. | Met |
| Keep Linux default off `tray-icon` GTK/libappindicator path | `opentray-bin` target dependency metadata uses `opentray-backend-ksni` for Linux and `opentray-backend-tray-icon` only for macOS/Windows. | Met |
| Make webview an extension atom | `@opentray/ext-webview` depends only on `opentray` and `@opentray/spec`; Rust core dispatches arbitrary extension names through `ExtensionRegistry`. | Met |
| Preserve extensibility architecture | Core owns identity, lease, routing, projection, and extension registry; backends and extensions are trait/contract atoms. | Met |
| Keep verification non-GUI and deterministic | `FakeBackend`, backend contract tests, and manifest composition tests run in `pnpm run verify` without GUI event loops. | Met |

## Deviations From Intent

1. The backend adapter crates currently prove crate boundaries, target-specific composition, capability reporting, and trait conformance. They do not yet translate real `tray-icon` or `ksni` OS events into complete OpenTray projections.
2. The native webview implementation is not present yet. The delivered webview scope is the TS facade plus Rust extension ABI/registry foundation.
3. The `SurfaceBackend` trait originally required `Send + Sync`, but `tray-icon::TrayIcon` is not thread-safe on macOS because it contains `Rc<RefCell<...>>`. The correct law is now that a native backend is event-loop-affine; cross-thread execution should be a separate message-queue adapter, not an unsafe marker on the backend atom.
4. `@opentray/spec` TypeScript types are structural matches, not generated from Rust schemas. This is acceptable for P0 but should become generated or schema-driven before protocol churn increases.

## New Questions For User

1. Should the next implementation batch prioritize real `tray-icon` macOS event translation first, or the native webview runtime first?
2. Should we introduce schema/code generation now for Rust and TypeScript protocol parity, or wait until the transport layer stabilizes?

## Evidence

- HTML report: `review/self-review.html`
- Git commits reviewed:
  - `3170a6c spec: define kernel webview foundation`
  - `f6027cc feat: add kernel and webview foundation contracts`
  - `8972b1f feat: add backend adapter boundaries`
- Command evidence:
  - `cargo fmt --all -- --check`
  - `cargo test`
  - `pnpm install --frozen-lockfile`
  - `pnpm run build`
  - `pnpm run typecheck`
  - `pnpm run test`
  - `pnpm run verify`
  - `bun run openspec:vision -- validate implement-kernel-webview-foundation`
  - `bun run openspec:vision -- commit-check implement-kernel-webview-foundation --phase apply`
  - `bun run openspec:vision -- check implement-kernel-webview-foundation`
  - `bun run openspec:vision -- commit-check implement-kernel-webview-foundation --phase self-review`
  - `git diff --check`
- Uncommitted paths, if any: self-review artifacts and task updates before the self-review commit.
- Task checkboxes updated by this working context: yes.

## HTML Review Report

The separate `review/self-review.html` report presents the same findings as a structured status table suitable for quick evidence scanning.

## Exit Handling

- Normal exit for this turn: commit self-review artifacts and return to user acceptance gate.
- Archive: intentionally not run until the user accepts the first-stage foundation.
- Abnormal exit: not needed.
- Intent realignment: not needed.
