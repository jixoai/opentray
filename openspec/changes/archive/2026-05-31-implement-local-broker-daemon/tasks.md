## 1. Alignment / Investigation

- [x] 1.1 Confirm the latest `plans/plan.md` reflects the relevant code survey, existing OpenSpec survey, and user Q&A.
- [x] 1.2 Treat `daemon` as canonical command spelling after the user corrected `deamon` as a typo.

## 2. BDD Contract

- [x] 2.1 Scenario: Given `opentray daemon start` When no same-version broker is healthy Then a current-version broker is started.
- [x] 2.2 Scenario: Given two package versions When start/stop commands run Then each command affects only its own version directory and endpoint.
- [x] 2.3 Scenario: Given concurrent same-version starts When runtime locking runs Then at most one broker owns the endpoint.
- [x] 2.4 Confirm each task checkbox will be updated only by the agent that completed and verified that task in the current working context.

## 3. Implementation

- [x] 3.1 Run `bun run openspec:vision -- commit-check implement-local-broker-daemon --phase apply` before product-code work starts and commit ready OpenSpec artifacts.
- [x] 3.2 Add `opentray` package bin entry and CLI command parser for `daemon start|stop|restart`.
- [x] 3.3 Add version-scoped runtime directory, pid, and lock helpers.
- [x] 3.4 Add a minimal broker process lifecycle that binds the current version endpoint and emits ready metadata.
- [x] 3.5 Keep process supervision and OS IPC outside `opentray-core`.

## 4. Verification

- [x] 4.1 Run targeted CLI lifecycle tests.
- [x] 4.2 Run Rust regression tests to confirm broker CLI work does not pollute core/backend crates.
- [x] 4.3 Run `pnpm run build`.
- [x] 4.4 Run `pnpm run verify`.
- [x] 4.5 Run `bun run openspec:vision -- validate implement-local-broker-daemon`.
- [x] 4.6 Run `git diff --check`.

## 5. Self-Review Loop

- [x] 5.1 Generate `review/self-review.md` comparing implementation against `plans/plan.md` and specs.
- [x] 5.2 Generate `review/self-review.html` as structured evidence.
- [x] 5.3 Run `bun run openspec:vision -- check implement-local-broker-daemon`.
