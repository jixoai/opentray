## 1. Alignment / Investigation

- [x] 1.1 Confirm `interview_plan.md` records the confirmed Chinese interview orientation, user Q&A ledger, code evidence, and all closed confirmation gates.
- [x] 1.2 Confirm this change declares `schema: vision2` and does not introduce legacy `plans/plan.md`, plan-backup, or self-review artifacts.
- [x] 1.3 Re-read the current `ext-webview`, `ext-badge`, native build graph, and badge helper bundle files before implementation because generated paths and release scripts may drift.
- [ ] 1.4 Confirm any destructive cleanup of existing badge helper app sources or artifact names with the user if compatibility cannot be preserved through distribution projections.

## 2. BDD Contract

- [ ] 2.1 Scenario: Given a WebView page requests camera When browser permission policy evaluates the request Then the result traces to app identity, WebView permission session, source/origin, permission family, permission state, and prompt policy.
- [ ] 2.2 Scenario: Given local host HTML declares a permission family When the policy allows local silent authorization Then the permission may be allowed without granting remote-origin trust.
- [ ] 2.3 Scenario: Given a remote origin requests permission When the exact origin is not allowlisted Then the permission is not granted and `opentrayPermissions` is not injected.
- [ ] 2.4 Scenario: Given a native prompt returns allow-once When another WebView window session requests the same permission Then the temporary grant does not cross the WebView session boundary.
- [x] 2.5 Scenario: Given a durable allow or deny decision When it is stored Then it is written to the app-scoped JS permission database under the OpenTray `appId` namespace, not WebView page storage.
- [ ] 2.6 Scenario: Given Darwin carrier builds a `.app` for declared camera/microphone use When `Info.plist` is materialized Then required privacy usage keys exist and app text overrides defaults.
- [x] 2.7 Scenario: Given badge helper builds on macOS When the helper app bundle is materialized Then badge consumes the shared Darwin carrier and does not own a private app-bundle law.
- [x] 2.8 Confirm each task checkbox is updated only by the agent that completed and verified that task in the current working context.

## 3. Implementation

- [x] 3.1 Run `bun run openspec:vision2 -- commit-check darwin-runtime-carrier-and-webview-permissions --phase apply` before app-code work starts and commit ready OpenSpec artifacts.
- [x] 3.2 Introduce an internal Darwin carrier module/build atom that owns `.app` bundle layout, `Info.plist` merge, executable placement, bundle metadata, and privacy usage string generation.
- [x] 3.3 Refactor macOS badge helper build/staging to consume the internal Darwin carrier while preserving required distribution-facing package/artifact compatibility.
- [x] 3.4 Add a typed WebView browser permission family model covering camera, microphone, geolocation, notifications, clipboard read, autoplay, local fonts, sensors, MIDI system exclusive, file read/write, multiple downloads, and window management.
- [x] 3.5 Add source/origin matching for browser permissions without overloading existing `nativeApiPolicy`.
- [ ] 3.6 Add permission decision resolution for allow, deny, prompt, allow-once, and unsupported, with allow-once scoped to the WebView window permission session.
- [ ] 3.7 Add native prompt-confirmation plumbing for controllable WebView permission requests and return typed unsupported results where the platform substrate cannot expose the family.
- [ ] 3.8 Add `opentrayPermissions` as a separately gated permission-management page object, with local support and remote exact-origin opt-in only.
- [x] 3.9 Add the default app-scoped JS permission database under the OpenTray `appId` namespace, with explicit namespace override or custom adapter support.
- [ ] 3.10 Wire backend SDK and `opentrayPermissions` flows to the same app-scoped permission store without using frontend storage as the default permission truth.
- [x] 3.11 Document the new WebView permission policy, `opentrayPermissions`, default store, Darwin carrier privacy strings, and badge carrier migration in public/contributor docs.
- [x] 3.12 When a new problem surfaces during implementation, create a typed issue with `bun run openspec:vision2 -- issues darwin-runtime-carrier-and-webview-permissions --new <bug|task|decision|risk|question> --title "<title>"` instead of silently editing this plan.
- [x] 3.13 Do not add legacy plan-backup or self-review-loop artifacts to this workflow.
- [x] 3.14 Update only current-context completed task checkboxes and commit them with matching implementation and BDD evidence.

## 4. Verification

- [ ] 4.1 Run focused TypeScript tests for permission policy parsing, source/origin matching, store namespace behavior, and `opentrayPermissions` injection policy.
- [ ] 4.2 Run focused Rust tests for native WebView permission mapping, allow/deny/prompt/allow-once/unsupported decisions, and Darwin carrier plist generation if implemented in Rust.
- [x] 4.3 Run focused native build graph tests proving badge helper and WebView Darwin runtime use the shared carrier path.
- [x] 4.4 Run `cargo test -p opentray-ext-webview` and `cargo test -p opentray-ext-badge` after native implementation changes.
- [x] 4.5 Run `pnpm --filter @opentray/ext-webview test` and `pnpm --filter @opentray/ext-badge test` after facade/package changes.
- [x] 4.6 On macOS, build the relevant helper/app artifacts and inspect the generated `.app/Contents/Info.plist` for privacy usage strings and bundle metadata.
- [x] 4.7 Run `bun run openspec:vision2 -- validate darwin-runtime-carrier-and-webview-permissions`.
- [x] 4.8 Run `bun run openspec:vision2 -- issues darwin-runtime-carrier-and-webview-permissions --validate` and inspect grouped issue state with `bun run openspec:vision2 -- issues darwin-runtime-carrier-and-webview-permissions --group-by group`.
- [x] 4.9 Run `git diff --check`.
- [ ] 4.10 Run `bun run openspec:vision2 -- commit-check darwin-runtime-carrier-and-webview-permissions --phase close` before writing the closing overview.

## 5. Close

- [ ] 5.1 Write `toc.md` with a preface plus a footnote reference block that cites every spec file.
- [ ] 5.2 Close or resolve every active issue under `issues/*.md` with valid dependency references.
- [ ] 5.3 Run `bun run openspec:vision2 -- check darwin-runtime-carrier-and-webview-permissions` to verify footnote coverage, issue convergence, and artifact presence.
- [ ] 5.4 If `check` reports open issues or orphan specs, iterate; otherwise archive with `openspec archive darwin-runtime-carrier-and-webview-permissions` after implementation is complete and commit the archive result separately.
