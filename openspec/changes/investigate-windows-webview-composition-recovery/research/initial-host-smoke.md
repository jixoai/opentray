# Initial Host Smoke

Date: 2026-07-16

Original user input: clearWhiteBlock visibly churns the page without clearing retained residue, while even a very small resize appears to clear it. Frameless transitions show the same residue class.

Status: machine-host evidence only. This record does not claim that any visible pixels were cleared.

## Purpose

Establish a trustworthy comparison in the real OpenTray Windows host before testing a new recovery candidate.

```text
manual clearWhiteBlock
        |
        v
shell-state baseline

one-pixel resize
        |
        v
geometry and host-surface refresh only
```

The diagnostic launcher forces `OPENTRAY_WINDOWS_AUTO_CLEAR_WHITE_BLOCK=0`. Without this condition, `resizeTo()` performs its normal geometry update and then invokes automatic shell recovery, which makes the resize control uninterpretable.

## Method

An isolated Cargo target avoided a locked default debug DLL. The run used the source broker and extension artifacts from that target:

```powershell
$env:OPENTRAY_EXT_PATH = 'E:\dev\github\opentray\target\codex-win32-diagnostics\debug\opentray_ext_webview.dll'
$env:OPENTRAY_BROKER_BIN = 'E:\dev\github\opentray\target\codex-win32-diagnostics\debug\opentray.exe'
$env:OPENTRAY_EXAMPLE_EXIT_AFTER_MS = '6000'
$env:OPENTRAY_EXAMPLE_WIN32_BUG_SMOKE = '1'
pnpm --filter opentray example:win32-bug
```

The smoke starts a Mica, framed, resizable session. It runs width +1, restores the original width, then dispatches the page manual-clear command.

## Observed Native Records

| Operation | Phase | Result |
| --------- | ----- | ------ |
| style projection | applied | Mica, clear backing true, host fill 0x00000000 |
| initial show and delayed reveal | skipped:auto-disabled | no automatic shell recovery |
| explicit resize to width +1 | applied then skipped:auto-disabled | no shell-clear requested or completed record |
| explicit resize to original width | applied then skipped:auto-disabled | no shell-clear requested or completed record |
| manual clear | requested then completed | shell-state baseline completed in 23ms |

The logged Mica contract was `background=platform:mica`, `clear_backing=true`, and `host_fill=0x00000000`. The emitted HWND was visible, non-minimized, non-maximized, and resizable for the pulse.

## Interpretation Boundary

- This proves the diagnostic harness reaches the real HWND, windowed WebView2, and DWM material path.
- This proves the standard pulse no longer carries automatic shell recovery.
- This does not identify whether retained pixels belong to DWM redirection, the child WebView2 surface, or their composition boundary.
- This does not prove that either manual clear or the pulse visually repaired residue.

## Required Human Matrix

| Background | Trigger | Manual clear | One-pixel pulse | Flash | Focus/input | Residue result |
| ---------- | ------- | ------------ | --------------- | ----- | ----------- | -------------- |
| opaque | frameless transition | pending | pending | pending | pending | pending |
| mica | retained reveal | pending | pending | pending | pending | pending |
| mica | frameless transition | pending | pending | pending | pending | pending |
| acrylic | retained reveal | pending | pending | pending | pending | pending |
| acrylic | frameless transition | pending | pending | pending | pending | pending |

Do not add `SWP_NOCOPYBITS`, parent-window reattachment, or a composition-root candidate until this matrix is completed and the user chooses one named candidate.
