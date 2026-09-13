---
"create-opentray": patch
---

Toolbar windows heal their navigation channel across manual toolbar-page reloads (⌘R).

- Previously a toolbar reload killed the page-side channel endpoint and left the host half talking to a corpse — every window button (back/forward/reload/address bar) silently died until app restart. The embedded toolbar carrier now observes the D11 close, debounces the burst (300 ms), recreates the channel to the toolbar target, reinstalls the command surface, and re-seeds the address bar; the page side was already idempotent. Teardown closes (window destroyed / session closed) never trigger a rebuild — the carrier is stopped before the window goes down.
