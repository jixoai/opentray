# @opentray/ext-webview

Official rich popup extension for OpenTray.

## Role

- Provide borderless tray-adjacent popup surfaces.
- Use platform WebView engines through the native extension layer.
- Route WebView messages through the owning `surfaceId` / `trayId`.

This package is an extension atom. It must not become the owner of core tray lifecycle.

The facade stays platform-neutral. Native libraries are optional platform packages named `@opentray/ext-webview-<os>-<arch>`, and the daemon resolves them through the dynamic extension discovery law when `load-ext` requests `@opentray/ext-webview`.

## Example

Run a broker-free example that sends WebView `show`, `navigate`, `postMessage`, and `hide` commands through the normal OpenTray extension command path:

```bash
pnpm --filter @opentray/ext-webview example:webview
```
