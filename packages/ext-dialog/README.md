# @opentray/ext-dialog

Official OpenTray dialog extension: OS-standard modal message boxes and file/directory/save pickers for host-side callers (tray menu actions, background CLIs, moments without a visible page).

## Role

- `attachDialog(tray)` returns a session-scoped capability: `alert`, `confirm`, `messageDialog`, `pickFile` (single or `multiple: true`), `pickDirectory`, `pickSavePath`, and an async `getBackend()` capabilities snapshot.
- Show-class commands settle through the DeferredOperation transaction: one `ext-command-accepted`, then exactly one `ext-operation-terminal` result frame; picker cancel resolves `null`, confirm resolves canonical absolute paths (a save leaf canonicalizes against its deepest existing ancestor).
- Dismissal (close/ESC/system) always maps to `cancelId` (or button `0`); `suppressed` reports the "do not ask again" checkbox without persisting it.
- Strict facade preflight before any state change: typed `dialog_invalid_options` (empty buttons, out-of-range indices, unknown fields), `dialog_platform_namespace_mismatch` (a non-current platform namespace is never silently ignored), `dialog_platform_unsupported` (Linux), and DTO-gated `dialog_capability_unavailable` (e.g. `commandLink` without TaskDialog) with `getBackend()` as the runtime fact source.
- All rejections surface as `DialogError` with a stable `code` (including the `dialog_transport_closed` mapping of the shared core transport-close code); never parse the human message.

Platform specifics stay structured: `options.darwin` / `options.win32` namespaces are typed, validated field by field, and documented per method. There is no prompt dialog, no page bridge, and no Linux native implementation by law.

Filters: omitting `filters` (or passing `[]`) means all files. Extensions are bare (no dot, case-insensitive).

## Install

```bash
pnpm add opentray @opentray/ext-dialog
```

## Typed Errors

| Code | Meaning |
| ---- | ------- |
| `dialog_platform_unsupported` | No native dialog runtime for this platform (Linux). |
| `dialog_platform_namespace_mismatch` | Options carried a namespace for the wrong platform. |
| `dialog_invalid_options` | Empty `buttons`, out-of-range indices, unknown fields, malformed filters. |
| `dialog_capability_unavailable` | Feature needs a backend the current runtime does not have (e.g. `commandLink`). |
| `dialog_session_busy` | A second concurrent dialog for the same owner session. |
| `dialog_worker_limit_reached` | Windows worker pool exhausted (bounded, never silently queued). |
| `dialog_presentation_failed` | The dialog could not be presented (synchronous, original request). |
| `dialog_dismissal_unavailable` | The platform cannot observe the dismissal cause. |
| `dialog_transport_closed` | The broker transport closed while the dialog was pending. |

## Platform Matrix

| Option | macOS | Windows |
| ------ | ----- | ------- |
| `severity: 'info'/'warning'/'error'` | Informational/Warning/Critical alert style | TaskDialog icon; MessageBox `MB_ICON*` in the fallback |
| `suppressionLabel` | Native checkbox (`showsSuppressionButton`), reported not persisted | TaskDialog verification checkbox; honestly `false` in the MessageBox fallback |
| `createDirectories` (save) | `canCreateDirectories` toggle | No-op switch: the save panel can always create directories |
| `fileNameLabel` | `NSSavePanel.nameFieldLabel` | `IFileDialog.SetFileNameLabel` |
| `options.darwin` pick fields | `canSelectPackages` (modern `allowedContentTypes` projection), `treatsFilePackagesAsDirectories`, `resolvesAliases`, `includeDirectories` mixed selection, `panelMessage`, `allowsOtherFileTypes` | — |
| `options.win32` fields | — | `buttonStyle: 'commandLink'` + `buttonHints`, `footer`, `expander`, `allowCancelOnClose`, `addToRecent`, `strictFileTypes`, `defaultExtension`, `okButtonLabel` |
| Backend DTO | `packageSemantics`, `mixedFileDirectorySelection` true; `taskDialog`/`commandLinks`/`expander`/`addToRecentControl` false | `taskDialog`/`commandLinks`/`expander` follow the comctl32 v6 probe; `addToRecentControl` true; MessageBox fallback reports `taskDialog: false` |
| Linux | `unsupported by design` (typed rejection before dispatch) | — |

Windows MessageBox fallback degradations (no common-controls v6): at most three buttons map to fixed platform sets, custom button labels collapse, `suppressed` reports `false`, and `commandLink`/`expander` reject typed `dialog_capability_unavailable`.

## Packaging

The facade ships one embedded native package: `platforms/<target>/` libraries for darwin-arm64/x64 and win32-arm64/x64 plus the `platforms/manifest.json` identity chain — no `optionalDependencies` platform packages. Consumers never install or locate the native library manually.

Consumer guides live in the public `skills/opentray` documentation.
