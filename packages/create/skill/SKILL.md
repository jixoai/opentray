---
name: create-opentray
description: create-opentray guide for turning any HTTP-serving start command into an OpenTray-hosted desktop application — WebUI wizard, non-interactive CLI creation, the v1 create-opentray.json configuration authority, the fixed ~/.opentray/create registry, application lifecycle (edit, copy, export, uninstall), icon handling including pixel-art smoothing, developer mode, and platform limitations. Use when scaffolding or managing applications created by create-opentray.
---

# create-opentray

## Overview

`create-opentray` packages a start command that serves HTTP locally into an
OpenTray-hosted desktop application: a real tray icon, a webview window, and a
supervised child process. This skill explains how it works, how to drive it
non-interactively, and how to manage created applications.

Three adapter surfaces share one Core:

1. `create-opentray` (no arguments) and `create-opentray web` — the loopback
   WebUI wizard. It can run your command once, discover the HTTP ports it
   owns, and suggest a name/icon from the served page.
2. `create-opentray create …` — fully non-interactive creation. No browser,
   no prompts, no sniffing: identity, icons, and the command vector are all
   explicit.
3. `create-opentray app …` — manage registered applications: list, edit,
   copy, export, uninstall.

## How OpenTray hosts an app (background)

OpenTray is a desktop status platform: your application calls `createTray()`
and owns its own foreground/background lifetime. A created application is a
small generated project whose entry (`main.mjs`):

- spawns your recorded start command as a supervised child,
- discovers the command's owned HTTP listening ports at runtime,
- hosts each verified port in an application-mode webview window, and
- owns the tray session with a Quit menu item.

The generated project depends only on published packages (`opentray`,
`@opentray/ext-webview`) — never on the create-opentray tool itself.

## The v1 configuration authority

Every registered application has exactly one editable desired-state document:

```text
~/.opentray/create/<encoded-app-id>/
  create-opentray.json      # the SOLE editable authority (schemaVersion: 1)
  app/                      # generated payload (managed dir, or a link to an external dir)
  app-icon.<ext>            # committed icon snapshots (referenced relatively)
  tray-icon.<ext>
```

`create-opentray.json` records app identity and name, the exact command
vector (executable, args, cwd, env overlay), package-manager choice, icon
resource references with content hashes and provenance, icon-rendering
options (including `imageSmoothingEnabled`), window options, and
`developerMode`. Generated files are derived output — editing them is
overwritten on the next apply; edit the JSON instead.

Key rules:

- **appId is immutable.** Changing identity means `app copy` or a new
  application, never an in-place rename.
- **The registry root is fixed**: `~/.opentray/create/`. It is never
  redirected by a setting.
- **Snapshots are stable.** An icon fetched from a URL is committed locally
  with its hash; later URL drift never changes an existing registration.
- **Legacy breaking boundary.** Projects identified only by the older
  `opentray.app.json` marker are not discovered, listed, or migrated.

## Non-interactive creation

```sh
npx create-opentray create \
  --app-id app.local.mytool \
  --app-name "My Tool" \
  --exec npm --arg run --arg dev \
  --cwd /path/to/project \
  --app-icon https://example.com/logo.png \
  --pm npm
```

- `--arg` is repeatable and each value is ONE exact argv element — never a
  shell string. Metacharacters like `&&` stay literal.
- Icon sources may be local files, `http(s)` URLs, or `data:` URLs. The CLI
  never scrapes names or favicons — everything is explicit.
- `--dry-run` prints the Core plan (effects, warnings, blocks) without
  mutating anything.
- `--force` replaces only a VERIFIED create-opentray payload. It never
  adopts or clears a user directory.
- `--no-image-smoothing` renders icons with nearest-neighbor sampling —
  essential for low-resolution pixel art so enlarged icons keep hard edges.
- `--developer-mode` admits WebView DevTools in the generated app (default
  off; it means nothing else).

## Application lifecycle

```sh
npx create-opentray app list
npx create-opentray app edit app.local.mytool --app-name "Renamed" --force
npx create-opentray app copy app.local.mytool --new-app-id app.local.mytool2
npx create-opentray app export app.local.mytool --format sh
npx create-opentray app uninstall app.local.mytool
```

- `app list` shows health status: `healthy`, `invalid-config`,
  `incompatible-version`, `missing-payload`, `broken-link`, or `running`,
  with both registration and payload paths.
- `app edit` applies flag patches over the committed document (omitted flags
  never reset fields). A running instance blocks edits with a typed
  `app_running` result until `--stop-running` is passed; `--restart`
  relaunches after.
- `app uninstall` removes the registration. If the payload is a link to an
  external directory, the target is RETAINED unless `--purge-target` is
  explicit. Dock (macOS) and taskbar (Windows) pins must be removed manually.
- Live processes are only ever terminated when the recorded PID and its
  ownership token/start fingerprint still match. A reused PID is refused,
  never killed.

## Command and script export

`app export` emits a complete recreation artifact:

- `--format command` — the exact argv command line (one string).
- `--format sh` — a self-contained POSIX shell script; uploaded icon bytes
  are embedded and reconstructed into a temp file before invocation.
- `--format ps1` — the PowerShell equivalent (CRLF line endings).
- `--output <file>` writes the script to a file instead of stdout.
- Direct command copy with embedded uploads requires `--force-copy`;
  scripts are the default for uploaded resources.
- Any environment entry makes complete export require
  `--acknowledge-env`. create-opentray never classifies which values are
  sensitive — it treats every env-bearing export as needing one explicit
  confirmation, and never echoes env values in ordinary output.

## Windows notes

- Directory links use junctions (or symlinks when permitted); if neither can
  be created the operation fails with a typed error — it never silently
  copies.
- Paths (drive letters, UNC, spaces) round-trip natively; the CLI never
  shells through `/bin/sh` or reinterprets POSIX separators.
- Native Windows acceptance is validated on Windows agents; non-Windows
  fixtures are preparatory evidence only.

## Skill commands

```sh
npx create-opentray skill                 # read this SKILL.md
npx create-opentray skill list            # list packaged skill files
npx create-opentray skill list references # list one directory
npx create-opentray skill read SKILL.md   # read any packaged file
```

Skill access is read-only and contained: absolute paths, `..` traversal, NUL
bytes, and symlink escapes are rejected before any filesystem read, and
output is always the canonical English tree regardless of host locale.
