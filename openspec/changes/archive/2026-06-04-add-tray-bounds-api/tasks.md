## 1. Alignment / Investigation

- [x] 1.1 Confirm the latest `plans/plan.md` reflects the relevant code survey, existing OpenSpec survey, and user Q&A.
- [x] 1.2 Confirm no destructive migration, cleanup, or state reset is required before introducing additive tray-bounds capability.

## 2. BDD Contract

- [x] 2.1 Add TypeScript protocol tests proving tray-bounds request/response frames are accepted and typed with `Rect | null` semantics.
- [x] 2.2 Add client SDK tests proving `TrayHandle.getBounds()` sends the tray-bounds request for the current `(spaceId, trayId)` and resolves `Rect | null`.
- [x] 2.3 Add kernel tests proving tray-bounds lookup is authorized by tray ownership and rejected for non-owner sessions.
- [x] 2.4 Add backend-adapter tests proving tray-icon bounds lookup is keyed by tray identity, not by one shared surface rect.
- [x] 2.5 Add native runtime tests or focused compile-time coverage proving unsupported tray-bounds paths stay explicit instead of synthesizing geometry.
- [x] 2.6 Add WebView bootstrap/bridge tests proving `navigator.opentray.tray.getBounds()` uses a dedicated tray namespace and respects capability policy gating.
- [x] 2.7 Add smoke/demo coverage proving a tray-launched WebView panel can anchor from tray bounds without hardcoded placement.
- [x] 2.8 Confirm each task checkbox will be updated only by the agent that completed and verified that task in the current working context.

## 3. Implementation

- [x] 3.1 Run `bun run openspec:vision -- commit-check add-tray-bounds-api --phase research-plan` before product-code work starts and commit ready OpenSpec artifacts, unless the user explicitly continues without the commit checkpoint.
- [x] 3.2 Extend `@opentray/spec` with additive tray-bounds request/response protocol shapes and update parser coverage.
- [x] 3.3 Extend `packages/cli/src/client.ts` `TrayHandle` with `getBounds()` and keep the capability tray-owned rather than extension-owned.
- [x] 3.4 Extend `opentray-core` backend traits and kernel/broker request routing so tray-bounds lookup is routed by `(spaceId, trayId)` ownership.
- [x] 3.5 Extend `opentray-backend-tray-icon` projection/runtime so macOS and Windows can resolve bounds from the native tray handle for a specific tray identity.
- [x] 3.6 Keep Linux tray-bounds paths explicit by returning `None` or typed unsupported until a truthful backend path exists.
- [x] 3.7 Extend `crates/opentray-ext-webview` page bootstrap, private bridge, and policy model with a tray capability family that exposes `navigator.opentray.tray.getBounds()`.
- [x] 3.8 Update demos, smoke paths, README, and skills so the primary tray -> custom WebView panel story uses tray bounds instead of guessed placement.
- [x] 3.9 Add concise intent comments only at the tray-identity routing boundary and the WebView tray-policy boundary.
- [x] 3.10 Update only current-context completed task checkboxes and commit them with the matching implementation / BDD evidence.

## 4. Verification

- [x] 4.1 Run targeted tests for `@opentray/spec`, `opentray` client SDK, `opentray-core`, `opentray-backend-tray-icon`, and `opentray-ext-webview`.
- [x] 4.2 Run `bun run openspec:vision -- validate add-tray-bounds-api`.
- [x] 4.3 Run focused grep checks proving `opentray-core` did not gain WebView-specific tray-bounds branches.
- [x] 4.4 Run `git diff --check`.
- [x] 4.5 Run the narrowest human-visible smoke path proving a tray-launched WebView panel can anchor from tray bounds on supported platforms.
- [x] 4.6 Run `bun run openspec:vision -- commit-check add-tray-bounds-api --phase self-review` before writing final review evidence.

## 5. Self-Review Loop

- [x] 5.1 Generate `review/self-review.md` as the macro review thinking record comparing implementation against `plans/plan.md`.
- [x] 5.2 Generate separate `review/self-review.html` as the screenshot / interaction / structured evidence presentation.
- [x] 5.3 Review did not reopen OpenSpec artifacts or tasks, so no extra apply loop commit was required before continuing to archive.
- [x] 5.4 Review did not enter a real loop, so no `review-state` file was required.
- [x] 5.5 Review exited normally, so no abnormal handoff was required before returning to user discussion.
- [x] 5.6 If review exits normally, run `openspec archive add-tray-bounds-api` and commit the archive result.
- [x] 5.7 Run `bun run openspec:vision -- check add-tray-bounds-api` and decide whether to exit or return to `research-plan` with a backed-up plan revision.
