---
"opentray": patch
---

Normalize transport-error connection death to the canonical `broker connection closed` terminal message on every platform: Linux delivers socket errors (ECONNRESET) before close while macOS delivers close first, so in-flight requests previously rejected with the raw transport message on Linux; the underlying error is now observable as the terminal error's `cause`.
