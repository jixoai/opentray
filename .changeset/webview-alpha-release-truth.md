---
"opentray": patch
"@opentray/ext-webview": patch
---

Clarify the current WebView platform maturity story across the published README surfaces and repo skills, distinguishing:

- macOS as the current stable human-visible runtime path
- Windows and Linux as alpha runtime territory even when platform packages exist
- typed `unsupported` results that are deliberate substrate truth
- `unavailable` results that only mean the current session lacks authoritative context

Add an alpha-channel publish path based on changesets snapshot versioning so prerelease testing can use `npm i opentray@alpha` without consuming the later stable version numbers.
