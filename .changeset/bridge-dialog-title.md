---
"@opentray/ext-dialog": patch
---

darwin bridge: message dialogs carry the carrier display name as their title.

The osascript `display dialog` fallback left the title bar empty; the
bridge now passes `with title` with the carrier bundle's
`CFBundleDisplayName` (falling back to `CFBundleName`, then the process
name) — the same string an in-process NSAlert shows by default, so both
presentation paths show the same title. The title argv slot is composed
like every other bridge payload (positional `item N of argv` reference,
never a literal).
