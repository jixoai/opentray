---
"@opentray/ext-dialog": patch
---

darwin: modal dialogs are clickable on the real broker host (issue #10).

The broker runs as an unactivated Accessory-policy app between
surfaces; AppKit routes a non-active app's mouse clicks to application
activation instead of the modal's buttons, so every shipped dialog
hung forever on a real host (promise never settled) and rendered in
the degenerate non-key-window form (blank third button slot, `<`-prefixed
suppression placeholder, no default-key styling) — while both the
synthetic-event ABI probe and the mocked-transport suite stayed green.
Every modal session now begins after
`NSApplication.activateIgnoringOtherApps(true)`: the modal window
becomes the key window, clicks reach the buttons, and the system
de-activates the app naturally after the terminal.
