---
"@opentray/spec": minor
"opentray": minor
"@opentray/darwin-arm64": minor
"@opentray/darwin-x64": minor
"@opentray/linux-arm64": minor
"@opentray/linux-x64": minor
"@opentray/windows-arm64": minor
"@opentray/windows-x64": minor
---

Publish the tray-first protocol

@opentray/spec is behind npm: the published 0.6.0 still carries the old
Space/Surface protocol, while the source has been reset to the tray-first app
protocol (App/Session/Tray, Icon projection refactor, runtime app identity in
health). opentray and the platform runtime packages already depend on the new
spec and ship the createTray SDK surface, so they move together.

Build-layer packages (@opentray/packaging, the vite/esbuild/tsdown/webpack
adapters) are versioned independently and are not part of this release.
