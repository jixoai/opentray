---
"opentray": patch
"@opentray/darwin-arm64": patch
"@opentray/darwin-x64": patch
"@opentray/linux-arm64": patch
"@opentray/linux-x64": patch
"@opentray/windows-arm64": patch
"@opentray/windows-x64": patch
---

Ship the core OpenTray runtime as host-loadable Node binding artifacts staged at `runtime/opentray_runtime.node`, expose Node-side runtime binding resolution diagnostics, and add an explicit headless binding transport for protocol/session runtime checks.
