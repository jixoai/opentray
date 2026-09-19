---
"@opentray/ext-dialog": minor
---

darwin: custom dialog icons via `options.darwin.icon` (messageDialog).

A file path to any loadable image — a custom `.png`/`.icns` or a system
icon file — replaces the dialog's default app-icon slot. The osascript
bridge projects it through `display dialog`'s `with icon file` (the
severity badge yields: the single `with icon` parameter is either the
severity constant or a file); an unreadable path rejects typed
(`dialog_presentation_failed`, `reason: "icon-unreadable"`) before any
dialog is shown. The in-process path (properly signed carriers)
projects the same option through `NSAlert.setIcon`. Payload crosses as
a positional run ARGV reference like every other bridge string.
