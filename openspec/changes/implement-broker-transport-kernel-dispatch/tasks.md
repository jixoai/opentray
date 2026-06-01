## 1. Alignment / Investigation

- [x] 1.1 Confirm `plans/plan.md` reflects the current repo truth for `packages/cli`, `packages/spec`, `crates/opentray-spec`, `crates/opentray-core`, `crates/opentray-bin`, and backend crates.
- [x] 1.2 Confirm the specs trace every durable requirement back to the final visible effect and to existing archived platform laws.
- [x] 1.3 Confirm no destructive state cleanup is required beyond current-version daemon runtime files; ask the user before deleting any cross-version state.
- [x] 1.4 Confirm every task checkbox is updated only by the agent that completed and verified it in the current working context.

## 2. BDD Contract

- [x] 2.1 Scenario: Given a client connects to the versioned endpoint When it sends compatible `init` Then the broker returns accepted lease metadata and allows later commands.
- [x] 2.2 Scenario: Given a client connects to the versioned endpoint When it sends incompatible `init` Then the broker returns a structured error and creates no lease.
- [x] 2.3 Scenario: Given a client sends a command before accepted `init` When the broker handles it Then the kernel is not mutated.
- [x] 2.4 Scenario: Given an accepted session sends `create-surface` with `requestId` When the kernel creates the surface Then the response includes the same `requestId` and broker-issued `SurfaceRef`.
- [x] 2.5 Scenario: Given an accepted session sends `create-tray` When the kernel syncs projections Then the selected backend receives the daemon-created tray projection.
- [x] 2.6 Scenario: Given two sessions own trays on one surface When one session disconnects Then only that lease-owned state is removed and the backend receives an updated projection.
- [x] 2.7 Scenario: Given a native menu event arrives When the kernel routes it Then only the owning client receives an event frame.
- [x] 2.8 Scenario: Given a TS client has a pending request When a native event frame arrives Then the event stream receives it and the pending request remains unresolved until its matching `requestId`.
- [x] 2.9 Scenario: Given `OPENTRAY_EXAMPLE_EXIT_AFTER_MS` is set When `pnpm --filter opentray example:daemon-tray` runs Then it exits and closes the lease without requiring a human click.

## 3. OpenSpec Checkpoint

- [x] 3.1 Run `bun run openspec:vision -- validate implement-broker-transport-kernel-dispatch`.
- [x] 3.2 Run `bun run openspec:vision -- commit-check implement-broker-transport-kernel-dispatch --phase research-plan`.
- [x] 3.3 Commit `plans/plan.md`, `specs/**/spec.md`, and `tasks.md` before product-code work starts.

## 4. Implementation

- [x] 4.1 Update Rust and TypeScript protocol models with accepted lease metadata, request-correlated responses, and structured request-correlated errors.
- [x] 4.2 Add Rust protocol parsing / serialization tests for compatible init, incompatible init, request ids, and event frames.
- [x] 4.3 Implement a Rust broker session dispatcher that gates commands on `init` and maps client frames to `opentray-core::Kernel`.
- [x] 4.4 Implement lease cleanup on transport disconnect and verify only owned trays are removed.
- [x] 4.5 Move daemon process supervision so `opentray daemon start` starts the Rust broker binary or an equivalent composition entrypoint, not the placeholder Node frame server.
- [x] 4.6 Implement versioned local transport binding for the current platform endpoint without scanning other package versions.
- [x] 4.7 Compose the selected backend in `opentray-bin` and apply kernel projections through `SurfaceBackend`.
- [x] 4.8 Wire backend-originated tray/menu events into kernel routing and session-specific event egress.
- [x] 4.9 Implement the TypeScript local broker client with handshake, request id management, response promises, event subscription, and explicit close.
- [x] 4.10 Remove or migrate public client placeholder identity behavior such as `pending:*`.
- [x] 4.11 Add `pnpm --filter opentray example:daemon-tray` as the human-visible daemon-path example.
- [x] 4.12 Add concise intent comments only at critical effect points: init-before-lease, request/event separation, lease cleanup, and native event routing.
- [ ] 4.13 Update only current-context completed task checkboxes and commit them with matching implementation / BDD evidence.

## 5. Verification

- [x] 5.1 Run targeted Rust tests for protocol and broker dispatch.
- [x] 5.2 Run targeted TypeScript tests for local broker client request/event separation.
- [x] 5.3 Run targeted daemon lifecycle tests after replacing the placeholder broker runner.
- [x] 5.4 Run `cargo test`.
- [x] 5.5 Run `pnpm --filter @opentray/spec test`.
- [x] 5.6 Run `pnpm --filter opentray test`.
- [x] 5.7 Run `pnpm run build`.
- [x] 5.8 Run `pnpm run verify`.
- [x] 5.9 Run `bun run openspec:vision -- validate implement-broker-transport-kernel-dispatch`.
- [x] 5.10 Run `git diff --check`.
- [x] 5.11 Smoke the daemon-path visual example with `OPENTRAY_EXAMPLE_EXIT_AFTER_MS=1500 pnpm --filter opentray example:daemon-tray`.
- [x] 5.12 Provide the human acceptance command `opentray daemon start` plus `pnpm --filter opentray example:daemon-tray` and explain the expected visible tray/menu event output.
- [ ] 5.13 Run `bun run openspec:vision -- commit-check implement-broker-transport-kernel-dispatch --phase self-review` before writing final review evidence.

## 6. Self-Review Loop

- [ ] 6.1 Generate `review/self-review.md` comparing implementation against `plans/plan.md`, specs, tasks, and visual acceptance evidence.
- [ ] 6.2 Generate `review/self-review.html` as structured visual/interaction evidence for the daemon tray path.
- [ ] 6.3 If self-review updates OpenSpec artifacts or reopens tasks, commit those artifact changes before applying more implementation work.
- [ ] 6.4 If review enters a real loop, run `bun run openspec:vision -- review-state implement-broker-transport-kernel-dispatch`.
- [ ] 6.5 If review cannot exit normally, run `bun run openspec:vision -- handoff implement-broker-transport-kernel-dispatch` and commit the handoff evidence.
- [ ] 6.6 Do not archive until the user accepts the human-visible daemon tray behavior.
- [ ] 6.7 Run `bun run openspec:vision -- check implement-broker-transport-kernel-dispatch` before claiming workflow completion.
