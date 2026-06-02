# Kernel Runtime

Use this reference when changing `crates/opentray-core`, `crates/opentray-spec`, `packages/spec`, or `packages/cli`.

## Platform Laws

- `Space` is the public broker-owned desktop aggregation boundary.
- `Tray` is a client-owned contribution mounted onto exactly one space.
- `Session` is the public lifecycle boundary. Internal lease names may remain only as compatibility/ABI details.
- A space projection is the only shape sent to a backend adapter. Client declarations stay separate from physical state.
- Kernel event routing uses `(session authority, spaceId, trayId, itemId)` authority, not menu item id alone.

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
