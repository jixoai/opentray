---
"@opentray/spec": patch
"opentray": patch
---

Add OS-scoped tray icon candidates for Darwin, Win32, and Linux. Darwin candidates can carry `isTemplate`, which the tray-icon backend now applies through native template rendering when the Darwin candidate is selected.

The tray-icon backend now also projects `appName` as final visible tray text when no configured icon/text produces visible pixels, preventing invisible click targets when an app omits an icon or accidentally supplies a transparent image. The `opentray` entrypoint re-exports common app-facing tray types such as `CreateTrayOptions`, `TrayIcon`, and `TrayMenu` so consumers do not need `typeof` inference or direct `@opentray/spec` imports for ordinary app code.
