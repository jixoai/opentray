# @opentray/ext-clipboard

Official OpenTray clipboard extension: system clipboard text atoms — read, write, and clear — for host-side callers (tray menu actions, background CLIs, moments without a visible page). Text a page can handle itself (`navigator.clipboard`) stays the page's job; there is no page bridge. v1 is UTF-8 text only.

## Role

- `attachClipboard(tray)` returns a session-scoped capability: `readText()` (resolves `null` when the board holds no text — the empty state is a first-class value, never an error and never `""`), `writeText(text)`, `clear()`, and an async `getBackend()` capabilities snapshot.
- `writeText` preflight before any transport use (frozen): the measurement unit is UTF-16 code units (`String.length`); a payload over 1 MiB (1,048,576 units) rejects typed `clipboard_payload_too_large` (`details: { lengthUtf16, limit }`); a lone surrogate rejects typed `clipboard_payload_invalid` (`details: { reason: "lone-surrogate", index }`) — replacement writes are forbidden because they would break read-back round-trip fidelity. `writeText("")` is legal; non-string payloads throw `TypeError`.
- `readText()` has no return-size cap (the local board is trusted input) and resolves `null` for a text-less board.
- The win32 lock discipline is built in: `OpenClipboard` retries only `ERROR_ACCESS_DENIED` inside a monotonic 2000 ms budget with the 10→20→40→80→160→200 ms backoff ladder; exhaustion rejects typed `clipboard_locked` (`details: { attempts, elapsedMs }`). Open→operate→Close closes within one command — no clipboard handle is held across commands.
- All methods on Linux reject typed `clipboard_platform_unsupported` before any dispatch. Unknown `attachClipboard` option fields throw instead of being silently ignored.
- Rejections surface as `ClipboardError` with a stable `code` from the frozen five-code family; backend error details pass through as-is. The shared transport-close code surfaces unchanged (the clipboard family defines no transport alias).

The shared schema (types, the frozen write bound, and the typed error family) lives in `@opentray/spec` and is re-exported here.

## Install

```bash
pnpm add opentray @opentray/ext-clipboard
```

## Typed Errors

| Code | Meaning | Details |
| ---- | ------- | ------- |
| `clipboard_platform_unsupported` | No native clipboard runtime for this platform (Linux). | `{ kind: "platform", platform }` |
| `clipboard_locked` | win32: the clipboard stayed locked by another process for the whole 2000 ms open budget. | `{ attempts, elapsedMs }` |
| `clipboard_unavailable` | A native clipboard API failed. | `{ osErrorCode }` |
| `clipboard_payload_too_large` | `writeText` payload exceeds 1,048,576 UTF-16 code units. | `{ lengthUtf16, limit }` |
| `clipboard_payload_invalid` | `writeText` payload contains a lone surrogate. | `{ reason: "lone-surrogate", index }` |

## Platform Matrix

| Capability | macOS | Windows |
| ---------- | ----- | ------- |
| Read | `NSPasteboard.string(forType:)` (nil → `null`) | `GetClipboardData(CF_UNICODETEXT)`, deep-copied before `CloseClipboard` (no text → `null`) |
| Write | `clearContents()` + `setString` (owner thread, AppKit-serialized) | `OpenClipboard` + `EmptyClipboard` + `SetClipboardData(CF_UNICODETEXT)` (HGLOBAL, UTF-16 NUL-terminated) |
| Clear | `clearContents()` | `OpenClipboard` + `EmptyClipboard` + `CloseClipboard` |
| Lock contention | None (AppKit serializes; `boundedOpenRetry: false`) | Bounded ACCESS_DENIED retry: 2000 ms budget, 10→20→40→80→160→200 ms ladder, then typed `clipboard_locked` (`boundedOpenRetry: true`) |
| `getBackend().maxWriteUtf16` | `1048576` (platform-independent constant) | `1048576` |
| Linux | `unsupported by design` (typed rejection before dispatch) | — |

## Packaging

The facade ships one embedded native package: `platforms/<target>/` libraries for darwin-arm64/x64 and win32-arm64/x64 plus the `platforms/manifest.json` identity chain — no `optionalDependencies` platform packages. Consumers never install or locate the native library manually.

Consumer guides live in the public `skills/opentray` documentation.
