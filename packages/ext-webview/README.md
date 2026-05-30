# @opentray/ext-webview

Official rich popup extension for OpenTray.

## Role

- Provide borderless tray-adjacent popup surfaces.
- Use platform WebView engines through the native extension layer.
- Route WebView messages through the owning `surfaceId` / `trayId`.

This package is an extension atom. It must not become the owner of core tray lifecycle.
