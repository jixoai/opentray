# WebView Runtime Case Study

Use this reference when you need a concrete example of how OpenTray should split a native extension.

## What Changed

The `move-webview-native-runtime-into-extension` work established the current best practice:

- `opentray` stopped depending on `wry`.
- `crates/opentray-bin` stopped parsing WebView commands.
- `crates/opentray-ext-webview` took ownership of:
  - `show`, `hide`, `navigate`, `evaluate`, and `postMessage` parsing,
  - default HTML,
  - native window/runtime lifecycle,
  - `WebKit`/`wry` linkage.

## Why It Matters

Before the split, the extension dylib was only a thin ABI shell while the real WebView runtime still lived in the daemon. That made the binary sizes backwards and broke the “extension is a real atom” law.

After the split, the proof surface became correct:

- `opentray` shrank sharply.
- `libopentray_ext_webview.dylib` grew to carry the runtime it actually owns.
- `otool -L` showed `WebKit.framework` only on the dylib, not on `opentray`.

## Reusable Lesson

If an extension package is supposed to be an independent native atom, then:

- the facade should stay typed and thin,
- the daemon should stay generic,
- the native runtime should move physically into the extension artifact,
- the proof should be visible in file size and linkage, not only in source code organization.
