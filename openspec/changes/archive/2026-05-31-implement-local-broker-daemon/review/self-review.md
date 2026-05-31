# Self Review: implement-local-broker-daemon

## Intent Match

The change implements the explicit local broker daemon lifecycle requested for the next OpenTray stage:

- `opentray` now publishes a CLI bin entry.
- Canonical command spelling is `opentray daemon start|stop|restart`.
- `deamon` is not implemented after the user confirmed it was a typo.
- Runtime state is version-scoped under `~/.opentray/<packageVersion>/runtime/`.
- Daemon endpoint identity reuses the archived package-version plus protocol-version helpers.
- Start is idempotent for a healthy same-version daemon.
- Stop and restart operate only inside the current version runtime path.
- Process supervision and local IPC remain outside `opentray-core`.

## Implementation Evidence

- `packages/cli/src/cli.ts` owns the CLI command parser and lifecycle dispatch.
- `packages/cli/src/daemon/paths.ts` derives version-scoped runtime paths and endpoints.
- `packages/cli/src/daemon/lifecycle.ts` owns pid/lock lifecycle, stale runtime cleanup, start/stop/restart, and child process spawning.
- `packages/cli/src/daemon/broker-runner.ts` provides the minimal hidden broker process that binds the endpoint and writes ready metadata.
- `packages/cli/src/daemon/*.test.ts` covers path identity, idempotent starts, scoped stops, concurrent starts, and restarts.
- `packages/cli/package.json` exposes `bin.opentray` and builds `src/cli.ts` into `dist/cli.mjs`.

## Verification Run

- `pnpm --filter opentray typecheck`: passed
- `pnpm --filter opentray test`: passed
- `pnpm --filter opentray build`: passed
- `cargo test`: passed
- `pnpm run build`: passed
- `pnpm run verify`: passed
- `bun run openspec:vision -- validate implement-local-broker-daemon`: passed
- `git diff --check`: passed
- `pnpm exec changeset status --verbose`: passed and reports `opentray` as a minor bump.
- Built CLI smoke:
  - `node packages/cli/dist/cli.mjs daemon start`: started a daemon under temporary `OPENTRAY_HOME`.
  - second `daemon start`: reported `already-running`.
  - `daemon restart`: started through restart path.
  - `daemon stop`: stopped and cleaned runtime pid/ready/socket files.

## Residual Risk

The hidden broker process is intentionally minimal: it binds the endpoint and emits ready metadata, but it does not yet route full client protocol frames into the Rust kernel. This keeps the lifecycle law small and testable. The next change should wire the endpoint server to kernel lease creation and protocol frame dispatch.

## Verdict

Ready for user review. Do not archive until the user accepts the daemon lifecycle behavior and command shape.
