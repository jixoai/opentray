---
"create-opentray": minor
---

Follow-ups to the 0.25.0 multi-webview release:

- `WebviewWindowHandle.setTitle` is now implemented (through the compatible re-show title projection). It was called by generated command apps for the `(detached)` service-window marker but never existed on the handle — every call silently threw. Orchestrated (windowOnly) sessions repeat their bootstrap fact on the re-show.
- The opentray-spec raw-pointer FFI helpers (`write_owned_json`, `take_json`) are now `unsafe` with safety docs, clearing an error-level clippy lint that had been failing `cargo clippy` on main.
