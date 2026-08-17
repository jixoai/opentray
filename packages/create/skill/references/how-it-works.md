# How create-opentray works

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

- Reads the frozen command vector from its derived config and spawns the
  command with an absolute, PATH-independent executable.
- Continuously monitors the command's OWNED listening ports (ownership is
  attributed through the process tree; foreign listeners such as browser
  DevTools sockets are never adopted).
- Opens one application-mode webview window per verified port; a port that
  stops listening marks its window detached.
- Publishes a tray with Quit; optional startup-terminal and address-bar
  shells when configured.

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
