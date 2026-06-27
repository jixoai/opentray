# Extension Host

Use this reference when changing extension dispatch, native extension loading, or extension discovery laws.

## Host Law

The extension host is a kernel law. Extensions attach to a tray (and its owning app/session), receive commands through `ExtensionEnvelope`, and emit events through the same scoped envelope shape. Public SDK attachment is `tray.extend(...)` or `attachWebview(tray)`; there is no `space` to attach to.

## Current State

- `ExtensionRegistry` stores instances by `(appId, trayId, extName)` semantics. Dynamic ABI names may still carry `surface` as a compatibility detail, but it is not public ontology.
- `Kernel::ext_command` validates the target tray and dispatches through the registry.
- `RecordingExtension` is the current test double for dispatch and session cleanup.
- Dynamic library ABI is implemented in `crates/opentray-bin/src/dynamic_extension.rs`.
- `opentray-bin` owns only generic discovery, loading, and scoped dispatch. Official extension protocol parsing and native runtime behavior belong inside the extension artifact.

## Stable ABI Direction

Dynamic extension libraries must use C-compatible exported functions and C-compatible structures. Rust-specific types must not cross the dynamic library boundary. JSON command payloads may cross the ABI to keep the binary surface stable while higher-level schemas evolve.

Official extensions should be able to own their native runtime internally through this ABI. Do not reintroduce daemon-side shadow parsers or product-specific runtime builders just because a dynamic library exists.

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
- No implicit cross-app or cross-session access.
