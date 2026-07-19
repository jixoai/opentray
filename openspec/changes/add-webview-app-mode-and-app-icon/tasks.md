## 1. Alignment / Investigation

- [x] 1.1 Confirm the latest `plans/plan.md` records the user requirement, code evidence, independent Darwin change boundary, and the `appMode` / `appIcon` vocabulary.
- [x] 1.2 Confirm existing OpenSpec requirements for Windows switcher projection, operational visibility, auto-hide, retained sessions, App identity, and consumer examples before writing deltas.
- [x] 1.3 Confirm with the user that removing public `style.platform.windows.showInSwitchers` is an approved breaking cleanup and that `appIcon` belongs on the App-facing runtime seam.
- [x] 1.4 Confirm the Darwin mixed-window policy: process activation is `.regular` while any app-mode projection is live and `.accessory` otherwise.
- [x] 1.5 Run `bun run openspec:vision -- backup-plan add-webview-app-mode-and-app-icon` before materially revising the plan, then record the Windows identity/artwork rule and Core App mutation boundary.

## 2. BDD Contract

- [x] 2.1 Scenario: Given a retained `skill-creator-v2` WebView is hidden When its tray primary event is activated Then the same window session becomes visible and the platform Shell projection appears without enabling `keepOnTop` (traces `plans/plan.md` Final Visible Effect and `consumer-migration` requirement).
- [x] 2.2 Scenario: Given an app-mode window is visible When the native close action is used Then operational visibility becomes false, Shell membership disappears, `visibleChange(false)` is emitted once, and the retained session can be revealed again (traces `app-mode` and `platform-shell-projection`).
- [x] 2.3 Scenario: Given Windows app mode is true When either production or comparator topology projects the extended style Then `WS_EX_APPWINDOW` is present and `WS_EX_TOOLWINDOW` is absent (traces the renamed Windows requirement).
- [x] 2.4 Scenario: Given Windows app mode is false When the extended style is projected Then `WS_EX_TOOLWINDOW` is present and `WS_EX_APPWINDOW` is absent (traces the default utility mode requirement).
- [x] 2.5 Scenario: Given a Darwin runtime has two app-mode windows When one closes Then the process remains regular; when the last closes Then the process returns to accessory (traces the Darwin aggregation requirement).
- [x] 2.6 Scenario: Given explicit `appIcon`, first tray icon, and later window icon values When App identity initializes and later metadata changes Then explicit `appIcon` wins, identity is immutable, and window/page icon changes do not mutate Dock/taskbar identity (traces `app-identity`).
- [x] 2.7 Scenario: Given a platform lacks truthful Shell membership When app mode is requested Then capability reports absence or a typed unsupported error instead of a successful local boolean (traces platform capability truth).
- [x] 2.8 Scenario: Given a caller session disconnects while app-mode windows exist When cleanup runs Then all native Shell projections are removed and no later tray event reveals the destroyed session (traces session ownership and cleanup).
- [x] 2.9 Boundary: Verify that `appMode` does not implicitly alter `frameless`, `resizable`, `keepOnTop`, `autoHide`, opacity, background, title, or icon metadata.
- [x] 2.10 Boundary: Verify that no public TypeScript declaration, README, changelog, or example teaches `showInSwitchers` after migration.
- [x] 2.11 Boundary: Verify that app-mode capability DTO fields are serialized symmetrically in TypeScript, protocol, Windows, macOS, and any adapter that claims support.
- [x] 2.12 Confirm each checkbox in this file is checked only by the agent that completed and verified the task in the current working context.

## 3. OpenSpec Evidence Gate

- [x] 3.1 Run `bun run openspec:vision -- validate add-webview-app-mode-and-app-icon` after tasks are authored and record a clean result.
- [x] 3.2 Run `bun run openspec:vision -- commit-check add-webview-app-mode-and-app-icon --phase research-plan` and verify the requested phase evidence.
- [x] 3.3 Commit `plans/plan.md`, all change-local specs, and `tasks.md` as the OpenSpec artifact commit before touching product code.
- [x] 3.4 Run `bun run openspec:vision -- commit-check add-webview-app-mode-and-app-icon --phase apply` immediately before product-code work begins.

## 4. Public Contract Implementation

- [ ] 4.1 Add `appMode` to the common TypeScript WebView style and patch types with default `false`; keep it independent from all existing shell and appearance fields.
- [ ] 4.2 Replace the public Windows `showInSwitchers` type/capability field with the common `appMode` contract and update parser/serializer fixtures without adding an alias.
- [ ] 4.3 Update Rust WebView style DTOs, defaults, patch handling, and command serialization to carry `app_mode` across the extension boundary.
- [ ] 4.4 Add app-mode capability reporting to every platform DTO and reject unsupported requests with typed errors.
- [ ] 4.5 Add `appIcon?: Icon` to the App-facing runtime seam used by `createTray`, preserving the existing wire `AppOptions.icon` as the protocol identity field.
- [ ] 4.6 Implement Windows-aligned App artwork resolution: explicit app icon, packaged/carrier identity artwork, protocol App icon, first native-capable tray icon snapshot, then OS default; keep stable `appId`/AppUserModelID separate.
- [ ] 4.7 Add Core protocol/kernel App identity mutation frames and public `AppHandle` methods for `getName`, `setName`, `getIcon`, and `setIcon` without adding `createApp`.
- [ ] 4.8 Add focused TypeScript and Rust tests for defaulting, patching, breaking-field removal, capability serialization, immutable resolution, App mutation, and badge/window metadata separation.

## 5. Windows Projection And Lifecycle

- [ ] 5.1 Map common `appMode` to `WS_EX_APPWINDOW` / `WS_EX_TOOLWINDOW` for production and comparator topologies.
- [ ] 5.2 Update Windows native close handling so `WM_CLOSE` hides the retained session and updates the authoritative operational visibility projection in the same lifecycle transaction.
- [ ] 5.3 Ensure Windows reveal restores the existing session, activates the HWND, reapplies app-mode Shell projection, and resolves only after the projection is observable.
- [ ] 5.4 Add Windows BDD/unit coverage for taskbar/Alt+Tab styles, close/reveal, minimized restore, no keep-on-top coupling, and session cleanup.
- [ ] 5.5 Remove Windows README, examples, and changelog guidance that presents `showInSwitchers` as the public field; document `style.appMode` instead.

## 6. Darwin Carrier And Projection

- [ ] 6.1 Define the shared Darwin carrier adapter boundary for process identity, app icon, `.app` activation, and regular/accessory policy without importing carrier details into `opentray-core`.
- [ ] 6.2 Track live app-mode windows by `(appId, sessionId, windowId)` and aggregate activation policy transitions on show, close, hide, destroy, and session disconnect.
- [ ] 6.3 Promote the Darwin process to regular policy before an app-mode window reports successful show; demote only after the last live app-mode projection is gone.
- [ ] 6.4 Reuse the carrier contract from `ext-badge` packaging/build paths without creating a second extension-private `.app` lifecycle.
- [ ] 6.5 Project App identity artwork/name through the carrier only where the platform supports runtime mutation; do not rewrite packaged shortcut/bundle metadata.
- [ ] 6.6 Add Darwin native tests for first-window promotion, multi-window retention, last-window demotion, explicit App icon, App mutation, native close, tray reveal, and cleanup.
- [ ] 6.7 Add a macOS human-visible smoke command or update an existing WebView example so the Dock/application-switching effect can be inspected.

## 7. Consumer Migration

- [ ] 7.1 Update `skill-creator-v2` tray-host configuration to `appMode: true`, `frameless: false`, `keepOnTop: false`, and `autoHide: false`.
- [ ] 7.2 Remove the reveal-time `setStyle({ keepOnTop: true })` workaround from `skill-creator-v2`.
- [ ] 7.3 Keep `primaryEvent` labels and handlers derived from `isVisible()` / `visibleChange`, using `show()` only for first bootstrap, `toVisible()` for reveal, and `close()` for hide.
- [ ] 7.4 Add or update consumer acceptance coverage for tray open, native close, taskbar/Dock icon removal, second tray open, retained page state, and final session cleanup.
- [ ] 7.5 Update consumer skill and WebView README examples to teach `appMode` as the product decision and `appIcon` as App identity input.

## 8. Verification And Task Progress

- [ ] 8.1 Run targeted TypeScript tests for `@opentray/ext-webview`, `opentray`, and protocol fixtures.
- [ ] 8.2 Run targeted Rust tests for `opentray-ext-webview`, `opentray-runtime-node`, `opentray-bin`, and affected backend crates.
- [ ] 8.3 Run the exact `skill-creator-v2` `pnpm dev` flow against the local OpenTray artifacts and record the visible tray/window result.
- [ ] 8.4 Run `bun run openspec:vision -- validate add-webview-app-mode-and-app-icon`, `git diff --check`, and the narrowest repo verification gate that covers changed packages.
- [ ] 8.5 Update only task checkboxes completed and verified in the current context, then commit the task-progress update with matching code/BDD evidence.

## 9. Self-Review Loop

- [ ] 9.1 Run `bun run openspec:vision -- commit-check add-webview-app-mode-and-app-icon --phase self-review` before recording review evidence.
- [ ] 9.2 Write `review/self-review.md` comparing implementation and acceptance evidence against every intent section and open question.
- [ ] 9.3 Write `review/self-review.html` with structured screenshots/evidence for Windows and macOS visible behavior when those platforms are available.
- [ ] 9.4 If review changes specs, tasks, or plan, run `bun run openspec:vision -- backup-plan add-webview-app-mode-and-app-icon` when the plan changes, commit the artifact update, and reopen only the affected tasks.
- [ ] 9.5 If the same issue recurs in two independent acceptance paths, persist review loop state with `bun run openspec:vision -- review-state add-webview-app-mode-and-app-icon` and run another apply loop.
- [ ] 9.6 If review cannot exit normally, run `bun run openspec:vision -- handoff add-webview-app-mode-and-app-icon` and commit the handoff evidence before returning to user discussion.
- [ ] 9.7 If review exits normally, archive with `openspec archive add-webview-app-mode-and-app-icon` and commit the archive result.
- [ ] 9.8 Run `bun run openspec:vision -- check add-webview-app-mode-and-app-icon` and record the final workflow gate.
