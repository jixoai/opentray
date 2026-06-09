---
"@opentray/ext-webview": minor
"opentray": minor
---

Stop publishing official Linux native packages for `@opentray/ext-webview`.
OpenTray core still supports Linux, while the WebView extension now publishes
native runtime atoms only for macOS and Windows until a real visible Linux
runtime is available.

Promote the Windows WebView2 runtime to the stable WebView support matrix and
remove the public `opentray smoke` subcommands so the CLI remains focused on
daemon lifecycle and health. Visual smoke orchestration now lives in OpenTray
skills and source-tree examples.
