# OpenTray Agent Guide

## Vision

OpenTray is a Desktop Status Platform for Node/Deno/Bun CLI and AI-skill ecosystems.

The product goal is not "show a tray icon". The goal is to give lightweight tools a system-level entry point without forcing users into Electron or a full desktop app framework.

## Platform Laws

OpenTray is tray-first (v0.9). Application code calls `createTray()` directly and owns its own foreground/background lifetime.

- `App` is the caller-owned runtime identity and isolation boundary (passed through `createTray(options, { appId, appName })`, not a separate `createApp` call).
- `Tray` is one desktop status atom owned by that app/runtime.
- `Session` is the live source of authority for tray events and mutations; closing a session removes its tray contributions.
- Extensions add native capabilities, but they must attach through tray/session contracts (e.g. `tray.extend(...)` or `attachWebview(tray)`), not by reaching into broker internals.
- Do not make one CLI directly own another CLI's menu, events, popup, or lifecycle.
- Do not add platform special cases into shared layers; expose capability contracts instead.

OpenTray no longer exposes `Space`, `Surface`, `createSpace()`, `createSurface()`, or `resolveDefaultSpace()` as public ontology. Older docs that still mention them are pre-v0.9 history.

## Monorepo Law

- `packages/cli` publishes the final public npm package: `opentray`.
- Every other direct child of `packages/*` publishes as `@opentray/<directory-name>`.
- Platform binary packages are distribution atoms only; do not place fake binaries in them.
- Extension packages are capability atoms; they must depend on public OpenTray contracts, not private package internals.
- Shared TypeScript protocol types belong in `@opentray/spec`.

## OpenSpec Workflow

Use the project-local `vision-driven` workflow before implementation:

```bash
bun run openspec:vision -- new <change>
bun run openspec:vision -- status <change>
bun run openspec:vision -- instructions research-plan <change>
bun run openspec:vision -- validate <change>
bun run openspec:vision -- check <change>
```

Keep `openspec/changes/<change>/plans/plan.md` as the current Intent Document SSOT.

Before materially changing an existing plan, run:

```bash
bun run openspec:vision -- backup-plan <change>
```

## Engineering Preferences

- Prefer durable platform-law changes over glue code.
- Keep package boundaries explicit and boring.
- Use TypeScript strict mode and avoid `any` / `as any` unless a third-party boundary makes it unavoidable.
- Keep public package APIs documented in README files before implementation details harden.
- Use BDD/task evidence for behavior changes.

## Verification

Baseline commands:

```bash
bun test scripts/openspec/vision-driven.test.ts
openspec schema validate vision-driven
pnpm -r list --depth -1
```

Before claiming completion, run the narrowest command set that proves the current change.

## Release Operations

OpenTray uses changesets plus npm Trusted Publishing.

Trusted publisher configuration:

```bash
pnpm run trusted-publish:dry-run
pnpm run trusted-publish:check
pnpm run trusted-publish:configure
```

Canonical trusted publisher claims:

- GitHub repository: `jixoai/opentray`
- Workflow file: `release.yml`
- Environment: `npm-release`
- Allowed npm actions: `npm publish`, `npm stage publish`

The npm CLI command uses `--file release.yml`, not `--workflow release.yml`.
The helper uses `.env` `NPM_TOKEN` by default and writes it only into a temporary npm userconfig. npm trust rejects bypass-2FA granular tokens; use `pnpm run setup:env -- --force` to recreate a trusted-publish-compatible token, or pass `--auth ambient` after completing browser/OTP npm login.

Release flow:

```bash
pnpm run changeset
git push
```

After merge to `main`, `.github/workflows/release.yml` creates a version PR or publishes via OIDC. Do not add long-lived `NPM_TOKEN` secrets for normal release publishing.

## Commit Discipline

- Keep OpenSpec artifacts, implementation, and archive work conceptually separable.
- In the empty-repository bootstrap case, a single initial commit may contain workflow, spec, and workspace skeleton because no usable baseline exists yet.
- Future changes should follow the normal OpenSpec phase split.
