# Vision-Driven Self Review

## Review State

- Change: implement-kernel-webview-foundation
- Iteration: 2
- Recurring issue counts: none
- Exit-condition judgment: The first-stage kernel, TypeScript contracts, webview extension facade, backend adapter boundaries, tray-icon projection routing, runtime apply boundary, human-visible native tray example, reusable native tray runtime atom, and native menu event ingress are implemented and verified. Native WebView runtime behavior remains the next implementation layer, not completed work.
- Next loop action: Ask for user acceptance of this first-stage foundation, then either archive or continue with native WebView/runtime transport work before archive.

## Intent Alignment

| Intent point | Evidence | Verdict |
| ------------ | -------- | ------- |
| Build real base kernel, not package placeholders | `crates/opentray-core` implements surface, tray, lease, projection, backend, event routing, and extension dispatch laws with BDD tests. | Met |
| Keep `tray-icon` as a backend atom, not a core law | `opentray-core` has no `tray-icon` dependency; `crates/opentray-backend-tray-icon` owns tray-icon projection/runtime/native atoms. | Met |
| Keep Linux default off `tray-icon` GTK/libappindicator path | `opentray-bin` target dependency metadata uses `opentray-backend-ksni` for Linux and `opentray-backend-tray-icon` only for macOS/Windows. | Met |
| Make webview an extension atom | `@opentray/ext-webview` depends only on `opentray` and `@opentray/spec`; Rust core dispatches arbitrary extension names through `ExtensionRegistry`. | Met |
| Preserve extensibility architecture | Core owns identity, lease, routing, projection, and extension registry; backends, runtime atoms, and extensions are trait/contract atoms. | Met |
| Provide human-verifiable examples | `cargo run --example native_tray` creates a real system tray icon; `runtime_boundary` and `default_unbound` remain GUI-free examples. | Met |
| Keep verification deterministic | `FakeBackend`, backend contract tests, manifest composition tests, and GUI-free runtime ingress tests run through `pnpm run verify`; native example has `OPENTRAY_EXAMPLE_EXIT_AFTER_MS` for smoke checks. | Met |

## Deviations From Intent

1. The native WebView runtime is not present yet. The delivered webview scope is the TypeScript facade plus Rust extension ABI/registry foundation.
2. The `SurfaceBackend` trait intentionally does not require `Send + Sync` because `tray-icon::TrayIcon` is event-loop-affine on macOS. Cross-thread dispatch should be modeled as a separate runtime/queue atom.
3. `NativeTrayIconRuntime` currently supports RGBA icon assets for native materialization. Encoded/file icon loading is explicitly unsupported until an asset policy is finalized.
4. `@opentray/spec` TypeScript types are structural matches, not generated from Rust schemas. This is acceptable for P0 but should become generated or schema-driven before protocol churn increases.

## New Questions For User

1. Should the next implementation batch prioritize native WebView runtime behavior or a broker/event-loop queue that can host tray and webview runtime atoms together?
2. Should Rust and TypeScript protocol parity become schema-generated before the next transport layer is added?

## Evidence

- HTML report: `review/self-review.html`
- Git commits reviewed:
  - `3170a6c spec: define kernel webview foundation`
  - `f6027cc feat: add kernel and webview foundation contracts`
  - `8972b1f feat: add backend adapter boundaries`
  - `e8c9e54 feat: add tray icon projection routing`
  - `f1fa9d5 feat: add tray icon runtime boundary`
  - `8780434 feat: add native tray example`
  - `5d71b34 feat: add native tray runtime atom`
  - `da94e2b feat: route native tray menu events`
- Command evidence:
  - `OPENTRAY_EXAMPLE_EXIT_AFTER_MS=1000 cargo run --example native_tray`
  - `cargo run --example runtime_boundary`
  - `cargo run --example default_unbound`
  - `cargo fmt --all -- --check`
  - `cargo test`
  - `cargo test -p opentray-backend-tray-icon`
  - `pnpm run verify`
  - `bun run openspec:vision -- validate implement-kernel-webview-foundation`
  - `bun run openspec:vision -- check implement-kernel-webview-foundation`
  - `git diff --check`
- Uncommitted paths, if any: self-review artifacts and task updates before this self-review refresh commit.
- Task checkboxes updated by this working context: yes.

## HTML Review Report

The separate `review/self-review.html` report presents the same findings as a structured status table suitable for quick evidence scanning.

## Exit Handling

- Normal exit for this turn: commit refreshed self-review artifacts and return to the user acceptance gate.
- Archive: intentionally not run until the user accepts the first-stage foundation.
- Abnormal exit: not needed.
- Intent realignment: not needed.
