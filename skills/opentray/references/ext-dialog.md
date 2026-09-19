<!--
Orthogonal intents (maintained 2026-09-18; established by the add-ext-dialog change):
1. Route package consumers to OS-standard modal dialogs (message boxes, file/directory/save
   pickers) for host-side callers without a visible page.
2. Preserve platform truth: darwin suppression/severity, win32 TaskDialog/MessageBox fallback
   degradations, and Linux typed unsupported.
3. Keep the frozen typed error surface and the filters all-files spelling explicit.
4. State the embedded packaging meaning for consumers: a normal install is complete.
-->

# ext-dialog

Use this reference when the user asks how to show an OS-standard dialog from a tray menu
action, a background CLI, or any host-side moment without a visible page. There is no prompt
(text input) dialog and no page bridge by design.

## Install

```bash
pnpm add opentray @opentray/ext-dialog
```

The facade embeds its native libraries for macOS and Windows inside one package — a normal
package-manager install is the complete setup. There are no platform packages to install and
no native library to locate. Linux rejects typed `dialog_platform_unsupported`.

## Public Shape

```ts
import { attachDialog } from "@opentray/ext-dialog";
import { createTray } from "opentray";

const tray = await createTray(
  { id: "com.example.tool", icon: { "text-only": "OT" } },
  { appId: "com.example.tool", appName: "Tool" }
);
const dialog = attachDialog(tray);

tray.onMenuClick(async ({ itemId }) => {
  if (itemId === 1) {
    const ok = await dialog.confirm("Reset all settings?", {
      severity: "warning",
      suppressionLabel: "Do not ask again",
    });
    if (ok) await resetSettings();
  }
  if (itemId === 2) {
    const file = await dialog.pickFile({
      filters: [{ name: "Images", extensions: ["png", "jpg"] }],
    });
    if (file !== null) await importFile(file);
  }
});
```

The capability is session-scoped (`tray.extend` family) and exposes:

- `alert(message, options?)` — one `OK` button
- `confirm(message, options?)` — `OK`/`Cancel`, resolves `boolean`
- `messageDialog(options)` — full contract: `buttons`, `defaultId`, `cancelId`, `severity`
  (`info`/`warning`/`error`), `suppressionLabel`, `detail`
- `pickFile({ multiple?: true })` — single path, or `readonly string[]` with `multiple: true`
- `pickDirectory()`, `pickSavePath()`
- `getBackend()` — async frozen capabilities snapshot

## Dialog Rules

- Close/ESC/system dismissal always resolves to `cancelId` (or button `0` when unset); it never
  rejects and never fakes a button press. A platform that cannot observe the close reason
  rejects typed `dialog_dismissal_unavailable`.
- Picker cancel resolves `null` — not an empty array and not a rejection. Confirm resolves
  canonical absolute paths (`~` expanded); a save leaf canonicalizes against its deepest
  existing ancestor and is not guaranteed to exist.
- Filters: omitting `filters` (or passing `[]`) means all files. Extensions are bare
  (no dot, case-insensitive).
- `suppressionLabel` shows a "do not ask again" checkbox; the result reports `suppressed`
  without persisting it — storing that choice is the application's own state.
- One active dialog per owner session; a second concurrent show rejects typed
  `dialog_session_busy` before any state change.
- Platform-specific fields live in typed `options.darwin` / `options.win32` namespaces. A
  non-current platform namespace rejects typed `dialog_platform_namespace_mismatch`; unknown
  fields reject typed `dialog_invalid_options`. Never catch-and-guess: branch on the typed
  `code`.

## Platform Truth

- macOS: `NSAlert`/`NSOpenPanel`/`NSSavePanel`; suppression and severity are native;
  `createDirectories` toggles the save panel's directory creation; `canSelectPackages` maps to
  the modern `allowedContentTypes` projection (a documented no-op in the all-files spelling).
- macOS presentation fallback (empirical macOS 26 matrix, 2026-09-19): interactive dialog
  presentation is gated by the carrier's code-signing class. Ad-hoc/linker-signed carriers
  (the default for unsigned installs) present through the Apple-signed `/usr/bin/osascript`
  host — `display dialog` for message dialogs, `choose file`/`choose folder`/
  `choose file name` for the pickers — with these documented degradations: `detail` folds
  into the message text, `suppressionLabel` is not expressible (`suppressed` resolves
  `false`), filter names drop (the extension union still applies), and bridge dialogs carry
  the osascript host icon. More than three buttons and mixed file+directory selection reject
  typed (`dialog_presentation_failed` with `reason: "bridge-buttons-limit"` /
  `"bridge-mixed-selection-unsupported"`). A Developer-ID-signed carrier restores the full
  in-process AppKit experience; every result contract (button index, cancel `null`) is
  identical on both paths.
- Windows: TaskDialog with `commandLink` buttons, `buttonHints`, `footer`, and `expander` in
  the `win32` namespace. Without common-controls v6 the runtime degrades to `MessageBoxW`:
  at most three buttons map to fixed platform sets, custom button labels collapse, and
  `suppressed` honestly reports `false`. `commandLink`/`expander` under a degraded backend
  reject typed `dialog_capability_unavailable` — check `getBackend()` before offering them.
- `createDirectories` is a harmless no-op switch on the win32 save panel (creation is always
  available); `severity` maps to alert styles on both platforms.
- Linux: `unsupported by design` — every method rejects typed before any dispatch.

## Typed Errors

Every rejection is a `DialogError` with a stable `code`; never parse the human message.

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
