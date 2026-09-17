# @opentray/ext-dialog

Official OpenTray dialog extension: OS-standard modal message boxes and file/directory/save pickers for host-side callers (tray menu actions, background CLIs, moments without a visible page).

## Role

- `attachDialog(tray)` returns a session-scoped capability: `alert`, `confirm`, `messageDialog`, `pickFile` (single or `multiple: true`), `pickDirectory`, `pickSavePath`, and an async `getBackend()` capabilities snapshot.
- Show-class commands settle through the DeferredOperation transaction: one `ext-command-accepted`, then exactly one `ext-operation-terminal` result frame; picker cancel resolves `null`, confirm resolves canonical absolute paths (a save leaf canonicalizes against its deepest existing ancestor).
- Dismissal (close/ESC/system) always maps to `cancelId` (or button `0`); `suppressed` reports the "do not ask again" checkbox without persisting it.
- Strict facade preflight before any state change: typed `dialog_invalid_options` (empty buttons, out-of-range indices, unknown fields), `dialog_platform_namespace_mismatch` (a non-current platform namespace is never silently ignored), `dialog_platform_unsupported` (Linux), and DTO-gated `dialog_capability_unavailable` (e.g. `commandLink` without TaskDialog) with `getBackend()` as the runtime fact source.
- All rejections surface as `DialogError` with a stable `code` (including the `dialog_transport_closed` mapping of the shared core transport-close code); never parse the human message.

Platform specifics stay structured: `options.darwin` / `options.win32` namespaces are typed, validated field by field, and documented per method. There is no prompt dialog, no page bridge, and no Linux native implementation by law.

## Packaging

The facade ships one embedded native package: `platforms/<target>/` libraries for darwin-arm64/x64 and win32-arm64/x64 plus the `platforms/manifest.json` identity chain — no `optionalDependencies` platform packages. Consumers never install or locate the native library manually.

Consumer guides live in the public `skills/opentray` documentation.
