---
"create-opentray": minor
---

# create-opentray: generation lifecycle, share, and workbench applications overhaul

## Generation no longer re-runs the command (create-no-first-launch-force-terminal)

- Root-cause fix for the hanging 正在生成应用… / `generated app entry exited early with 1`: the generated entry's blocking 30s service-port gate ran the command in a non-TTY pipe environment unlike the wizard preview, and preview/entry kills left orphaned servers holding ports that poisoned every retry.
- `materialize` completes at dependency install — no first-launch validation, no ready marker, no bundle wait. The pipeline badge surface is scaffold/icon/install.
- Generated entry: the command always runs through a PTY (preview parity); service discovery is an unbounded adaptive monitor (≈1s active, ≤5s quiet/loaded, one window per HTTP-verified port, dynamic ports included); an abnormal command exit (non-zero/signal, or exit before any verified service) force-reveals the terminal window with full output replay; teardown sweeps the whole process tree; startup failures persist their stack to app.log.
- Shell host + `@lydell/node-pty` scaffold unconditionally; wizard-side PTY preview kill sweeps descendants; open-app cold-starts the entry on Darwin when no bundle exists yet, and the pin hint defers Dock pinning to after the first open.

## Share and workbench applications (wizard-share-and-list-scan)

- Applications discovery scans the create root for BOTH layouts: v1 registrations and wizard scaffold projects (read-only projection with lockfile-inferred package manager).
- List rows: app icon, accordion details (command vector, cwd, env KEY names only, pm, window, dev mode, project dir), edit jump, open (bundle wake or cold start), share, and uninstall for both layouts.
- Uninstall (user requirement #11): scaffold-marker ownership gate, running-entry detection by exact absolute main.mjs argv match, typed running refusal with pids, an explicit force-stop confirmation dialog, whole-tree teardown, then project + OpenTray-home bundle removal. The list refreshes after app creation (route activation + success event).
- Share artifacts from the export kernel: `npx create-opentray` command line and self-contained sh/ps1 scripts, copyable and downloadable, with highlighted full-content preview. Scraped web icons default to sharing their http URL plus generation flags (background/scale/template); the inline-bytes toggle shows whenever an icon is present (URL or local) and switches between embedding and reference sharing.
- On-demand command quoting (bare-safe words stay unquoted) — also fixes embedded-icon temp-var tokens being single-quoted into literal strings, and the CLI `app export --format command` raw space join.

## Fixes

- appId derivation for scoped commands: `npx @deepseek-ai/dsh@latest web` derives `web.dsh.npx` (`@scope` segments dropped, `name@version` keeps the name).
- CLI create dependency range resolves the create-opentray release line (previously installed ancient SDKs from the private CLI package's own version).
- confirm dialog close (X/Esc/overlay) equals 返回修改 (thaws the frozen form); stable share builds (no request flicker); detail cache invalidates on list refresh.
