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
- [x] 2.6 Scenario: Given a strict current-platform `appIcon`, a separate tray icon, and later window icon values When App identity initializes and later metadata changes Then only `appIcon` supplies App artwork, while tray/window/page icon changes do not mutate Dock/taskbar identity (traces `app-identity`).
- [x] 2.7 Scenario: Given a platform lacks truthful Shell membership When app mode is requested Then capability reports absence or a typed unsupported error instead of a successful local boolean (traces platform capability truth).
- [x] 2.8 Scenario: Given a caller session disconnects while app-mode windows exist When cleanup runs Then all native Shell projections are removed and no later tray event reveals the destroyed session (traces session ownership and cleanup).
- [x] 2.9 Boundary: Verify that `appMode` does not implicitly alter `frameless`, `resizable`, `keepOnTop`, `autoHide`, opacity, background, title, or icon metadata.
- [x] 2.10 Boundary: Verify that no public TypeScript declaration, README, changelog, or example teaches `showInSwitchers` after migration.
- [x] 2.11 Boundary: Verify that app-mode capability DTO fields are serialized symmetrically in TypeScript, protocol, Windows, macOS, and any adapter that claims support.
- [x] 2.12 Confirm each checkbox in this file is checked only by the agent that completed and verified the task in the current working context.
- [x] 2.13 Regression: Given the published Darwin carrier zip is staged but the SDK launches raw `bin/opentray` When `appMode` promotes the process Then the Dock exposes `opentray` plus the generic `exec` icon; require a broker-bearing caller carrier and Core App artwork projection instead.
- [x] 2.14 Scenario: Given one native asset omits `variant` or declares `["default", "light"]` When the AppIcon catalog is normalized Then omission means `default` and the aliased asset is selectable through both declared names.
- [x] 2.15 Scenario: Given a semantic catalog declares `empty` and `files` When the caller invokes `tray.app.setAppIcon("files")` Then Core retains the catalog, selects only the `files` projection, and no WebView command is involved.
- [x] 2.16 Boundary: Given a missing, malformed, or platform-incomplete variant When selection is requested Then a typed error is returned and the prior active variant/native projection remains unchanged.

## 3. OpenSpec Evidence Gate

- [x] 3.1 Run `bun run openspec:vision -- validate add-webview-app-mode-and-app-icon` after tasks are authored and record a clean result.
- [x] 3.2 Run `bun run openspec:vision -- commit-check add-webview-app-mode-and-app-icon --phase research-plan` and verify the requested phase evidence.
- [x] 3.3 Commit `plans/plan.md`, all change-local specs, and `tasks.md` as the OpenSpec artifact commit before touching product code.
- [x] 3.4 Run `bun run openspec:vision -- commit-check add-webview-app-mode-and-app-icon --phase apply` immediately before product-code work begins.

## 4. Public Contract Implementation

- [x] 4.1 Add `appMode` to the common TypeScript WebView style and patch types with default `false`; keep it independent from all existing shell and appearance fields.
- [x] 4.2 Replace the public Windows `showInSwitchers` type/capability field with the common `appMode` contract and update parser/serializer fixtures without adding an alias.
- [x] 4.3 Update Rust WebView style DTOs, defaults, patch handling, and command serialization to carry `app_mode` across the extension boundary.
- [x] 4.4 Add app-mode capability reporting to every platform DTO and reject unsupported requests with typed errors.
- [x] 4.5 Initial pass: add generic `appIcon?: Icon` to the App-facing runtime seam (superseded by strict task 4.11).
- [x] 4.6 Initial pass: implement Windows-aligned artwork precedence including tray fallback (superseded by strict task 4.13).
- [x] 4.7 Add Core protocol/kernel App identity mutation frames and public `AppHandle` methods for `getName`, `setName`, `getIcon`, and `setIcon` without adding `createApp`.
- [x] 4.8 Add focused TypeScript and Rust tests for defaulting, patching, breaking-field removal, capability serialization, immutable resolution, App mutation, and badge/window metadata separation.
- [x] 4.9 Move the shared Darwin `.app` carrier artifact contract into the core runtime distribution model; keep `opentray-core` bundle-free and add package-manifest/staging assertions for executable plus carrier completeness.
- [x] 4.10 Move consumer app-icon normalization and ICNS generation into `@opentray/vite-plugin`; include source, built implementation, recipe, encoder versions, and output existence in the cache gate.
- [x] 4.11 Replace generic `Icon` app identity input with a strict `AppIcon` platform asset array in TypeScript and Rust; keep tray `Icon` unchanged.
- [x] 4.12 Validate native formats and platform coverage (`darwin/icns`, `windows/ico`, `linux/png|svg`) and reject invalid explicit arrays before broker connection.
- [x] 4.13 Remove runtime tray-icon inheritance for App identity and update App mutation/identity frames to carry `AppIcon`.
- [x] 4.14 Add protocol, facade, and native projection tests for platform selection, duplicate rejection, missing-current-platform rejection, and standards-only sources.
- [x] 4.15 Add `variant?: string | readonly string[]` to each AppIcon asset, normalize omission to `default`, validate uniqueness per variant, and export `AppIconVariantOf<TCatalog>` for literal-name inference.
- [x] 4.16 Rename the unreleased App handle icon methods to `getAppIcon`, `getAppIconVariant`, and `setAppIcon`; accept either a replacement catalog, a variant name, or null without adding `createApp`.
- [x] 4.17 Add a Core protocol mutation for active App icon variant, retain catalog plus active name in App identity, project only the selected subset, and preserve state on typed rejection.
- [x] 4.18 Add TypeScript/Rust tests for default aliases, semantic `empty/files`, duplicate-per-variant rejection, direct catalog replacement, selected-name persistence, and missing-variant rollback.

## 5. Windows Projection And Lifecycle

- [x] 5.1 Map common `appMode` to `WS_EX_APPWINDOW` / `WS_EX_TOOLWINDOW` for production and comparator topologies.
- [ ] 5.2 Update Windows native close handling so `WM_CLOSE` hides the retained session and updates the authoritative operational visibility projection in the same lifecycle transaction.
- [ ] 5.3 Ensure Windows reveal restores the existing session, activates the HWND, reapplies app-mode Shell projection, and resolves only after the projection is observable.
- [ ] 5.4 Add Windows BDD/unit coverage for taskbar/Alt+Tab styles, close/reveal, minimized restore, no keep-on-top coupling, and session cleanup.
- [x] 5.5 Remove Windows README, examples, and changelog guidance that presents `showInSwitchers` as the public field; document `style.appMode` instead.

## 6. Darwin Carrier And Projection

- [x] 6.1 Define the shared Darwin carrier adapter boundary for process identity, app icon, `.app` activation, and regular/accessory policy without importing carrier details into `opentray-core`.
- [ ] 6.2 Track live app-mode windows by `(appId, sessionId, windowId)` and aggregate activation policy transitions on show, close, hide, destroy, and session disconnect.
- [ ] 6.3 Promote the Darwin process to regular policy before an app-mode window reports successful show; demote only after the last live app-mode projection is gone.
- [x] 6.4 Extract the carrier source/build path from `ext-badge`, stage the shared `.app` into each matching `@opentray/darwin-*` package, and keep badge packages limited to badge artifacts.
- [x] 6.5 Project App identity artwork/name through the carrier only where the platform supports runtime mutation; do not rewrite packaged shortcut/bundle metadata.
- [ ] 6.6 Add Darwin native tests for first-window promotion, multi-window retention, last-window demotion, explicit App icon, App mutation, native close, tray reveal, and cleanup.
- [ ] 6.7 Add a macOS human-visible smoke command or update an existing WebView example so the Dock/application-switching effect can be inspected.
- [x] 6.8 Replace the idle Swift runtime carrier with a broker-bearing carrier template and make native build/staging prove that the bundled executable bytes equal the paired broker artifact.
- [x] 6.9 Materialize the Darwin carrier atomically per caller, project `appId`/bootstrap `appName` into `Info.plist`, launch `Contents/MacOS/opentray`, and include the materialized executable path in broker reuse authority.
- [x] 6.10 Initial pass: project generic native-capable Core App artwork to `NSApplication` before app-mode promotion (superseded by strict native-format projection task 4.14).

## 7. Consumer Migration

- [x] 7.1 Update `skill-creator-v2` tray-host configuration to `appMode: true`, `frameless: false`, `keepOnTop: false`, and `autoHide: false`.
- [x] 7.2 Remove the reveal-time `setStyle({ keepOnTop: true })` workaround from `skill-creator-v2`.
- [x] 7.3 Keep `primaryEvent` labels and handlers derived from `isVisible()` / `visibleChange`, using `show()` only for first bootstrap, `toVisible()` for reveal, and `close()` for hide.
- [ ] 7.4 Add or update consumer acceptance coverage for tray open, native close, taskbar/Dock icon removal, second tray open, retained page state, and final session cleanup.
- [ ] 7.5 Update consumer skill and WebView README examples to teach `appMode` as the product decision and `appIcon` as App identity input.
- [x] 7.6 Link `skill-creator-v2` directly to the local `opentray` and `@opentray/ext-webview` packages, pass an explicit non-template `appIcon`, and wire `predev` to one OpenTray preparation command that builds/stages facade, broker, carrier, and WebView artifacts.
- [x] 7.7 Replace the consumer-local icon generator with `@opentray/vite-plugin`, use `color-symbol.png` explicitly, and resolve source-dev tray assets from `webui/static` before stale build output.
- [x] 7.8 Make `@opentray/vite-plugin` emit a standards-compliant `AppIcon` manifest with ICNS, ICO, and Linux theme-size outputs; keep the generator optional for consumers.
- [x] 7.9 Declare `skill-creator-v2` hand-generated native assets as `default/light/dark` variants, stage only runtime ICNS/ICO files for package builds, and do not add theme IPC or ext-webview coupling.

## 8. Verification And Task Progress

- [x] 8.1 Run targeted TypeScript tests for `@opentray/ext-webview`, `opentray`, and protocol fixtures.
- [x] 8.2 Run targeted Rust tests for `opentray-ext-webview`, `opentray-runtime-node`, `opentray-bin`, and affected backend crates.
- [x] 8.3 Run the exact `skill-creator-v2` `pnpm dev` flow against the local OpenTray artifacts and record the visible tray/window result.
- [x] 8.4 Run `bun run openspec:vision -- validate add-webview-app-mode-and-app-icon`, `git diff --check`, and the narrowest repo verification gate that covers changed packages.
- [x] 8.5 Update only task checkboxes completed and verified in the current context, then commit the task-progress update with matching code/BDD evidence.
- [x] 8.6 Verify the linked-consumer preparation from a clean staged-artifact state, start the exact `skill-creator-v2` `pnpm dev` path without publishing, and hand macOS visual acceptance to the user.
- [x] 8.7 Run the plugin's generation/cache tests, consumer typecheck, Svelte check, and production WebUI build; record the pre-existing daemon/socket blocker separately from the new artifact chain.
- [x] 8.8 Re-run strict AppIcon contract tests and linked `skill-creator-v2` preparation after the platform asset migration.
- [x] 8.9 Re-run strict variant contract tests, Core/backend projection tests, linked preparation, Skill Creator tests/typechecks/Svelte build, cache inspection, OpenSpec validate/check, and diff/format gates.

## 9. Self-Review Loop

- [x] 9.1 Run `bun run openspec:vision -- commit-check add-webview-app-mode-and-app-icon --phase self-review` before recording review evidence.
- [x] 9.2 Write `review/self-review.md` comparing implementation and acceptance evidence against every intent section and open question.
- [ ] 9.3 Write `review/self-review.html` with structured screenshots/evidence for Windows and macOS visible behavior when those platforms are available.
- [ ] 9.4 If review changes specs, tasks, or plan, run `bun run openspec:vision -- backup-plan add-webview-app-mode-and-app-icon` when the plan changes, commit the artifact update, and reopen only the affected tasks.
- [ ] 9.5 If the same issue recurs in two independent acceptance paths, persist review loop state with `bun run openspec:vision -- review-state add-webview-app-mode-and-app-icon` and run another apply loop.
- [ ] 9.6 If review cannot exit normally, run `bun run openspec:vision -- handoff add-webview-app-mode-and-app-icon` and commit the handoff evidence before returning to user discussion.
- [ ] 9.7 If review exits normally, archive with `openspec archive add-webview-app-mode-and-app-icon` and commit the archive result.
- [x] 9.8 Run `bun run openspec:vision -- check add-webview-app-mode-and-app-icon` and record the final workflow gate.

## 10. Stable App Bundle Provisioning

- [x] 10.1 Replace the broker-bearing Darwin carrier zip with one broker binary plus a minimal carrier template in each Darwin runtime package.
- [x] 10.2 Add package-name resolution and canonical `@scope+name` addressing for `~/.opentray/apps/<package>/<appName>.app`, independent from `callerLabel` and OpenTray version.
- [x] 10.3 Add public `appBundle: { path?, reinitialize? }` runtime options with caller-root-relative path resolution and typed validation.
- [x] 10.4 Reinitialize managed bundles inside the stable directory through sibling-file replacement, write the manifest last, and never mutate a live incompatible owner.
- [x] 10.5 Add strict prebuilt mode that validates and launches a plugin-generated bundle without modifying it or falling back to managed generation.
- [x] 10.6 Put the shared Darwin appBundle builder and manifest parser in `@opentray/packaging`.
- [x] 10.7 Export appBundle build adapters from Vite, esbuild, webpack, and tsdown plugin packages without duplicating generation logic.
- [x] 10.8 Add focused tests for package discovery, custom/default paths, managed regeneration, prebuilt rejection, stable-path locking, bundle manifest commit order, and every plugin hook.
- [x] 10.9 Update public READMEs, changesets, AGENTS laws, Chinese terminology, and linked-consumer configuration.
- [x] 10.10 Run focused package/runtime/plugin tests, OpenSpec validation/check, build/typecheck, and the exact linked Skill Creator preparation flow; leave visual acceptance to the user.
