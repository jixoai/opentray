# Self Review

## Verdict

The apply implementation satisfies the current change intent for the macOS daemon path: a TypeScript client auto-starts or reuses the same-version daemon, connects to the versioned daemon endpoint, completes a protocol-version handshake, receives broker-created surface/tray identities, dispatches frames through Rust `BrokerKernel` into `opentray-core::Kernel`, applies projections through `opentray-bin` backend composition, and runs the daemon tray example through the real endpoint.

Do not archive yet. The remaining acceptance gate is user-visible manual confirmation: run the daemon tray example without auto-exit, confirm no Dock-visible windowless daemon app appears on macOS, confirm the tray icon is nonblank, click a menu item, and observe the routed event output.

## Plan / Spec Trace

| Intent / spec point | Implementation evidence | Verdict |
| ------------------- | ----------------------- | ------- |
| Init before lease | `BrokerKernel::handle_frame` rejects non-init commands before accepted init and returns `not-initialized`. | Pass |
| Protocol version handshake | `Ready` now includes `protocolVersion`, `brokerVersion`, and `leaseId`; incompatible init has no lease side effect. | Pass |
| Request-correlated responses | Rust/TS protocol models include `requestId` on command responses and structured errors; TS client promises resolve by matching request id. | Pass |
| Kernel dispatch | `BrokerKernel` maps create/mutate/destroy/ext frames to `Kernel` methods and preserves lease authority. | Pass |
| Lease cleanup | Transport disconnect / exit calls `close_session`, which delegates cleanup to kernel lease cleanup. | Pass |
| Backend projection path | `opentray-bin` composes `TrayIconBackend<NativeTrayIconRuntime>` on macOS and applies kernel projections through the backend. | Pass |
| macOS daemon activation | `opentray-bin` builds its winit event loop with `ActivationPolicy::Accessory`, disables the default menu, and avoids app activation. | Pass by code; human Dock check pending. |
| Native event routing | macOS broker receives `tray-icon` menu events, maps route ids through backend, routes via kernel, and emits only to the owning session. | Pass by code + unit route test; manual click still pending. |
| Root package boundary | Node-only local broker client moved to `opentray/node`; root `opentray` remains safe for extension type consumers. | Pass |
| Local broker auto-start | `connectLocalBroker()` starts or reuses the same-version daemon for the derived endpoint before opening the socket; explicit endpoint + `autoStart: false` does not start the derived daemon. | Pass by TS socket test and auto smoke. |
| Human example | `pnpm --filter opentray example:daemon-tray` creates surface/tray through daemon endpoint, prints identities/events, uses a visible 32x32 RGBA icon, and shows item/check/radio/submenu/separator menu atoms. | Pass by auto smoke; manual visual check pending. |

## Verification Evidence

- `cargo test` passed.
- `pnpm run build` passed.
- `pnpm run test` passed.
- `pnpm run typecheck` passed.
- `pnpm run verify` passed.
- `bun run openspec:vision -- validate implement-broker-transport-kernel-dispatch` passed.
- `git diff --check` passed.
- `cargo test -p opentray-bin -p opentray-backend-tray-icon` passed.
- `pnpm --filter opentray test` passed, including local broker auto-start and explicit endpoint opt-out tests.
- `OPENTRAY_EXAMPLE_EXIT_AFTER_MS=1500 pnpm --filter opentray example:daemon-tray` passed after first stopping the current daemon; it auto-started the broker, printed lease `lease-1`, broker-created `surface-1`, and `daemon-status`; then daemon stop succeeded.

## Residual Risks

- Windows named-pipe broker transport is still not implemented. This is consistent with the plan default: do not let Windows parity block first macOS visual daemon proof.
- Linux `ksni` backend remains a stub-level atom for this flow; it compiles and preserves backend boundaries but is not a visual acceptance path in this change.
- Automated smoke cannot click the native tray menu. Human validation must run the example without auto-exit and click the tray menu.
- Source-mode `opentray daemon start` builds `opentray-bin` before spawning it. Packaged binary resolution through platform packages remains a follow-up release-packaging task.

## Human Acceptance

Run:

```bash
pnpm --filter opentray example:daemon-tray
```

Expected:

- The example starts or reuses the same-version daemon automatically.
- On macOS, no windowless daemon application appears in the Dock.
- Output includes `surface: {"surfaceId":"surface-1","appId":"com.example.opentray.daemon"}`.
- Output includes `tray: daemon-status`.
- A real system tray item appears with a nonblank icon.
- The menu contains enabled item, disabled item, check, radio, submenu, separator, and quit entries.
- Selecting an enabled menu item prints a `broker -> client {"type":"event",...}` frame and a `menu click: ...` line.
- Selecting `Quit Example` closes the example.

Then stop the daemon:

```bash
pnpm --filter opentray cli -- daemon stop
```
