---
"@opentray/ext-webview": patch
---

Rewrite the `@opentray/ext-webview` "First Panel" example to the current executable-host model. The previous example imported `runTrayApp` from the `opentray/node` subpath, but both were removed in the v0.10 `drop Node runtime binding and ship the executable host` refactor: `opentray/node` no longer exists in the package `exports`, and the runtime ships as a packaged executable (`bin/opentray`) that `createTray()` spawns on demand. The README now teaches the supported path — `createTray()` from the `opentray` root entry, with runtime identity passed through the second argument — and documents that application code does not host a native main loop or worker.
