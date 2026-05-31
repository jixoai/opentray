## 1. Alignment / Investigation

- [x] 1.1 Confirm the latest `plans/plan.md` reflects the relevant code survey, existing OpenSpec survey, and user Q&A.
- [x] 1.2 Confirm Option A with the user: `tray-icon` for macOS/Windows, `ksni` for Linux, webview as extension atom.
- [ ] 1.3 Confirm no destructive migration is required because the repository currently has package skeletons but no product implementation.

## 2. BDD Contract

- [ ] 2.1 Scenario: Given a client lease owns trays When the lease closes Then only that lease's trays are removed.
- [ ] 2.2 Scenario: Given two trays share a menu item id When an event arrives Then routing uses `(leaseId, surfaceId, trayId, itemId)`.
- [ ] 2.3 Scenario: Given a non-owner tray mounts to a surface When projection is rebuilt Then it remains isolated by default.
- [ ] 2.4 Scenario: Given a fake backend is injected When surfaces/trays change Then kernel tests observe backend projections without OS GUI dependencies.
- [ ] 2.5 Scenario: Given the Linux backend target is inspected When dependency metadata is checked Then GTK/libappindicator `tray-icon` features are not required by default.
- [ ] 2.6 Scenario: Given a webview command is sent When extension dispatch runs Then core routes through the extension registry without `ext == "webview"` special cases.
- [ ] 2.7 Scenario: Given rect capability is unavailable When webview show is requested Then fallback positioning is explicit.
- [ ] 2.8 Confirm each task checkbox will be updated only by the agent that completed and verified that task in the current working context.

## 3. OpenSpec Evidence Gate

- [ ] 3.1 Run `bun run openspec:vision -- validate implement-kernel-webview-foundation`.
- [ ] 3.2 Run `bun run openspec:vision -- commit-check implement-kernel-webview-foundation --phase apply`.
- [ ] 3.3 Commit `plans/plan.md`, `specs/**/spec.md`, and `tasks.md` before product-code work starts.

## 4. Kernel Implementation

- [ ] 4.1 Add Rust workspace metadata and crate skeletons for `opentray-spec`, `opentray-core`, and `opentray-bin`.
- [ ] 4.2 Implement Rust protocol/domain types for surfaces, trays, leases, menus, icons, events, backend capabilities, extension commands, and structured errors.
- [ ] 4.3 Implement `opentray-core` surface registry, lease registry, projection builder, fake backend, and extension registry.
- [ ] 4.4 Add Rust BDD tests for lease cleanup, event routing, projection isolation, fake backend injection, and extension dispatch.
- [ ] 4.5 Add concise architecture comments only at critical boundaries: kernel ownership law, backend atom law, extension host law.

## 5. Backend Adapter Foundation

- [ ] 5.1 Add macOS/Windows `tray-icon` backend crate or module boundary behind `SurfaceBackend`.
- [ ] 5.2 Add Linux `ksni` backend crate or module boundary behind `SurfaceBackend`.
- [ ] 5.3 Ensure default workspace checks do not require running a GUI event loop.
- [ ] 5.4 Add dependency or metadata checks proving Linux default backend does not depend on `tray-icon` GTK/libappindicator features.

## 6. TypeScript Client And Spec Foundation

- [ ] 6.1 Add `@opentray/spec` TypeScript source with strict protocol/domain types matching Rust protocol shapes.
- [ ] 6.2 Add `opentray` client source with typed `createSurface`, `createTray`, lease-safe handles, and extension command dispatch shape.
- [ ] 6.3 Add TypeScript tests proving malformed protocol frames do not crash parsing and webview commands remain typed extension commands.

## 7. Webview Extension Foundation

- [ ] 7.1 Add `@opentray/ext-webview` TypeScript facade that depends only on `opentray` and `@opentray/spec`.
- [ ] 7.2 Add Rust extension host ABI definitions or internal adapter scaffold that exercises the same host contract.
- [ ] 7.3 Add tests for webview command routing, fallback positioning metadata, and lease cleanup behavior.

## 8. Verification

- [ ] 8.1 Run Rust targeted tests.
- [ ] 8.2 Run TypeScript targeted tests.
- [ ] 8.3 Run `pnpm run verify`.
- [ ] 8.4 Run `bun run openspec:vision -- validate implement-kernel-webview-foundation`.
- [ ] 8.5 Run `git diff --check`.
- [ ] 8.6 Commit implementation and matching completed task checkboxes in atomic commits.

## 9. Self-Review Loop

- [ ] 9.1 Generate `review/self-review.md` comparing implementation against `plans/plan.md` and specs.
- [ ] 9.2 Generate `review/self-review.html` as structured evidence.
- [ ] 9.3 Run `bun run openspec:vision -- check implement-kernel-webview-foundation`.
- [ ] 9.4 If review updates OpenSpec artifacts or reopens tasks, commit those artifact changes before the next apply loop.
- [ ] 9.5 Do not archive until the user accepts the first-stage kernel/webview foundation.
