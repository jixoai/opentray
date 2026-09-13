---
"create-opentray": patch
---

`--open` (and the wizard's Open App action) now replace a live instance of the same application instead of racing it into `OPENTRAY_BROKER_SINGLE_SESSION`.

- A Dock-pinned carrier can cold-start the generated entry after the original instance exited; when another launch then starts, both collided on the broker session — the late-comer died and the resurrected instance could hold a stale shell server with dead window buttons. Opens now probe live entry instances by argv identity (`<payload>/main.mjs`), stop the process tree, and wait bounded for PID release before spawning (Dev Launch Law replace semantics).
- The generated entry itself yields cleanly when a carrier cold-start hits `OPENTRAY_BROKER_SINGLE_SESSION`: the evidence lands in `app.log`, the supervised command (command applications) is taken down, and the launcher exits 0 — no retry, no empty tray shell. Already-frozen payloads keep the old behavior; regenerate to pick up the fix.
