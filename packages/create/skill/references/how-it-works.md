# How create-opentray works

## The two application sources

A v1 application carries exactly ONE source:

- **Command** — `--exec/--arg/--cwd/--env`: create-opentray supervises a local
  start command and hosts the HTTP services it owns.
- **URL** — `--url <http(s) address>`: no command at all. The generated app
  opens one window directly at the frozen address. The address is known up
  front (unlike a command that must run first), so creation scrapes the page
  once and adopts its `<title>` and best favicon as DEFAULTS — explicit flags
  win, failures fall back silently to the address-derived name and a glyph
  icon, and `--no-scrape` skips the fetch. appId always derives from the
  address text, never from page content. URL apps carry no PTY, no terminal
  shell, and no env overlay; toolbar mode adds only the shell-served toolbar
  page (still no PTY).

## The creation pipeline

1. **Desired state** — CLI flags or the WebUI form compile into one v1
   desired-state document. Both adapters share the same Core, so a WebUI
   create and an equivalent CLI create produce the same plan.
2. **Plan** — Core performs every non-mutating check: identity, ownership of
   an existing registration, resource sources, payload strategy, running
   processes, and warnings. `--dry-run` prints exactly this.
3. **Apply** — Core commits icon snapshots (with hashes), writes
   `create-opentray.json`, regenerates the payload transactionally into a
   staging directory and swaps it in, installs dependencies, launches, and
   records a runtime ownership record (PID + token + start fingerprint).

## What the generated app does at runtime

Command apps:

- Reads the frozen command vector from its derived config and spawns the
  command with an absolute, PATH-independent executable.
- Continuously monitors the command's OWNED listening ports (ownership is
  attributed through the process tree; foreign listeners such as browser
  DevTools sockets are never adopted).
- Opens one application-mode webview window per verified port; a port that
  stops listening marks its window detached.
- Publishes a tray with Quit; optional startup-terminal and navigation-
  toolbar shells when configured (the toolbar composes a native toolbar
  webview above each service window's content webview).

URL apps:

- Publish the tray (Show/Reload/Quit) and one application-mode webview
  window at the frozen URL. The title follows the page document by default
  (one-way); runtime favicon→icon following is opt-in (`--icon-follow`).
- Toolbar mode (`--toolbar`, `window.toolbar` in the v1 config) composes the
  native navigation-toolbar carrier: one toolbar webview at a fixed top strip
  (back/forward/reload buttons, address input, and the ⌘/Ctrl navigation
  shortcuts while the toolbar holds native focus) above one content webview
  loading the address directly as a top-level browsing context. The address
  bar follows the content webview's URL events as its source of truth;
  back/forward drive the content webview's native history. Embedding policy
  is never consulted — an embedding-hostile site renders the same as any
  other address because the content webview is not an embedded context.
- Supervise nothing: no child process, no port monitor; Quit destroys the
  window and tray session and exits.

## Force and ownership

`--force` is not "overwrite anything": it may only replace a payload whose
registration holds a valid matching v1 document. An unknown non-empty
directory is rejected with a typed error and nothing is deleted.

## Stop/restart safety

Generated apps record `runtime.json` (PID, unique token, process start
fingerprint). Stop commands verify the live process identity before any
termination; a PID reused by an unrelated process is refused with
`pid_reused`, and an unverifiable PID is never killed by name or appId.

## Uninstall semantics

- Managed payload: the registration envelope AND the payload directory are
  removed.
- Linked payload: only the link and envelope are removed; the external
  target is retained unless `--purge-target` revalidates identity and
  explicitly authorizes deletion.
- macOS Dock pins and Windows taskbar pins are user-managed and must be
  removed manually.
