# Official Extensions

Use this reference when adding or refactoring official OpenTray extension packages such as `@opentray/ext-webview`, `@opentray/ext-badge`, or `@opentray/ext-island`.

## Package Law

Official extensions are capability atoms. Keep the package split explicit:

- TypeScript facade: `packages/ext-<name>`
- Platform package atoms: `packages/ext-<name>-<os>-<arch>`
- Native implementation crate: `crates/opentray-ext-<name>`

The facade owns typed public API only. Platform packages own distributable native artifacts only. The Rust crate owns native implementation only.

## Boundary Law

- `opentray` and `opentray-core` should only know the generic extension ABI and dispatch law.
- The extension artifact should own its own protocol semantics and runtime behavior.
- Do not add daemon-side shadow parsers or shadow runtime builders for an official extension.

For detailed extension-package implementation and binary-distribution rules, also use `$develop-opentray-ext`.

## Roadmap Atoms

- `ext-badge` and `ext-island` are still roadmap atoms.
- Do not force them into core or invent fake cross-platform capability.
- Start from capability detection and typed unsupported paths.
