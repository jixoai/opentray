## 1. Alignment / Investigation

- [x] 1.1 Confirm the latest `plans/plan.md` reflects the relevant code survey, existing OpenSpec survey, and user Q&A.
- [x] 1.2 Confirm destructive rename from `version` to `protocolVersion` is acceptable in the current `0.x` protocol stage.

## 2. BDD Contract

- [x] 2.1 Scenario: Given package version `0.1.0` and protocol version `1` When endpoint identity is formatted Then the endpoint includes both version axes.
- [x] 2.2 Scenario: Given a `ready` frame without explicit `protocolVersion` When it is parsed Then it is rejected as an invalid server frame.
- [x] 2.3 Scenario: Given a mismatched protocol version When handshake compatibility is checked Then lease creation is denied before any client authority exists.
- [x] 2.4 Confirm each task checkbox will be updated only by the agent that completed and verified that task in the current working context.

## 3. Implementation

- [x] 3.1 Run `bun run openspec:vision -- commit-check implement-versioned-broker-endpoint --phase apply` before product-code work starts and commit ready OpenSpec artifacts.
- [x] 3.2 Rename protocol handshake fields from `version` to `protocolVersion` in Rust and TypeScript spec contracts.
- [x] 3.3 Add deterministic endpoint identity helpers for package version plus protocol version without OS-specific code in `opentray-core`.
- [x] 3.4 Update `opentray-bin` ready-frame output to carry protocol and broker versions separately.
- [x] 3.5 Update examples and tests to use protocol endpoint identity.

## 4. Verification

- [x] 4.1 Run Rust targeted tests.
- [x] 4.2 Run TypeScript targeted tests.
- [x] 4.3 Run `bun run openspec:vision -- validate implement-versioned-broker-endpoint`.
- [x] 4.4 Run `git diff --check`.

## 5. Self-Review Loop

- [x] 5.1 Generate `review/self-review.md` comparing implementation against `plans/plan.md` and specs.
- [x] 5.2 Generate `review/self-review.html` as structured evidence.
- [x] 5.3 Run `bun run openspec:vision -- check implement-versioned-broker-endpoint`.
