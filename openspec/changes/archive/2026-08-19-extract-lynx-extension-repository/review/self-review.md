# Self Review: Lynx Repository Extraction

## Decision

The migration is structurally complete and the core repository is ready to consume
`opentray-ext-lynx` as a git submodule. The independent repository owns the complete
Lynx release closure and has its first pushed commit.

## Evidence

| Boundary | Evidence | Result |
| --- | --- | --- |
| Independent source | `jixoai/opentray-ext-lynx` at `52dc270` | Pass |
| Core gitlink | root `opentray-ext-lynx` points to `52dc270` | Pass |
| Core graph | `Cargo.toml`, `pnpm-workspace.yaml`, native planners, package validators, and workflows contain no Lynx build atom | Pass |
| Core verification | `pnpm run verify`; `openspec validate --all --strict` | Pass |
| Core Rust lock | `Cargo.lock` removes only the Lynx package entry; `cargo test --workspace --locked` | Pass |
| Extension checks | facade build/typecheck/tests, smoke-support tests, Rust tests/release build, metadata and pack dry-runs | Pass |
| Trusted publishing | `release.yml` keeps `id-token: write`, `npm-release`, and provenance; repository is `jixoai/opentray-ext-lynx` | Pass |

## Explicit Gates

```text
core 0.15.x publish
        |
        v
independent pnpm install -> commit real lockfile -> Lynx first publish
```

The npm registry currently exposes `opentray@0.14.4` and does not expose the required
`0.15.x` artifact-resolver line. The independent repository intentionally does not commit
a copied or unverifiable lockfile; bootstrap workflows use `--no-frozen-lockfile` until the
core line exists. This is a release-order gate, not a compatibility fallback.

The full Lynx carrier build and human visual smoke were not run locally because they require
the pinned upstream checkout, Xcode carrier toolchain, native artifacts, and a real published
core graph. Static carrier tests and the real `createTray`/`attachLynx` smoke command are
present and pass their executable tests.
