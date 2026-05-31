# Extension Host

Use this reference when changing extension dispatch, native extension loading, or extension discovery laws.

## Host Law

The extension host is a kernel law. Extensions attach to a surface and optionally a tray, receive commands through `ExtensionEnvelope`, and emit events through the same scoped envelope shape.

## Current State

- `ExtensionRegistry` stores instances by `(surfaceId, extName)`.
- `Kernel::ext_command` validates the target tray and dispatches through the registry.
- `RecordingExtension` is the current test double for dispatch and lease cleanup.
- Dynamic library ABI is specified but not yet implemented as a native loader.

## Stable ABI Direction

Dynamic extension libraries must use C-compatible exported functions and C-compatible structures. Rust-specific types must not cross the dynamic library boundary. JSON command payloads may cross the ABI to keep the binary surface stable while higher-level schemas evolve.

## Discovery Direction

Future discovery should be explicit and auditable:

- package-adjacent platform artifacts,
- user config directories,
- `OPENTRAY_EXT_PATH`.

Do not silently load arbitrary libraries outside configured locations.

## Anti-Pattern Checklist

- No core special cases for official extensions.
- No extension direct mutation of kernel registries.
- No backend-specific extension imports in `opentray-core`.
- No implicit cross-surface or cross-lease access.
