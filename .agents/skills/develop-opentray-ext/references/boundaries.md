# Extension Boundaries

Use this reference when deciding what belongs in `opentray`, what belongs in the extension facade, and what belongs in the native extension artifact.

## Three-Atom Split

For an official native extension, keep three atoms distinct:

1. `packages/ext-<name>`: TypeScript facade and typed public API.
2. `packages/ext-<name>-<os>-<arch>`: distribution atoms containing only native artifacts plus package metadata.
3. `crates/opentray-ext-<name>`: native implementation crate that compiles to `cdylib`.

## Ownership Rules

- `opentray-core` owns only generic extension dispatch law.
- `crates/opentray-bin` owns only generic discovery/loading and broker composition.
- The extension crate owns:
  - request parsing,
  - returned event shape,
  - default HTML/assets if needed,
  - native window/runtime lifecycle,
  - platform-native dependencies.

## Anti-Patterns

- No `if ext == "<name>"` in core.
- No daemon-side shadow parser for the extension protocol.
- No daemon-side shadow runtime that makes the extension package look thinner than it really is.
- No facade package that imports platform native packages from public API code.

## Scope Rules

Keep extension state scoped to `(surfaceId, trayId, leaseId)` semantics. Lease cleanup should destroy or hide only the owning lease's state.
