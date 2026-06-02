# Backend Adapters

Use this reference when changing `SurfaceBackend`, `opentray-backend-tray-icon`, `opentray-backend-ksni`, `opentray-bin`, or native tray examples.

## Adapter Law

Backends are physical atoms behind the backend contract. They receive already-derived space projection values and report capabilities or typed unsupported errors. They do not own session policy, extension dispatch, or package selection.

## Current Backend Split

- macOS and Windows use `opentray-backend-tray-icon` over `tauri-apps/tray-icon`.
- Linux uses `opentray-backend-ksni` by default to avoid forcing GTK/libappindicator through `tray-icon`.
- `opentray-bin` owns target-based backend composition. Core remains backend-neutral.

## tray-icon Runtime Boundary

- `TrayIconProjection` compiles a core space projection into tray-icon-ready assets, menu entries, and route tables.
- `TrayIconRuntime` applies compiled projections. This keeps GUI handles out of the backend contract.
- `NativeTrayIconRuntime` owns native tray handles but does not create or run the OS event loop. The caller owns the event loop.
- `UnboundTrayIconRuntime` is intentionally unsupported; it proves the default backend cannot silently create native GUI state.

## Capability Rules

- If rect is unavailable, return `Ok(None)` or an unsupported error instead of inventing a fake rect.
- If menu display is unavailable, expose capability absence and let WebView or callers choose a fallback.
- Menu ids must preserve route context with stable ids such as `opentray:<space>:<tray>:<item>`.

## Verification

```bash
cargo test -p opentray-backend-tray-icon
cargo test -p opentray-backend-ksni
cargo test -p opentray-bin
```
