# Self Review

## Verdict

The apply implementation satisfies the current change intent for the macOS daemon path: a TypeScript client connects to the versioned daemon endpoint, completes a protocol-version handshake, receives broker-created surface/tray identities, dispatches frames through Rust `BrokerKernel` into `opentray-core::Kernel`, applies projections through `opentray-bin` backend composition, and runs the daemon tray example through the real endpoint.

Do not archive yet. The remaining acceptance gate is user-visible manual confirmation: run the daemon tray example without auto-exit, confirm a real tray item appears, click a menu item, and observe the routed event output.

## Plan / Spec Trace

| Intent / spec point | Implementation evidence | Verdict |
| ------------------- | ----------------------- | ------- |
| Init before lease | `BrokerKernel::handle_frame` rejects non-init commands before accepted init and returns `not-initialized`. | Pass |
| Protocol version handshake | `Ready` now includes `protocolVersion`, `brokerVersion`, and `leaseId`; incompatible init has no lease side effect. | Pass |
| Request-correlated responses | Rust/TS protocol models include `requestId` on command responses and structured errors; TS client promises resolve by matching request id. | Pass |
| Kernel dispatch | `BrokerKernel` maps create/mutate/destroy/ext frames to `Kernel` methods and preserves lease authority. | Pass |
| Lease cleanup | Transport disconnect / exit calls `close_session`, which delegates cleanup to kernel lease cleanup. | Pass |
| Backend projection path | `opentray-bin` composes `TrayIconBackend<NativeTrayIconRuntime>` on macOS and applies kernel projections through the backend. | Pass |
| Native event routing | macOS broker receives `tray-icon` menu events, maps route ids through backend, routes via kernel, and emits only to the owning session. | Pass by code + unit route test; manual click still pending. |
| Root package boundary | Node-only local broker client moved to `opentray/node`; root `opentray` remains safe for extension type consumers. | Pass |
| Human example | `pnpm --filter opentray example:daemon-tray` creates surface/tray through daemon endpoint and prints identities/events. | Pass by auto smoke; manual visual check pending. |

## Verification Evidence

- `cargo test` passed.
- `pnpm run build` passed.
- `pnpm run test` passed.
- `pnpm run typecheck` passed.
- `pnpm run verify` passed.
- `bun run openspec:vision -- validate implement-broker-transport-kernel-dispatch` passed.
- `git diff --check` passed.
- `OPENTRAY_EXAMPLE_EXIT_AFTER_MS=1500 pnpm --filter opentray example:daemon-tray` passed after `pnpm --filter opentray cli -- daemon start`; it printed broker-created `surface-1` and `daemon-status`, then daemon stop succeeded.

## Residual Risks

- Windows named-pipe broker transport is still not implemented. This is consistent with the plan default: do not let Windows parity block first macOS visual daemon proof.
- Linux `ksni` backend remains a stub-level atom for this flow; it compiles and preserves backend boundaries but is not a visual acceptance path in this change.
- Automated smoke cannot click the native tray menu. Human validation must run the example without auto-exit and click the tray menu.
- Source-mode `opentray daemon start` builds `opentray-bin` before spawning it. Packaged binary resolution through platform packages remains a follow-up release-packaging task.

## Human Acceptance

Run:

```bash
pnpm --filter opentray cli -- daemon start
pnpm --filter opentray example:daemon-tray
```

Expected:

- Output includes `surface: {"surfaceId":"surface-1","appId":"com.example.opentray.daemon"}`.
- Output includes `tray: daemon-status`.
- A real system tray item appears.
- Selecting `Daemon Tray Event` prints a `broker -> client {"type":"event",...}` frame.
- Selecting `Quit Example` closes the example.

Then stop the daemon:

```bash
pnpm --filter opentray cli -- daemon stop
```
