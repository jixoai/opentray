---
"opentray": minor
"@opentray/spec": minor
---

Pin each host application's broker to a caller identity so the process is
identifiable in the task manager, and retire the shared-surface multi-session
aggregation model. Also fix createTray() hanging forever when the tray icon is
omitted (fixes #3) by making icon optional end-to-end and correlating broker
frame-parse errors to the originating request.
