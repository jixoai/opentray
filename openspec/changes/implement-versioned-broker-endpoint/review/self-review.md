# Self Review: implement-versioned-broker-endpoint

## Intent Match

The change implements the user's version-isolation correction as a platform law, not a local string patch:

- Package/binary version and protocol version are separate identity axes.
- Current-stage broker endpoint identity includes both axes.
- Handshake metadata now uses `protocolVersion` instead of ambiguous `version`.
- Ready/init frames carry package/binary version separately as `brokerVersion` and `clientVersion`.
- `opentray-core` remains free of OS pipe/socket naming and package-specific logic.

## Evidence

- Rust protocol tests prove endpoint names include package and protocol versions.
- Rust protocol tests prove path-like package versions are rejected.
- Rust protocol tests prove handshake frames serialize explicit `protocolVersion`, `clientVersion`, and `brokerVersion`.
- TypeScript tests prove endpoint helpers format Unix state roots, Unix socket paths, and Windows named pipes.
- TypeScript parser tests reject stale ready frames that only contain ambiguous `version`.
- `opentray-bin` now prints a ready frame with `protocolVersion` and `brokerVersion`.
- `basic-surface` example now emits an explicit init handshake frame before surface/tray operations.

## Verification Run

- `cargo fmt --all -- --check`: passed
- `cargo test`: passed
- `pnpm --filter @opentray/spec typecheck`: passed
- `pnpm --filter opentray typecheck`: passed
- `pnpm --filter @opentray/spec test`: passed
- `pnpm --filter opentray test`: passed
- `pnpm --filter @opentray/ext-webview test`: passed
- `pnpm --filter @opentray/spec example:parse`: passed
- `pnpm --filter opentray example:basic`: passed
- `cargo run -p opentray-bin`: passed
- `pnpm run build`: passed
- `pnpm run verify`: passed
- `bun run openspec:vision -- validate implement-versioned-broker-endpoint`: passed
- `git diff --check`: passed
- `pnpm exec changeset status --verbose`: passed and reports minor bumps for `@opentray/spec` and `opentray`.

## Residual Risk

The real daemon transport is not implemented in this change. That is intentional: this batch establishes the endpoint identity and handshake law first. The next broker work must consume these helpers rather than inventing new socket or pipe strings.

## Verdict

Ready to commit the implementation batch. Do not archive until the user accepts this stage or the broker daemon change is completed under the same OpenSpec branch.
