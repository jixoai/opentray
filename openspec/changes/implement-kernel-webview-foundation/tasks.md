## 1. Alignment / Investigation

- [x] 1.1 Confirm the latest `plans/plan.md` reflects the relevant code survey, existing OpenSpec survey, and user Q&A.
- [x] 1.2 Confirm Option A with the user: `tray-icon` for macOS/Windows, `ksni` for Linux, webview as extension atom.
- [x] 1.3 Confirm no destructive migration is required because the repository currently has package skeletons but no product implementation.

## 2. BDD Contract

- [x] 2.1 Scenario: Given a client lease owns trays When the lease closes Then only that lease's trays are removed.
- [x] 2.2 Scenario: Given two trays share a menu item id When an event arrives Then routing uses `(leaseId, surfaceId, trayId, itemId)`.
- [x] 2.3 Scenario: Given a non-owner tray mounts to a surface When projection is rebuilt Then it remains isolated by default.
- [x] 2.4 Scenario: Given a fake backend is injected When surfaces/trays change Then kernel tests observe backend projections without OS GUI dependencies.
- [x] 2.5 Scenario: Given the Linux backend target is inspected When dependency metadata is checked Then GTK/libappindicator `tray-icon` features are not required by default.
- [x] 2.6 Scenario: Given a webview command is sent When extension dispatch runs Then core routes through the extension registry without `ext == "webview"` special cases.
- [x] 2.7 Scenario: Given rect capability is unavailable When webview show is requested Then fallback positioning is explicit.
- [x] 2.8 Confirm each task checkbox will be updated only by the agent that completed and verified that task in the current working context.

## 3. OpenSpec Evidence Gate

- [x] 3.1 Run `bun run openspec:vision -- validate implement-kernel-webview-foundation`.
- [x] 3.2 Run `bun run openspec:vision -- commit-check implement-kernel-webview-foundation --phase apply`.
- [x] 3.3 Commit `plans/plan.md`, `specs/**/spec.md`, and `tasks.md` before product-code work starts.

## 4. Kernel Implementation

- [x] 4.1 Add Rust workspace metadata and crate skeletons for `opentray-spec`, `opentray-core`, and `opentray-bin`.
- [x] 4.2 Implement Rust protocol/domain types for surfaces, trays, leases, menus, icons, events, backend capabilities, extension commands, and structured errors.
- [x] 4.3 Implement `opentray-core` surface registry, lease registry, projection builder, fake backend, and extension registry.
- [x] 4.4 Add Rust BDD tests for lease cleanup, event routing, projection isolation, fake backend injection, and extension dispatch.
- [x] 4.5 Add concise architecture comments only at critical boundaries: kernel ownership law, backend atom law, extension host law.

## 5. Backend Adapter Foundation

- [x] 5.1 Add macOS/Windows `tray-icon` backend crate or module boundary behind `SurfaceBackend`.
- [x] 5.2 Add Linux `ksni` backend crate or module boundary behind `SurfaceBackend`.
- [x] 5.3 Ensure default workspace checks do not require running a GUI event loop.
- [x] 5.4 Add dependency or metadata checks proving Linux default backend does not depend on `tray-icon` GTK/libappindicator features.

## 6. TypeScript Client And Spec Foundation

- [x] 6.1 Add `@opentray/spec` TypeScript source with strict protocol/domain types matching Rust protocol shapes.
- [x] 6.2 Add `opentray` client source with typed `createSurface`, `createTray`, lease-safe handles, and extension command dispatch shape.
- [x] 6.3 Add TypeScript tests proving malformed protocol frames do not crash parsing and webview commands remain typed extension commands.

## 7. Webview Extension Foundation

- [x] 7.1 Add `@opentray/ext-webview` TypeScript facade that depends only on `opentray` and `@opentray/spec`.
- [x] 7.2 Add Rust extension host ABI definitions or internal adapter scaffold that exercises the same host contract.
- [x] 7.3 Add tests for webview command routing, fallback positioning metadata, and lease cleanup behavior.

## 8. Verification

- [x] 8.1 Run Rust targeted tests.
- [x] 8.2 Run TypeScript targeted tests.
- [x] 8.3 Run `pnpm run verify`.
- [x] 8.4 Run `bun run openspec:vision -- validate implement-kernel-webview-foundation`.
- [x] 8.5 Run `git diff --check`.
- [x] 8.6 Commit implementation and matching completed task checkboxes in atomic commits.

## 9. Self-Review Loop

- [x] 9.1 Generate `review/self-review.md` comparing implementation against `plans/plan.md` and specs.
- [x] 9.2 Generate `review/self-review.html` as structured evidence.
- [x] 9.3 Run `bun run openspec:vision -- check implement-kernel-webview-foundation`.
- [x] 9.4 If review updates OpenSpec artifacts or reopens tasks, commit those artifact changes before the next apply loop.
- [ ] 9.5 Do not archive until the user accepts the first-stage kernel/webview foundation.

## 10. TrayIcon Adapter Native Projection

- [x] 10.1 Add a pure tray-icon projection model derived from `SurfaceProjection` without starting an OS GUI event loop.
- [x] 10.2 Map OpenTray menu items into stable tray-icon menu ids that preserve `(surfaceId, trayId, itemId)` routing context.
- [x] 10.3 Translate tray-icon/menu-originated ids back into OpenTray `TrayEvent` values through a tested routing table.
- [x] 10.4 Keep adapter tests GUI-free and avoid importing `tray-icon` into `opentray-core`.
- [x] 10.5 Run `cargo test`, `pnpm run verify`, `bun run openspec:vision -- validate implement-kernel-webview-foundation`, and `git diff --check`.
- [x] 10.6 Commit the tray-icon adapter projection batch with matching task checkbox updates.

## 11. TrayIcon Runtime Apply Boundary

- [x] 11.1 Introduce a `TrayIconRuntime` trait that applies compiled `TrayIconProjection` values without leaking GUI handles into core.
- [x] 11.2 Wire `TrayIconBackend` through an injected runtime atom instead of directly storing projection state as backend behavior.
- [x] 11.3 Add a recording runtime test proving `sync_surface` compiles and applies projection through the runtime boundary.
- [x] 11.4 Keep the default runtime explicitly non-native until a main-thread/event-loop implementation is added.
- [x] 11.5 Run `cargo test`, `pnpm run verify`, `bun run openspec:vision -- validate implement-kernel-webview-foundation`, and `git diff --check`.
- [x] 11.6 Commit the runtime boundary batch with matching task checkbox updates.

## 12. Human-Visible TrayIcon Example

- [x] 12.1 Add a `native_tray` Cargo example that creates a visible system tray icon through a `TrayIconRuntime` atom.
- [x] 12.2 Keep the native event loop isolated to the example/runtime atom without importing native packages into `opentray-core`.
- [x] 12.3 Keep GUI-free examples available for runtime-boundary inspection.
- [x] 12.4 Update README examples so human verification uses `cargo run --example native_tray`.
- [x] 12.5 Run the runnable examples, `cargo fmt --all -- --check`, `pnpm run verify`, OpenSpec validate/check, and whitespace checks.
- [x] 12.6 Commit the native tray example batch with matching task checkbox updates.

## 13. Reusable Native TrayIcon Runtime Atom

- [x] 13.1 Promote the working native tray runtime from example-local code into the tray-icon backend crate.
- [x] 13.2 Document the native runtime event-loop precondition instead of hiding event-loop ownership inside the backend.
- [x] 13.3 Update `native_tray` to consume the exported runtime atom and keep example-only exit/menu ids in example code.
- [x] 13.4 Keep `opentray-core` isolated from `tray-icon`, `winit`, and platform GUI packages.
- [x] 13.5 Run runnable examples, `cargo fmt --all -- --check`, `pnpm run verify`, OpenSpec validate/check, and whitespace checks.
- [x] 13.6 Commit the reusable native runtime atom batch with matching task checkbox updates.

## 14. Native Menu Event Ingress

- [x] 14.1 Add a tray-icon backend/runtime ingress contract that translates native menu ids into OpenTray `TrayEvent` values.
- [x] 14.2 Store the latest native runtime route tables when applying projections without exposing GUI handles.
- [x] 14.3 Update `native_tray` so clicking menu items prints the routed OpenTray event.
- [x] 14.4 Add GUI-free tests for backend menu-event delegation.
- [x] 14.5 Run runnable examples, `cargo fmt --all -- --check`, `pnpm run verify`, OpenSpec validate/check, and whitespace checks.
- [x] 14.6 Commit the native menu event ingress batch with matching task checkbox updates.

## 15. Post-Native Runtime Self-Review Refresh

- [x] 15.1 Refresh Markdown self-review to include tray projection routing, runtime boundary, native tray example, reusable native runtime, and native menu ingress.
- [x] 15.2 Refresh HTML self-review evidence so it no longer reports completed native tray event ingress as missing.
- [x] 15.3 Run OpenSpec validate/check and whitespace checks for the refreshed review artifacts.
- [x] 15.4 Commit refreshed self-review artifacts with matching task checkbox updates.

## 16. TypeScript And WebView Human Examples

- [x] 16.1 Add a runnable TypeScript client example that creates a surface, creates a tray, and prints the emitted protocol frames without requiring a native broker.
- [x] 16.2 Add a runnable WebView extension example that sends show/navigate/message/hide commands through the normal extension command path.
- [x] 16.3 Add a runnable protocol parsing example that demonstrates valid server frame parsing and malformed frame failure behavior.
- [x] 16.4 Update package and root README files so human verification uses package example commands, not test commands.
- [x] 16.5 Ensure TypeScript examples are included in typechecking or an equivalent verification gate.
- [x] 16.6 Run the package example commands, `pnpm run verify`, OpenSpec validate/check, and whitespace checks.
- [x] 16.7 Commit the TypeScript/WebView examples batch with matching task checkbox updates.

## 17. Human-Visible WebView Acceptance Example

- [ ] 17.1 Add a native visual example that opens a real WebView window/panel a human can see while keeping WebView/window dependencies outside `opentray-core`.
- [ ] 17.2 Keep the example behind backend/example runtime boundaries so `wry` or window event-loop code does not become a core law.
- [ ] 17.3 Provide an automated smoke mode with `OPENTRAY_EXAMPLE_EXIT_AFTER_MS` for CI/local verification.
- [ ] 17.4 Update README so visual acceptance uses `cargo run --example <example_name>`.
- [ ] 17.5 Run the visual smoke command, `cargo fmt --all -- --check`, `pnpm run verify`, OpenSpec validate/check, and whitespace checks.
- [ ] 17.6 Commit the visual WebView example batch with matching task checkbox updates.
