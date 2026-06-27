## 1. Alignment / Investigation

- [x] 1.1 Confirm the latest `plans/plan.md` reflects the badge capability scope, the three-platform intent, and the macOS debug-panel requirement.
- [x] 1.2 Confirm the current OpenSpec survey for `webview-extension`, `consumer-skills`, and the archived cross-platform window work is sufficient to reuse rather than re-invent.
- [x] 1.3 Confirm Linux will be implemented as honest reduced capability support unless a real native badge substrate proves stronger during implementation.

## 2. BDD Contract

- [x] 2.1 Scenario: Given a client calls the badge facade When the command reaches the generic extension host Then the broker routes it without badge-specific parsing in core.
- [x] 2.2 Scenario: Given a caller inspects badge capabilities When the runtime cannot support a family truthfully Then `getCapabilities()` reports reduced or unsupported status explicitly.
- [x] 2.3 Scenario: Given a platform renders a badge projection When the native shell updates it Then the durable badge facts are not silently rewritten by projection changes.
- [x] 2.4 Scenario: Given Linux lacks a native badge primitive When the client requests that family Then the extension rejects the request with a typed unsupported result.
- [x] 2.5 Scenario: Given the macOS badge debug panel is open When the operator toggles badge/progress/overlay/attention controls Then the panel uses `ext-webview` IPC to drive the real badge contract.
- [x] 2.6 Confirm each task checkbox will be updated only by the agent that completed and verified that task in the current working context.

## 3. Implementation

- [ ] 3.1 Run `bun run openspec:vision -- commit-check implement-ext-badge-status-surface --phase apply` before product-code work starts and commit ready OpenSpec artifacts.
- [x] 3.2 Extend `@opentray/ext-badge` public types and exports with the honest capability-gated status contract.
- [x] 3.3 Implement or wire the native badge projection adapters for macOS, Windows, and Linux with explicit unsupported results for missing primitives.
- [x] 3.4 Add the macOS badge debug panel through `@opentray/ext-webview` IPC and make it display capability metadata plus operation results.
- [x] 3.5 Add concise intent comments at the native capability boundary and the debug-panel IPC boundary.
- [x] 3.6 Update package docs and examples so the capability matrix and honest Linux reduced support are visible.
- [x] 3.7 Update only current-context completed task checkboxes and commit them with matching implementation and BDD evidence.

## 4. Verification

- [x] 4.1 Run targeted badge package tests and typechecks.
- [x] 4.2 Run the macOS badge debug panel path through `pnpm --filter opentray example:webview-control` or the new badge-focused debug entrypoint once added.
- [ ] 4.3 Run platform-specific native tests for the badge runtime atoms on macOS, Windows, and Linux.
- [x] 4.4 Run `bun run openspec:vision -- validate implement-ext-badge-status-surface`.
- [x] 4.5 Run `bun run openspec:vision -- commit-check implement-ext-badge-status-surface --phase self-review` before writing final review evidence.

## 5. Self-Review Loop

- [x] 5.1 Generate `review/self-review.md` as the macro review thinking record comparing implementation against `plans/plan.md`.
- [x] 5.2 Generate `review/self-review.html` as the screenshot / interaction / structured evidence presentation for the macOS debug panel.
- [ ] 5.3 If the review updates OpenSpec artifacts or reopens tasks, commit those artifact changes before the next apply loop.
- [ ] 5.4 If the review enters a real loop, persist iteration state with the OpenSpec workflow command before continuing.
- [ ] 5.5 If review cannot exit normally, run `bun run openspec:vision -- handoff implement-ext-badge-status-surface` and commit the handoff evidence before returning to user discussion.
- [ ] 5.6 If review exits normally, run `openspec archive implement-ext-badge-status-surface` and commit the archive result.
- [x] 5.7 Run `bun run openspec:vision -- check implement-ext-badge-status-surface` and decide whether to exit or return to `research-plan` with a backed-up plan revision.
