<!--
Orthogonal intents (2026-07-20; original user request: make a stable app-mode
entry relaunch the consumer with the last or explicitly configured command):
1. Trace runtime normalization to the public contract.
2. Trace descriptor persistence to stable bundle ownership.
3. Trace Darwin no-argument execution to cold-launch acceptance.
4. Preserve live-session and non-Darwin boundaries.
5. Add the confirmed Darwin warm-reopen and development launch-vector contract.
-->

## 1. Alignment / Investigation

- [x] 1.1 Confirm `plans/plan.md` records the current SDK, packaging, broker, and carrier code survey plus the user's launch-command requirements.
- [x] 1.2 Confirm the change is Darwin cold-launch only; live-process Dock reopen and Windows/Linux persistence remain open product gates, not hidden implementation assumptions.
- [x] 1.3 Confirm no destructive migration or state reset is required; the new descriptor is additive and existing bundles remain valid until the next runtime initialization.

## 2. BDD Contract

- [x] 2.1 BDD: Given `appLaunch` is omitted or null, when a local Darwin runtime initializes, then the descriptor contains `process.execPath`, `process.argv.slice(1)`, and `process.cwd()` (plan: Final Visible Effect; spec: runtime-launch-contract / Runtime App Launch Command).
- [x] 2.2 BDD: Given an explicit command with relative cwd, when the runtime initializes, then the persisted vector is shell-free and cwd is resolved against the current cwd (spec: runtime-launch-contract / Explicit launch configuration).
- [x] 2.3 BDD: Given a managed or prebuilt stable bundle, when the launch command changes, then only `opentray-launch.json` changes and the immutable manifest/assets remain valid (spec: darwin-launch-descriptor / Versioned Launch Descriptor and Prebuilt Bundle Launch State).
- [x] 2.4 BDD: Given a valid `.app` is opened with no broker arguments, when the Darwin carrier runs, then it spawns the descriptor command once, detaches, and exits (spec: darwin-carrier-cold-launch / Darwin Carrier Cold Launch).
- [x] 2.5 BDD: Given a missing, malformed, or incompatible descriptor, when the carrier runs without `broker`, then it exits non-zero with the descriptor path and does not execute an arbitrary command (spec: darwin-carrier-cold-launch / error scenario).
- [x] 2.6 BDD: Given a live retained broker session, when the tray reveal path is used, then no second consumer is launched (spec: darwin-carrier-cold-launch / Scope Boundary For Reopen And Other Platforms).
- [x] 2.7 Confirm each checkbox is checked only by the agent that completed and verified it in the current working context.

## 3. OpenSpec Evidence Gate

- [x] 3.1 Run `bun run openspec:vision -- validate add-app-launch-command` and fix strict schema/format errors.
- [x] 3.2 Run `bun run openspec:vision -- commit-check add-app-launch-command --phase research-plan` and commit the ready plan/spec/task artifacts before product-code work starts.

## 4. Implementation

- [x] 4.1 Add the public `AppLaunchCommand`/`appLaunch` runtime types and normalize omitted/null/explicit values without shell strings or environment persistence.
- [x] 4.2 Add the versioned `opentray-launch.json` descriptor type, strict parser, and atomic writer in `@opentray/packaging` under the existing bundle lock.
- [x] 4.3 Thread the normalized descriptor through local broker resolution and update it after managed generation or successful prebuilt validation, including broker reuse.
- [x] 4.4 Keep `opentray-app-bundle.json` compatibility hashing independent from mutable launch state and preserve prebuilt asset immutability.
- [x] 4.5 Add the Darwin no-argument carrier entry path in `opentray-bin`; locate the descriptor relative to the bundle, validate it, spawn directly with null stdio, and preserve the existing `broker` path.
- [x] 4.6 Keep non-Darwin no-argument behavior unchanged and document the live-process Dock reopen boundary.
- [x] 4.7 Add concise top-of-file intent comments and critical carrier/descriptor comments that cite the launch-command and stable-bundle laws from `plans/plan.md`.
- [x] 4.8 Update `@opentray/packaging` and `opentray` README contracts with the vector shape, fallback semantics, no-shell rule, descriptor path, and platform scope.
- [x] 4.9 Update only current-context completed checkboxes and commit task progress with matching code and BDD evidence.
- [x] 4.10 Add a fixed-release changeset for the additive `opentray` and `@opentray/packaging` public capability.

## 5. Verification

- [x] 5.1 Run packaging unit tests for automatic/explicit normalization, atomic descriptor updates, prebuilt immutability, and malformed descriptor rejection.
- [x] 5.2 Run CLI/daemon tests proving descriptor refresh on broker reuse and no mutation for external endpoints.
- [x] 5.3 Run `cargo test -p opentray-bin` including pure descriptor parsing and carrier command construction tests.
- [x] 5.4 Run a Darwin visible cold-launch smoke with a temporary consumer script and verify exactly one child invocation; do not treat this as final Dock visual acceptance.
- [x] 5.5 Run `pnpm run build`, `pnpm run verify`, and `git diff --check` at the narrowest viable scope before the final gate.
- [x] 5.6 Run `bun run openspec:vision -- validate add-app-launch-command` again after implementation.
- [x] 5.7 Run `bun run openspec:vision -- commit-check add-app-launch-command --phase self-review` before writing review evidence.

## 6. Self-Review Loop

- [x] 6.1 Generate `review/self-review.md` comparing the implementation against `plans/plan.md`, every spec requirement, and every BDD task.
- [x] 6.2 Generate separate `review/self-review.html` containing structured runtime evidence and the cold-launch boundary; visual Dock acceptance remains user-owned.
- [x] 6.3 If review updates OpenSpec artifacts or reopens tasks, commit those artifact changes before another implementation loop.
- [x] 6.4 If the review enters a real loop, run `bun run openspec:vision -- review-state add-app-launch-command` and record iteration/recurrence state.
- [ ] 6.5 If review cannot exit normally, run `bun run openspec:vision -- handoff add-app-launch-command` and commit the handoff evidence before returning to user discussion.
- [ ] 6.6 If review exits normally, run `openspec archive add-app-launch-command` and commit the archive result.
- [x] 6.7 Run `bun run openspec:vision -- check add-app-launch-command` and decide whether the change exits or returns to a backed-up plan revision.

## 7. Owner Acceptance Rejection / Round 2

- [x] 7.1 Back up round-1 `plans/plan.md`, enter review iteration 1, and capture the exact installed broker/bundle graph before changing implementation.
- [x] 7.2 Reproduce the red facts: two physical same-AppId bundles, wrong `webui` package ownership, missing launch descriptor on the online broker graph, and detached stdio pointing to `/dev/null`.
- [x] 7.3 Commit revised plan/spec/task/review evidence before corrective product-code work.
- [x] 7.4 BDD: the running consumer script identity beats ambient nested-workspace `npm_package_json`, while explicit package metadata still wins.
- [x] 7.5 BDD: after successful handshake and descriptor commit, dead OpenTray-owned legacy/wrong-package same-AppId bundles are unregistered and removed; live owners and failed initialization are preserved.
- [x] 7.6 BDD: default broker stdout/stderr append to caller-scoped `runtime/broker.log`, with explicit `inherit` and `ignore` overrides.
- [x] 7.7 BDD: missing descriptors, spawn failures, spawn PID, and early consumer stderr append to bundle-local `opentray-launch.log` without persisting environment state.
- [x] 7.8 Implement caller identity precedence, post-handshake identity convergence, and persistent broker/carrier logs without adding launch state to Core.
- [x] 7.9 Update `AGENTS.md`, `i18n.zh.md`, and package READMEs with the convergence and diagnostics laws.
- [x] 7.10 Rebuild/stage the local native runtime, apply a real pnpm workspace link in `skill-creator-v2`, and prove the consumer resolves this checkout rather than online `0.17.0`.
- [x] 7.11 Run focused TypeScript/Rust tests, repository build/verify, OpenSpec validation/check, and `git diff --check`.
- [x] 7.12 Run `skill-creator-v2` through `pnpm dev`; capture the sole current bundle, descriptor, broker hash, and both documented log paths, then return Dock visual/pinned-click acceptance to the owner.

## 8. Owner Acceptance / Round 3 Warm Reopen And Development Launch

- [x] 8.1 Back up the round-2 plan and record the confirmed warm-reopen, explicit-focus, development-vector, and consumer-documentation decisions.
- [x] 8.2 BDD: when a running Darwin carrier receives Dock reopen, emit one generic `reopenRequested` intent without executing the cold descriptor.
- [x] 8.3 BDD: when app-mode windows exist, the default WebView projection selects the most recently active retained window and composes `toVisible()` with `focus()`.
- [x] 8.4 Add typed host/page `focus()` commands and native macOS/Windows projections without moving WebView policy into Core.
- [x] 8.5 Install an AppKit delegate bridge because winit does not expose `applicationShouldHandleReopen:` directly; preserve the generic broker event boundary.
- [x] 8.6 Adapt `skill-creator-v2` development tray initialization to persist the resolved absolute package-manager vector for `pnpm dev` from the repository root.
- [x] 8.7 Update only `skill-creator-v2/AGENTS.md` with the agreed incompatible-content reset versus I/O failure boundary; do not change its registry code.
- [x] 8.8 Run focused Rust/TypeScript tests, rebuild the linked OpenTray artifacts, and validate the cold and warm Dock paths with durable logs.
