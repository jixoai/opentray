# OpenTray

OpenTray is a cross-platform Desktop Status Platform for Node/Deno/Bun CLI and AI-skill ecosystems.

It is not just a tray icon wrapper. The platform model is:

- `Surface`: broker-owned desktop entry and aggregation boundary.
- `Tray`: client-owned status contribution mounted onto a surface.
- `Lease`: lifecycle contract that removes contributions when a client exits.
- `Extension`: optional native capability package attached to a surface/tray.

## Workspace

This repository uses `pnpm` workspaces and Lerna metadata.

| Directory                | npm package               | Purpose                                                  |
| ------------------------ | ------------------------- | -------------------------------------------------------- |
| `packages/cli`           | `opentray`                | Developer-facing SDK and CLI package.                    |
| `packages/spec`          | `@opentray/spec`          | TypeScript protocol and shared contract package.         |
| `packages/ext-webview`   | `@opentray/ext-webview`   | Rich popup extension backed by platform WebView engines. |
| `packages/ext-badge`     | `@opentray/ext-badge`     | Platform badge/progress/overlay API extension.           |
| `packages/ext-island`    | `@opentray/ext-island`    | Roadmap dynamic island / live activity extension.        |
| `packages/darwin-arm64`  | `@opentray/darwin-arm64`  | macOS Apple Silicon broker binary package.               |
| `packages/darwin-x64`    | `@opentray/darwin-x64`    | macOS Intel broker binary package.                       |
| `packages/windows-arm64` | `@opentray/windows-arm64` | Windows ARM64 broker binary package.                     |
| `packages/windows-x64`   | `@opentray/windows-x64`   | Windows x64 broker binary package.                       |
| `packages/linux-arm64`   | `@opentray/linux-arm64`   | Linux ARM64 broker binary package.                       |
| `packages/linux-x64`     | `@opentray/linux-x64`     | Linux x64 broker binary package.                         |

## Examples

### TrayIcon runtime boundary

Run the native example when you want to see a real system tray icon:

```bash
cargo run --example native_tray
```

Open the tray item and choose `Quit Example` to exit. For automated smoke checks, set `OPENTRAY_EXAMPLE_EXIT_AFTER_MS`:

```bash
OPENTRAY_EXAMPLE_EXIT_AFTER_MS=1500 cargo run --example native_tray
```

Run the visual WebView example when you want to see a real native window rendered through a WebView next to the tray runtime:

```bash
cargo run --example visual_webview
```

Use the tray menu `Open Panel` to focus the window, and `Quit Example` or the window close button to exit. The same auto-exit smoke mode is available:

```bash
OPENTRAY_EXAMPLE_EXIT_AFTER_MS=1500 cargo run --example visual_webview
```

The tray-icon backend also has two GUI-free examples for inspecting the runtime boundary:

```bash
cargo run --example runtime_boundary
cargo run --example default_unbound
```

These cover the two key laws:

- `native_tray` creates a visible OS tray icon through a native event loop and an injected runtime atom.
- `visual_webview` creates a visible native WebView window from an example/runtime atom without importing WebView dependencies into `opentray-core`.
- `runtime_boundary` compiles `SurfaceProjection` into a backend projection and applies it through an injected runtime.
- The default runtime stays explicitly unbound until a native main-thread/event-loop implementation is added.

### TypeScript client and extension examples

Run the protocol-only TypeScript client example when you want to inspect the SDK frames without starting a broker:

```bash
pnpm --filter opentray example:basic
```

Run the daemon-path tray example when you want to see the public TypeScript SDK create a real system tray through the local broker:

```bash
pnpm --filter opentray example:daemon-tray
```

The example auto-starts or reuses the same-version daemon before connecting. Manual lifecycle commands remain available for operator/debug cleanup:

```bash
pnpm --filter opentray cli -- daemon start
pnpm --filter opentray cli -- daemon stop
pnpm --filter opentray cli -- daemon restart
```

The daemon exits automatically after 30 seconds with no connected clients. Set `OPENTRAY_DAEMON_IDLE_TIMEOUT_MS=0` to disable idle shutdown while debugging, or set it to another millisecond value to shorten or lengthen the release window.

The current native `tray-icon` backend supports `rgba` icon assets. `encoded` and `file` icon shapes are part of the typed protocol, but they currently return unsupported in the native backend until decoder and file policy work lands.

Run the WebView extension facade example to confirm WebView is emitted as normal extension traffic:

```bash
pnpm --filter @opentray/ext-webview example:webview
```

Run the protocol parser example to inspect valid frame parsing and malformed frame rejection:

```bash
pnpm --filter @opentray/spec example:parse
```

### Verification commands

Use these commands to validate the change set end to end:

```bash
pnpm run build
pnpm run verify
bun run openspec:vision -- validate implement-kernel-webview-foundation
bun run openspec:vision -- check implement-kernel-webview-foundation
```

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

The helper reads `NPM_TOKEN` from `.env` by default and injects it through a temporary npm userconfig. npm currently rejects trusted-publisher management for tokens created with `--bypass-2fa`; if npm returns `E403`, recreate the local token with `pnpm run setup:env -- --force` or use an interactive npm login with `bun run scripts/npm/configure-trusted-publish.ts --auth ambient`.

The current npm CLI syntax uses `--file release.yml`; `--workflow` is kept only as an alias in the local helper script. Some npm 11 builds do not expose the trusted-publisher action flags yet; the helper falls back to `npx -y npm@latest` when needed.

Create a changeset before merging release-worthy changes:

```bash
pnpm run changeset
```

Release-worthy TypeScript package changes must build before publishing because `opentray`, `@opentray/spec`, and `@opentray/ext-webview` publish from `dist`. The GitHub workflow runs `pnpm run verify` and then `pnpm run build` before changesets creates a version PR or publishes through OIDC trusted publishing.

Changesets is configured to bump peer dependents only when their peer dependency range is out of range. This prevents roadmap placeholder extensions, such as `@opentray/ext-badge` and `@opentray/ext-island`, from being released just because `opentray` is released.

## Agent Skill

The repository includes an OpenTray-specific skill for future agent work:

```text
skills/opentray/
```

Use it when changing the kernel, backend atoms, extension host, official extension packages, release workflow, or human-visible examples. `SKILL.md` is only the navigation entry; extension-specific details live in separate reference articles.
