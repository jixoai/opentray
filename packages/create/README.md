<p align="center"><img src="./assets/create-opentray-logo.png" alt="create-opentray logo" width="180"></p>

# create-opentray

Turn any start command that serves HTTP locally into an OpenTray-hosted
desktop app — through a browser wizard or fully non-interactively, without
writing OpenTray code.

```bash
npx create-opentray
```

Requires Node >= 20 (native `sharp` icon pipeline).

## Command tree

```text
create-opentray                        # WebUI wizard (compatibility default)
create-opentray web [--port <n>] [--no-open]
create-opentray create [options]       # non-interactive creation
create-opentray app list|edit|copy|export|uninstall
create-opentray skill [list|read]      # packaged English AI skill
```

Every command accepts `--json` for a machine-readable typed result on stdout
(progress and diagnostics then use stderr only).

## Non-interactive create

```bash
npx create-opentray create \
  --app-id app.local.mytool \
  --app-name "My Tool" \
  --exec npm --arg run --arg dev \
  --cwd /path/to/project \
  --app-icon https://example.com/logo.png \
  --tray-icon ./tray.png \
  --pm npm
```

- `--arg` is repeatable; each value is ONE exact argv element — never a shell
  string (`&&` stays a literal argument).
- Icon sources: local files, `http(s)` URLs, or `data:` URLs. The CLI never
  scrapes names or favicons.
- `--config <file>` loads a complete v1 document; explicit flags override
  only their named fields.
- `--dry-run` prints the plan without mutating anything.
- `--force` replaces only a VERIFIED create-opentray payload — it never
  adopts or clears a user directory.
- `--no-image-smoothing` renders icons with nearest-neighbor sampling
  (pixel-art safe: enlarged app/tray icons keep hard edges).
- `--developer-mode` admits WebView DevTools in the generated app (default
  off; it means nothing else).
- `--window <WxH>` sets the window size (default 1200x800).

## The v1 registry layout

```text
~/.opentray/create/<encoded-app-id>/
  create-opentray.json      # the SOLE editable authority (schemaVersion 1)
  app/                      # generated payload (managed dir, or a link)
  app-icon.<ext>            # committed icon snapshots (hash-verified)
  tray-icon.<ext>
```

`create-opentray.json` is the only file you edit: identity/name, exact
command vector (executable/args/cwd/env), package manager, icon resource
references with content hashes and provenance, icon-rendering options
(including `imageSmoothingEnabled`), window options, and `developerMode`.
Generated files are derived output and are regenerated on every apply.

Key rules:

- **appId is immutable** — a new identity is `app copy`, never an edit.
- **The registry root is fixed** at `~/.opentray/create/`.
- **Snapshots are stable** — URL-fetched icons are committed locally; later
  URL drift never changes an existing registration.
- **Breaking boundary**: projects identified only by the older
  `opentray.app.json` marker are not discovered, listed, or migrated.

## Managing applications

```bash
npx create-opentray app list
npx create-opentray app edit app.local.mytool --app-name "Renamed" --force
npx create-opentray app copy app.local.mytool --new-app-id app.local.tool2
npx create-opentray app export app.local.mytool --format sh -o make.sh
npx create-opentray app uninstall app.local.mytool
```

- `app list` reports health: `healthy`, `invalid-config`,
  `incompatible-version`, `missing-payload`, `broken-link`, or `running`,
  with registration and payload paths.
- A running instance blocks edits/uninstalls with a typed `app_running`
  result until `--stop-running` is passed. Processes are terminated only
  when the recorded PID, ownership token, and start fingerprint still match;
  a reused PID is refused, never killed.
- `app uninstall` retains a linked external target unless `--purge-target`
  explicitly authorizes deletion after revalidation. macOS Dock pins and
  Windows taskbar pins are user-managed.

## Export

`app export` produces a complete recreation artifact:

- `--format command` — exact argv command line (uploads embed as data URLs
  only with `--force-copy`).
- `--format sh` / `--format ps1` — self-contained scripts (LF / CRLF);
  uploaded icon bytes are embedded and reconstructed into a temp file before
  invocation.
- Any environment entry makes complete export require `--acknowledge-env`.
  create-opentray never guesses which values are sensitive — it always asks
  once, and never echoes env values in ordinary output.

## WebUI wizard

`create-opentray` (or `create-opentray web`) starts a token-guarded WebUI on
`127.0.0.1` and opens your browser: paste a start command, watch it run in a
real interactive terminal, confirmed HTTP services open as tabs, and
identity/icon defaults are suggested from the served page (every suggestion
is a placeholder you can override). The wizard speaks the same Core as the
CLI, so both produce identical plans.

## Generated project

The entry (`main.mjs`) spawns the recorded command (output → `app.log`),
continuously discovers the command's OWNED HTTP listening ports (foreign
listeners such as browser DevTools sockets are never adopted), hosts each
verified port in an application-mode WebView window, and owns the tray
session (Quit lives in the tray menu). Optional startup-terminal and
address-bar shells are available through the wizard's advanced options.

## Platform notes

- macOS: the stable `.app` bundle is materialized by the OpenTray runtime on
  first launch; pin it to the Dock (removing a pin is manual).
- Windows: directory links use junctions (or symlinks when permitted);
  failure is a typed error, never a silent copy. The appMode window joins
  the taskbar/Alt-Tab. Native acceptance runs on Windows agents —
  non-Windows fixtures are preparatory evidence only.
- Linux: taskbar pinning depends on the desktop environment.

## AI skill

The package ships an English AI skill (`skill/`) readable without any
network access:

```bash
npx create-opentray skill                 # read SKILL.md
npx create-opentray skill list references # list one directory
npx create-opentray skill read SKILL.md   # read any packaged file
```

Skill access is read-only and contained: absolute paths, `..` traversal, NUL
bytes, and symlink escapes are rejected before any filesystem read, and the
output is always the canonical English tree regardless of host locale.

## Programmatic use

```ts
import { createWizardSession, deriveDefaultAppId } from "create-opentray";
```

See the package's TypeScript definitions (dist/index.d.mts) for the full
surface (wizard session, server, discovery, scraping, launch-vector
resolution, scaffold, materialize).
