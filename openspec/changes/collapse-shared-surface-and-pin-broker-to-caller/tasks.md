## 1. Alignment / Investigation

- [ ] 1.1 Confirm `plans/plan.md` reflects the hard-break collapse of shared surface, the rejection of the `lib-*` FFI path, and the dedicated per-caller broker carrying caller identity.
- [ ] 1.2 Confirm the survey of `createBrokerEndpointIdentity`, `resolveDaemonPaths`, and `spawnBroker` is sufficient to land per-caller endpoint identity without re-inventing the transport.
- [ ] 1.3 Confirm the alpha (`0.x`) version permits a hard break of the multi-session aggregation requirement without a deprecation window.

## 2. BDD Contract

- [ ] 2.1 Scenario: Given two host applications use the same OpenTray version When each starts its daemon Then each resolves a different runtime directory and endpoint and neither broker serves the other caller's session.
- [ ] 2.2 Scenario: Given a broker is already serving one caller session When a second caller connects to the same endpoint Then the broker rejects the second connection with a typed protocol error and the first session is unaffected.
- [ ] 2.3 Scenario: Given a host application starts a broker with caller label `myapp` When the operator inspects the process list Then the broker process name reflects `myapp` and is distinguishable from a generic `opentray` process.
- [ ] 2.4 Scenario: Given the single caller session has mounted trays When that caller disconnects Then the broker closes the session, removes its trays, and proceeds toward idle shutdown.
- [ ] 2.5 Scenario: Given a developer constructs `new Client({ label: "myapp" })` When precedence, `npm_package_name`, and script basename all differ Then the SDK uses the explicit `myapp` label.
- [ ] 2.6 Scenario: Given a derived label contains unsafe characters When the SDK sanitizes it Then the resulting component is safe for socket paths and process names and does not impersonate another application.
- [ ] 2.7 Scenario: Given the kernel previously rebuilt cross-session projections When backend synchronization runs under the new model Then the backend receives only the single session's trays and no aggregation or non-owner isolation logic runs.
- [ ] 2.8 Confirm each task checkbox will be updated only by the agent that completed and verified that task in the current working context.

## 3. Implementation

- [ ] 3.1 Run `bun run openspec:vision -- commit-check collapse-shared-surface-and-pin-broker-to-caller --phase apply` before product-code work starts and commit ready OpenSpec artifacts.
- [ ] 3.2 Extend `@opentray/spec` endpoint identity and `formatUnixSocketPath` / `formatWindowsPipeName` to carry a normalized caller-label component alongside package and protocol version.
- [ ] 3.3 Update `packages/cli/src/daemon/paths.ts` `resolveDaemonPaths` to thread the caller label through `stateRoot`, `runtimeDir`, `endpoint`, `pidFile`, `lockFile`, and `readyFile`.
- [ ] 3.4 Implement SDK caller-label precedence and sanitization in the client construction path (`packages/cli/src` SDK layer), with explicit > `npm_package_name` > script basename > neutral default.
- [ ] 3.5 Update `packages/cli/src/daemon/lifecycle.ts` `spawnBroker` to inject the caller label into the broker environment/arguments and to set the caller-derived process name via the per-platform primary mechanism (argv0 on Linux; renamed/copied executable image on macOS/Windows).
- [ ] 3.6 Collapse `crates/opentray-core` ownership from `(session, spaceId, trayId)` multi-session aggregation to a single caller session; remove the projection-rebuild and non-owner isolation code paths.
- [ ] 3.7 Update `crates/opentray-bin` to accept exactly one caller session, reject a second connection with a typed protocol error, and scope the idle timeout to the single caller session.
- [ ] 3.8 Surface `callerLabel` in the `daemon-health` response and keep `sessionCount` at most 1.
- [ ] 3.9 Add concise intent comments at the caller-label injection boundary, the single-session acceptance boundary, and the removed aggregation boundary.
- [ ] 3.10 Update package docs, examples, and READMEs so per-caller isolation, the caller-label option, and the removal of shared surface are visible and honest.

## 4. Verification

- [ ] 4.1 Run targeted `@opentray/spec` tests covering the caller-scoped endpoint identity and sanitization.
- [ ] 4.2 Run the CLI daemon lifecycle tests for per-caller runtime directories, endpoints, and single-session rejection.
- [ ] 4.3 Run a cross-process evidence check that two concurrent callers of the same version get distinct brokers and that killing one does not affect the other.
- [ ] 4.4 Run a process-name evidence check on at least Linux (argv0) confirming the broker is listed under a caller-derived name.
- [ ] 4.5 Run `bun run openspec:vision -- validate collapse-shared-surface-and-pin-broker-to-caller`.
- [ ] 4.6 Run `bun run openspec:vision -- commit-check collapse-shared-surface-and-pin-broker-to-caller --phase self-review` before writing final review evidence.

## 5. Self-Review Loop

- [ ] 5.1 Generate `review/self-review.md` as the macro review record comparing implementation against `plans/plan.md`, including the shared-surface removal and the caller-identity pinning.
- [ ] 5.2 Generate `review/self-review.html` as the screenshot / interaction / structured evidence presentation for the task-manager process name and dual-caller isolation.
- [ ] 5.3 If the review updates OpenSpec artifacts or reopens tasks, commit those artifact changes before the next apply loop.
- [ ] 5.4 If the review enters a real loop, persist iteration state with the OpenSpec workflow command before continuing.
- [ ] 5.5 If review cannot exit normally, run `bun run openspec:vision -- handoff collapse-shared-surface-and-pin-broker-to-caller` and commit the handoff evidence before returning to user discussion.
