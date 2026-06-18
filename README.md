# OpenTray

OpenTray is a cross-platform Desktop Status Platform for Node/Deno/Bun CLI and AI-skill ecosystems.

It is not just a tray icon wrapper. The platform model is:

- `Space`: broker-owned desktop aggregation boundary.
- `Tray`: client-owned status contribution mounted onto a space.
- `Session`: lifecycle contract that removes contributions when a client exits.
- `Extension`: optional native capability package attached to a space/tray.

## Workspace

This repository uses `pnpm` workspaces and Lerna metadata.

| Directory                | npm package               | Purpose                                                  |
| ------------------------ | ------------------------- | -------------------------------------------------------- |
| `packages/cli`           | `opentray`                | Developer-facing SDK and CLI package.                    |
| `packages/spec`          | `@opentray/spec`          | TypeScript protocol and shared contract package.         |
| `packages/ext-lynx`      | `@opentray/ext-lynx`      | Lynx window extension backed by the OpenTray Lynx host.  |
| `packages/ext-lynx-*`    | `@opentray/ext-lynx-*`    | macOS Lynx dynamic library and runtime sidecar packages. |
| `packages/ext-webview`   | `@opentray/ext-webview`   | Rich popup extension backed by platform WebView engines. |
| `packages/ext-webview-*` | `@opentray/ext-webview-*` | Platform WebView dynamic library packages.               |
| `packages/ext-badge`     | `@opentray/ext-badge`     | Platform badge/progress/overlay API extension.           |
| `packages/ext-island`    | `@opentray/ext-island`    | Roadmap dynamic island / live activity extension.        |
| `packages/darwin-arm64`  | `@opentray/darwin-arm64`  | macOS Apple Silicon broker binary package.               |
| `packages/darwin-x64`    | `@opentray/darwin-x64`    | macOS Intel broker binary package.                       |
| `packages/windows-arm64` | `@opentray/windows-arm64` | Windows ARM64 broker binary package.                     |
| `packages/windows-x64`   | `@opentray/windows-x64`   | Windows x64 broker binary package.                       |
| `packages/linux-arm64`   | `@opentray/linux-arm64`   | Linux ARM64 broker binary package.                       |
| `packages/linux-x64`     | `@opentray/linux-x64`     | Linux x64 broker binary package.                         |

## Current Platform Truth

OpenTray now has two official native extension families with different maturity levels:

- macOS and Windows are stable human-visual WebView acceptance paths for daemon transport, tray menu, dynamic WebView loading, common bridge/window controls, native material projection, postMessage, and evaluate.
- Linux core daemon packages remain supported, but `@opentray/ext-webview` does not publish Linux native WebView packages and must fail honestly instead of faking a visible runtime.
- Lynx is intentionally macOS-first. Linux and Windows Lynx packages are not published yet, and the platform must fail honestly rather than pretending the runtime exists.
- The published `opentray` CLI is a daemon lifecycle tool. Visual smoke orchestration belongs in `skills/opentray` and source-tree examples, not in the public CLI command surface.

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
- `runtime_boundary` compiles the space projection into a backend projection and applies it through an injected runtime.
- The default runtime stays explicitly unbound until a native main-thread/event-loop implementation is added.

### TypeScript client and extension examples

Run the protocol-only TypeScript client example when you want to inspect the SDK frames without starting a broker:

```bash
pnpm --filter opentray example:basic
```

The published `opentray` package also exposes the same broker-backed entrypoints directly:

```ts
import { createSpace, createTray } from "opentray";

const space = await createSpace({ id: "com.example.status", default: true });
await space.createTray({
  trayId: "status",
  title: "Status",
  icon: { type: "rgba", data: [0, 0, 0, 0], width: 1, height: 1 },
});

await createTray({
  trayId: "secondary",
  title: "Secondary",
  icon: { type: "rgba", data: [0, 0, 0, 0], width: 1, height: 1 },
});
```

Run the daemon-path tray example when you want to see the public TypeScript SDK create a real system tray through the local broker:

```bash
pnpm --filter opentray example:daemon-tray
```

After installing published packages from npm, the public CLI remains focused on daemon lifecycle and health:

```bash
opentray daemon health
opentray daemon start
opentray daemon stop
opentray daemon restart
```

For real visual acceptance, install the OpenTray agent skill and let it run a smoke recipe, or use the workspace examples below from a source checkout. Smoke recipes create real tray/window UI and should not be hidden behind a supposedly pure package CLI command.

The daemon tray example declares one primary `Open WebView` item. On platforms with a primary tray gesture, that item can open the WebView directly while still routing through the normal `menuClick` event. The page exposes the extension-owned bridge through `navigator.window` / `navigator.opentrayWindow`, and the demo opts into `window.close()` / `window.moveTo()` / `window.resizeTo()` overrides so the in-page buttons can visually validate move, resize, close, style, and tray-bounds behavior.

The Lynx example path uses the same generic extension loader without importing a Lynx parser into `opentray-core`. It creates a tray, loads `@opentray/ext-lynx`, immediately launches the requested `.lynx.bundle`, enables selected window features, and exposes `Show Window`, `Hide Window`, and `Quit Smoke` through broker-routed tray events. The Lynx page itself contains visual buttons for `getCapabilities`, `getStyle`, `resizeTo`, `moveTo`, frameless toggling, `window.resizeTo()`, and close verification.

For local workspace smoke before publishing, stage current native artifacts and then run the source examples:

```bash
cargo build -p opentray-bin -p opentray-ext-webview -p opentray-ext-lynx
bun run scripts/binaries/stage-local.ts --kind daemon --source target/debug/opentray
bun run scripts/binaries/stage-local.ts --kind webview --source target/debug/libopentray_ext_webview.dylib
bun run scripts/binaries/stage-local.ts --kind lynx --source target/debug/libopentray_ext_lynx.dylib
bash scripts/release/build-lynx-runtime.sh /tmp/OpenTrayLynxRuntime.app.zip
bun run scripts/binaries/stage-local.ts --kind lynx-runtime --source /tmp/OpenTrayLynxRuntime.app.zip
pnpm --filter opentray cli -- daemon stop
OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1 pnpm --filter opentray example:daemon-tray
OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1 pnpm --filter opentray example:placement
OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1 pnpm --filter opentray example:mediaQuery
pnpm --filter opentray example:daemon-lynx -- --bundle packages/cli/assets/lynx-review/main.lynx.bundle
```

`OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1` triggers the primary WebView show path without menu clicks. `OPENTRAY_EXT_PATH` can point at an explicit extension directory for loader debugging, but the release path is package-adjacent discovery from the requested facade package, such as `@opentray/ext-webview` resolving to `@opentray/ext-webview-<os>-<arch>`.

`example:placement` is the focused `WebviewPlacementKit` review path for tray, screen, and edge-aware placement. `example:mediaQuery` is the focused responsive-window review path for `mediaQueryKit` plus `styleKit`. Keep them separate when debugging placement versus native sizing/style behavior.

The Lynx release path is similar, except the darwin platform package also carries `runtime/OpenTrayLynxRuntime.app.zip`. The extension dylib resolves that sidecar next to itself by default, and `OPENTRAY_LYNX_RUNTIME_ZIP=/absolute/path/to/OpenTrayLynxRuntime.app.zip` is available as a debugging override.

To verify the runtime split on macOS after a release build, inspect both size and linkage:

```bash
cargo build -p opentray-bin -p opentray-ext-webview -p opentray-ext-lynx --release
wc -c target/release/opentray target/release/libopentray_ext_webview.dylib target/release/libopentray_ext_lynx.dylib
otool -L target/release/opentray
otool -L target/release/libopentray_ext_webview.dylib
otool -L target/release/libopentray_ext_lynx.dylib
```

`opentray` should no longer link `WebKit.framework`, while `libopentray_ext_webview.dylib` should.

The standalone WebView visual smoke remains available:

```bash
cargo run --example visual_webview
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

Use these commands to validate the current workspace state:

```bash
pnpm run build
pnpm run verify
bun run openspec:vision -- validate <change>
bun run openspec:vision -- check <change>
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

Release-worthy TypeScript package changes must build before publishing because `opentray`, `@opentray/spec`, `@opentray/ext-webview`, and `@opentray/ext-lynx` publish from `dist`. The GitHub workflow runs `pnpm run verify` and then `pnpm run build` before it versions packages in-run and publishes through OIDC trusted publishing.

After a release lands, prove the published npm packages in a clean temp directory:

```bash
tmpdir=$(mktemp -d /tmp/opentray-npm-XXXXXX)
cd "$tmpdir"
npm init -y
pnpm add opentray @opentray/ext-webview
pnpm exec opentray daemon health
npx skills add jixiao/opentray --skill opentray
```

Use the installed `opentray` skill to run a real visual acceptance recipe against the fresh project. That recipe should check the package-owned daemon binary, same-version daemon auto-start/reuse, and the published WebView extension package instead of any workspace-local build output.

For published Lynx verification, use the installed `opentray` skill or a source checkout with the workspace review bundle:

```bash
pnpm add opentray @opentray/ext-lynx
```

If you want to inspect another bundle, point the skill/workspace recipe at that bundle instead of `packages/cli/assets/lynx-review/main.lynx.bundle`.

For GitHub-hosted native preflight before publish:

```bash
gh workflow run verify-native-artifacts.yml --ref <branch>
```

Changesets is configured to bump peer dependents only when their peer dependency range is out of range. This prevents roadmap placeholder extensions, such as `@opentray/ext-badge` and `@opentray/ext-island`, from being released just because `opentray` is released.

## Agent Skill

Install the consumer-facing OpenTray skill into an agent's local skill registry:

```bash
npx skills add jixiao/opentray --skill opentray
```

The source for that package-user skill lives in:

```text
skills/opentray/
```

Use it when consuming OpenTray as a package: install the SDK, create spaces and trays, load official extensions, run visual acceptance recipes, and troubleshoot daemon/runtime behavior. Repo-contributor skills live under `.agents/skills/`; use those when changing the kernel, backend atoms, extension host, official extension packages, release workflow, or human-visible examples.
