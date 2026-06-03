---
"opentray": patch
"@opentray/ext-lynx": patch
---

Replace the borrowed `LynxExplorer.app` carrier with the OpenTray-owned `OpenTrayLynxRuntime.app.zip` host path for macOS Lynx releases.

The published `opentray` CLI now carries a package-owned Lynx review bundle, so `opentray smoke daemon-lynx` can serve as the final human audit command after installing from npm without requiring a workspace checkout path.
