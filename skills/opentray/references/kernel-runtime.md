# Kernel Runtime

Use this reference when changing `crates/opentray-core`, `crates/opentray-spec`, `packages/spec`, or `packages/cli`.

## Platform Laws

- `Surface` is the broker-owned physical desktop entry and aggregation boundary.
- `Tray` is a client-owned contribution mounted onto exactly one surface.
- `Lease` is the authority boundary. Lease cleanup removes only trays owned by that lease.
- A surface projection is the only shape sent to a backend adapter. Client declarations stay separate from physical state.
- Kernel event routing uses `(leaseId, surfaceId, trayId, itemId)` authority, not menu item id alone.

## Forbidden Couplings

- Core must not import concrete backend crates, WebView code, window/event-loop packages, or npm package names.
- Core must not branch on feature names such as `webview`.
- Core tests should use `FakeBackend` or extension test doubles, not native GUI event loops.

## Current Code Map

- Rust domain/protocol types: `crates/opentray-spec/src`.
- Kernel laws: `crates/opentray-core/src/kernel.rs`.
- Backend contract and fake backend: `crates/opentray-core/src/backend.rs`.
- Extension registry: `crates/opentray-core/src/extension.rs`.
- TypeScript protocol mirror: `packages/spec/src/index.ts`.
- TypeScript client handles: `packages/cli/src/index.ts`.

## Verification

Run kernel/API changes through:

```bash
cargo test
pnpm --filter @opentray/spec test
pnpm --filter opentray test
pnpm run verify
```
