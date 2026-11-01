---
"opentray": patch
---

Never reuse or signal a recycled PID. The daemon lifecycle now proves that a live PID's executable still matches the broker recorded in `ready.json` before it reuses the broker, stops it, or reports it as running. On Windows, where PIDs are reused aggressively, a stale `ready.json` could otherwise make a new launch skip broker startup and fail with `connect ENOENT` on the named pipe, or send `SIGTERM` to an unrelated process after the broker install path changes. When a supposedly healthy start has no listening endpoint, the client now restarts the daemon once instead of failing outright.
