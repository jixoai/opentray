# @opentray/ext-notification

## 0.31.2

## 0.31.1

## 0.31.0

### Minor Changes

- e3aa306: darwin: notifications present on unsigned carriers through the
  osascript bridge fallback.

  macOS 26 refuses UNUserNotificationCenter authorization for
  ad-hoc/linker-signed apps in every launch shape (empirical isolation
  matrix: direct-exec, LaunchServices launch, LSUIElement, accessory
  AppKit — no prompt, no Settings entry, banners never present; a plist
  key is not the variable). Every darwin notify now triages the running
  process's code-signature class (SecCodeCopySelf +
  SecCodeCopySigningInformation): a properly signed app keeps the full
  UN-center experience; unsigned/ad-hoc carriers post through
  /usr/bin/osascript's `display notification` (Apple-signed host, always
  allowed) with title/body/subtitle passed as run ARGUMENTS — never
  interpolated into AppleScript literals — and the default alert sound
  unless silent. Acceptance stays resolve-on-acceptance (spawn success);
  bridge banners attribute to the osascript host icon (documented
  degradation). Authorization commands keep honest UN semantics; a
  denied snapshot still rejects typed with zero delivery. Developers who
  can sign get the full path by re-signing their carrier with a
  Developer ID identity.

## 0.30.2

### Patch Changes

- 7b226d3: Fix: `notify` resolves through BOTH settle shapes. Darwin's first
  snapshot-less notify legally defers (the authorization query runs inside
  the 10 s budget, then the notification posts and the deferred terminal
  resolves the acceptance — design sections 1-2), but the shipped facade
  asserted Immediate-only, so every real first notify on a fresh install
  rejected with "settles on the immediate path … received terminal" while
  scripted-transport tests stayed green. Caught by the new host-atoms
  acceptance panel (`example:hostAtoms`, scenario "notify — title only");
  the stale immediate-only test is superseded by both-shape coverage.

## 0.30.1

## 0.30.0

### Minor Changes

- 124b38d: Host-atom extension family (add-ext-clipboard + add-ext-opener +
  add-ext-notification): native clipboard, opener, and notification
  capabilities for tray apps.

  **@opentray/ext-clipboard** — first release. `attachClipboard(tray)` →
  `readText()`, `writeText(text)`, `clear()`, async `getBackend()`. UTF-16
  unit contract end to end (write cap `CLIPBOARD_MAX_WRITE_UTF16` =
  1,048,576 units, isolated-surrogate pairs reject typed instead of
  round-tripping through lossy replacement); win32 open discipline retries
  `ACCESS_DENIED` only, under a 2 s budget anchored at command dispatch
  with attempts/elapsed reported in the typed `clipboard_locked` details;
  HGLOBAL ownership laws enforced (board-owned handles are never freed,
  write handles are freed exactly when the system did not take them).

  **@opentray/ext-opener** — first release. `attachOpener(tray)` →
  `openURL(url)` with the strict frozen allowlist (`http`, `https`,
  `file`, `mailto`), `revealPath(path, { select?: boolean })` with the
  frozen Windows path matrix (drive-absolute and UNC accepted,
  drive-relative rejected, `\\?\` passed through literally, `file:`
  passthrough without normalization), `/select` rejection set
  (quotes/NUL/C0), root paths never trimmed (root reveal opens the
  root), async `getBackend()`.

  **@opentray/ext-notification** — first release. `attachNotification(tray)`
  → `notify({ title, body?, subtitle?, silent? })` with UTF-16 bounds
  64/256/64 enforced before any state change, `ensureAuthorization()`
  and `getAuthorization()`; darwin drives UNUserNotificationCenter with
  the deferred authorization transaction (prompt, grant, or deny — one
  terminal, timeout-bounded); win32 projects through the broker's tray
  balloon bridge (Shell_NotifyIcon NIF_INFO on the tray's own (HWND, uID)
  registration; subtitle joins the body with an em dash), authorization
  is a transport-agnostic capability query, and an unauthorized notify is
  the honest typed rejection — never a silent no-op.

  All three ship as embedded-kind packages (all four native targets
  inside the facade, ≤ 3 MB law) and are covered by the workspace
  verify + native artifact CI gates.
