---
"opentray": minor
"@opentray/packaging": minor
---

Add a stable Darwin app launch command that remembers the latest caller invocation or executes an explicit shell-free command vector when the app bundle is reopened. Live Dock activation now restores and focuses the most recently active retained app-mode WebView without executing the cold launch command. Persist carrier and broker diagnostics for failed relaunches, converge stale same-app bundles, and recover daemon startup automatically when an interrupted caller leaves a stale broker lock.
