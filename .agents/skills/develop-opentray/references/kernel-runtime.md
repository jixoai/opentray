# Kernel Runtime

Use this reference when changing `crates/opentray-core`, `crates/opentray-spec`, `packages/spec`, or `packages/cli`.

## Platform Laws

OpenTray is tray-first:

- `App` is the caller-owned runtime identity and isolation boundary (`AppId`). It is supplied through `createTray(options, { appId, appName })`, not a separate `createApp` call.
- `Tray` is one client-owned status atom owned by an app (`TrayId`). `TrayOptions` is `{ id, tooltip?, icon?, menu? }` — there is no top-level `title`; visible text is part of icon projection.
- `Session` is the public lifecycle boundary (`SessionId`). Closing a session removes its trays.
- An app projection is the only shape sent to a backend adapter. Client declarations stay separate from physical state.
- Kernel event routing uses `(session authority, appId, trayId, itemId)` authority, not menu item id alone.

Public SDK handles expose `getBounds / setMenu / setTooltip / setIcon / loadExtension / commandExtension / requestExtension / extend / destroy`. There is no `setTitle`. `Space` / `Surface` / `Lease` are vocabulary from an earlier surface model; some internal ABI names may still carry `surface` as a compatibility detail, but they are not public ontology.

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
