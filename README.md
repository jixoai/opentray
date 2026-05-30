# OpenTray

OpenTray is a cross-platform Desktop Status Platform for Node/Deno/Bun CLI and AI-skill ecosystems.

It is not just a tray icon wrapper. The platform model is:

- `Surface`: broker-owned desktop entry and aggregation boundary.
- `Tray`: client-owned status contribution mounted onto a surface.
- `Lease`: lifecycle contract that removes contributions when a client exits.
- `Extension`: optional native capability package attached to a surface/tray.

## Workspace

This repository uses `pnpm` workspaces and Lerna metadata.

| Directory | npm package | Purpose |
| --- | --- | --- |
| `packages/cli` | `opentray` | Developer-facing SDK and CLI package. |
| `packages/spec` | `@opentray/spec` | TypeScript protocol and shared contract package. |
| `packages/ext-webview` | `@opentray/ext-webview` | Rich popup extension backed by platform WebView engines. |
| `packages/ext-badge` | `@opentray/ext-badge` | Platform badge/progress/overlay API extension. |
| `packages/ext-island` | `@opentray/ext-island` | Roadmap dynamic island / live activity extension. |
| `packages/darwin-arm64` | `@opentray/darwin-arm64` | macOS Apple Silicon broker binary package. |
| `packages/darwin-x64` | `@opentray/darwin-x64` | macOS Intel broker binary package. |
| `packages/windows-arm64` | `@opentray/windows-arm64` | Windows ARM64 broker binary package. |
| `packages/windows-x64` | `@opentray/windows-x64` | Windows x64 broker binary package. |
| `packages/linux-arm64` | `@opentray/linux-arm64` | Linux ARM64 broker binary package. |
| `packages/linux-x64` | `@opentray/linux-x64` | Linux x64 broker binary package. |

## Workflow

Use the project-local vision-driven OpenSpec workflow before implementation:

```bash
bun run openspec:vision -- new <change>
bun run openspec:vision -- status <change>
bun run openspec:vision -- validate <change>
```

Run baseline checks:

```bash
pnpm run verify
```

## Release

OpenTray publishes through npm Trusted Publishing from GitHub Actions. The trusted publisher claims are:

- Publisher: GitHub Actions
- Repository: `jixoai/opentray`
- Workflow file: `release.yml`
- Environment: `npm-release`
- Allowed actions: `npm publish` and `npm stage publish`

Configure or inspect npm trusted publishing:

```bash
pnpm run trusted-publish:dry-run
pnpm run trusted-publish:check
pnpm run trusted-publish:configure
```

The current npm CLI syntax uses `--file release.yml`; `--workflow` is kept only as an alias in the local helper script.

Create a changeset before merging release-worthy changes:

```bash
pnpm run changeset
```

When changes land on `main`, `.github/workflows/release.yml` uses changesets to create a version PR or publish changed packages through OIDC trusted publishing.
