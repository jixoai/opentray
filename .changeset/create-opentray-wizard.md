---
"create-opentray": minor
---

Add the `create-opentray` npm initializer. `npx create-opentray` opens a local
WebUI wizard that runs a start command once, discovers its HTTP services by
port diffing, scrapes favicon/title defaults, derives a default appId from the
pre-option command segment, and materializes a self-contained OpenTray-hosted
app project (tray + appMode WebView window + generated platform icon catalog +
absolute shell-free launch vector) with a pending-log pipeline and a success
dialog that can open the app and hints at taskbar/Dock pinning.
