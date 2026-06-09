# Troubleshooting

Use this reference when the user can install OpenTray but something local is missing or unsupported.

## Health Says Daemon Is Absent

- `opentray daemon health` reporting absence before first use is normal.
- Real SDK/example usage should auto-start the daemon.

## WebView Window Does Not Appear

- Confirm the user installed both `opentray` and `@opentray/ext-webview`.
- Use the visual acceptance recipe or workspace examples to verify extension loading.
- Capability gaps should fail explicitly; do not describe an invisible or fake window as success.

## Icon Looks Missing

Current native icon support is `rgba`. Other typed icon shapes may still return unsupported until decoder/file-policy work is implemented.

## Extension Loader Debugging

`OPENTRAY_EXT_PATH` can point the daemon at an explicit extension directory for debugging, but the normal release path is package-adjacent resolution from the requested facade package.
