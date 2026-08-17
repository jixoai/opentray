# CLI reference

Complete option surface of the `create-opentray` yargs command tree. Every
command accepts `--json` for a machine-readable typed result on stdout
(progress and diagnostics then use stderr only).

## `create-opentray` / `create-opentray web`

Starts the loopback WebUI wizard. Options: `--port <n>` (bind a specific
loopback port), `--no-open` (do not launch the default browser).

## `create-opentray create`

Non-interactive creation. Options:

| Option | Meaning |
| ------ | ------- |
| `--config <file>` | base v1 document; explicit flags override named fields only |
| `--app-id <id>` | immutable reverse-dotted identity (required without `--config`) |
| `--app-name <name>` | display name (required without `--config`) |
| `--exec <executable>` | command executable |
| `--arg <value>` | one exact argv element (repeatable) |
| `--cwd <dir>` | command working directory (default: current) |
| `--env <KEY=VALUE>` | environment overlay entry (repeatable) |
| `--pm <npm\|pnpm\|bun>` | package manager for the generated project |
| `--app-icon <src>` | file path, http(s) URL, or data URL |
| `--tray-icon <src>` | same; default follows `--app-icon` |
| `--icon-background <black\|white\|transparent>` | composition background |
| `--icon-scale <0.5–0.95>` | foreground scale (default 0.8) |
| `--image-smoothing <bool>` | `false` = nearest-neighbor for pixel art (default true) |
| `--tray-template` | treat the tray source as a darwin template |
| `--developer-mode` | admit WebView DevTools (default false) |
| `--window <WxH>` | window size (default 1200x800) |
| `--force` | replace a VERIFIED existing payload |
| `--stop-running` | stop a verified running instance first |
| `--skip-install` | write the project without installing |
| `--dry-run` | print the Core plan without mutation |

## `create-opentray app list [--json]`

Health-classified registrations with registration/payload paths and link
evidence.

## `create-opentray app edit <app-id> [patches…]`

Same field options as `create`, plus `--restart`. Rejects appId changes
(use `app copy`). Requires `--stop-running` when a verified instance runs.

## `create-opentray app copy <app-id> --new-app-id <id> [--app-name <name>]`

Creates a new registration from an existing one. Snapshots are re-committed
under the new identity.

## `create-opentray app export <app-id> [--format command|sh|ps1]`

| Option | Meaning |
| ------ | ------- |
| `--format <command\|sh\|ps1>` | output shape (default command) |
| `--output <file>` | write a script to a file instead of stdout |
| `--force-copy` | allow embedded upload bytes in the direct command |
| `--acknowledge-env` | confirm complete output includes env values |

## `create-opentray app uninstall <app-id>`

| Option | Meaning |
| ------ | ------- |
| `--stop-running` | stop a verified running instance first |
| `--purge-target` | ALSO delete a linked external target after revalidation |

Exit always names the removed paths, whether the external target was
retained or deleted, and that OS pins are manual.

## `create-opentray skill [list|read]`

Read-only packaged skill access. `skill` reads `SKILL.md`; `skill list
[path]` lists logical entries; `skill read <path>` writes one file's exact
content. Paths are relative with `/` separators on every platform.
