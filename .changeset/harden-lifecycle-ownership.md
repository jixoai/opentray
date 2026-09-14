---
"create-opentray": patch
"opentray": patch
"@opentray/ext-webview": patch
"@opentray/packaging": patch
---

Fix the lifecycle-ownership failure family behind dead toolbar apps: owner-stamped self-healing bundle/launch locks (kill -9 never wedges a start again), owner-tuple-validated session destroy (a late cleanup can never destroy a newer same-tray session), connection-death terminates every SDK await and listener with a documented terminal surface (no zombie entries; generated apps exit non-zero instead of serving a dead shell), appId-derived broker endpoints (one endpoint per app across every launch method; display names never become path segments), and structured bootstrap milestone logging in app.log.
