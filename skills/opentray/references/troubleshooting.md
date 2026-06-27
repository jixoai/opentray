# Troubleshooting

Use this reference when the user can install OpenTray but something local is missing or unsupported.

## Tray Never Appears

- There is no `opentray daemon health` CLI command. The public CLI only prints a usage pointer.
- For first apps, switch to `runTrayApp()` from `opentray/node` so the visible host loop is owned by the helper.
- If the user intentionally calls `createTray()` directly, the default transport uses the in-process visible runtime binding. Check that the host main thread is running `runVisibleRuntimeHost()` from `opentray/node` and that the platform runtime package resolved.
- On Linux, the visible binding path is unsupported until the KSNI backend grows an honest visible runtime contract; use `{ runtime: "headless-binding" }` or `{ runtime: "local-broker" }` for diagnostics.

## WebView Window Does Not Appear

- Confirm the user installed both `opentray` and `@opentray/ext-webview`.
- Use the visual acceptance recipe or workspace examples to verify extension loading.
- Capability gaps should fail explicitly; do not describe an invisible or fake window as success.

## Icon Looks Missing

Current native icon support is `rgba`. Other typed icon shapes may still return unsupported until decoder/file-policy work is implemented.

## Extension Loader Debugging

`OPENTRAY_EXT_PATH` can point the daemon at an explicit extension directory for debugging, but the normal release path is package-adjacent resolution from the requested facade package.
