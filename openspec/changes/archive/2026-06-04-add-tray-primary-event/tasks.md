## 1. Alignment / Investigation

- [x] 1.1 Confirm `primaryEvent` is a tray/menu projection law, not an ext-webview-specific command.
- [x] 1.2 Confirm the public event path should remain `menuClick` so existing app handlers do not split.
- [x] 1.3 Confirm platform gesture differences belong in the backend/native runtime, not `opentray-core`.

## 2. BDD Contract

- [x] 2.1 Add TypeScript spec tests proving `primaryEvent: true` is accepted on plain menu items and parsed event frames remain normal `menuClick`.
- [x] 2.2 Add Rust protocol tests proving `primaryEvent` serializes as camelCase and defaults to false/absent.
- [x] 2.3 Add kernel projection/routing tests proving primary menu roles pass through projection and backend-originated primary activation still routes as `MenuClick`.
- [x] 2.4 Add tray-icon backend projection tests for enabled primary route, disabled primary ignored, duplicate primary first-enabled-wins, and macOS single-primary direct eligibility.
- [x] 2.5 Add native broker ingress coverage or focused compile-time coverage proving tray icon click events can route through backend primary activation without broadcasting.

## 3. Implementation

- [x] 3.1 Extend `@opentray/spec` `MenuItem` plain item type with `primaryEvent?: boolean`.
- [x] 3.2 Extend `opentray-spec` Rust `MenuItem::Item` with `primary_event`.
- [x] 3.3 Carry primary item roles through `opentray-core` projection without core platform interpretation.
- [x] 3.4 Extend `opentray-backend-tray-icon` projection with stable tray icon ids and primary route lookup.
- [x] 3.5 Extend the native tray-icon runtime to disable menu-on-left-click only for platform cases that should direct-trigger primary activation.
- [x] 3.6 Extend macOS broker event-loop ingress to subscribe to tray icon events and route supported primary activation through existing session event dispatch.
- [x] 3.7 Update the daemon tray/WebView smoke example so its native menu contains only `Open WebView` with `primaryEvent: true`, allowing macOS to direct-trigger without opening a menu.
- [x] 3.8 Update public docs with the primary-event menu pattern and platform behavior notes.
- [x] 3.9 Detach native `NSMenu` chrome for macOS single-primary mode so AppKit cannot open a menu before the direct tray event route.

## 4. Verification

- [x] 4.1 Run `bun run openspec:vision -- validate add-tray-primary-event`.
- [x] 4.2 Run `pnpm --filter @opentray/spec test`.
- [x] 4.3 Run `pnpm --filter opentray test`.
- [x] 4.4 Run `cargo test -p opentray-spec -p opentray-core -p opentray-backend-tray-icon`.
- [x] 4.5 Run focused grep checks proving `opentray-core` has no Windows/macOS primary-click branches and no `webview` coupling for primary events.
- [x] 4.6 Run `git diff --check`.
- [x] 4.7 Run the narrowest smoke path that proves the primary WebView menu item still opens through normal `menuClick`.
- [x] 4.8 Run macOS native policy tests proving single-primary mode does not attach a native menu and multi-item primary mode still keeps the menu.

## 5. Self-Review Loop

- [x] 5.1 Generate `review/self-review.md` and `review/self-review.html` as review records against `plans/plan.md`, specs, tasks, and the no-new-event-family decision.
- [x] 5.2 Review did not reopen OpenSpec artifacts or tasks, so no extra apply loop update was required.
- [x] 5.3 Run `bun run openspec:vision -- check add-tray-primary-event` and decide whether to archive or reopen intent.
