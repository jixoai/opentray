<!--
Orthogonal intents (maintained 2026-09-18; established by the add-ext-clipboard change):
1. Route package consumers to OS clipboard text atoms (read/write/clear) for host-side
   callers without a visible page.
2. Preserve platform truth: the frozen UTF-16 1 MiB write cap, the lone-surrogate
   rejection (never a silent replacement), the win32 locked-clipboard bounded retry,
   and Linux typed unsupported.
3. Keep the null empty-state first-class: an empty board is a value, not an error and
   not an empty string.
4. State the embedded packaging meaning for consumers: a normal install is complete.
-->

# ext-clipboard

Use this reference when the user asks how to read or write the system clipboard text
from a tray menu action, a background CLI, or any host-side moment without a visible
page. Text a page can handle itself (`navigator.clipboard`) stays the page's job; there
is no page bridge by design. v1 is UTF-8 text only — no images, no file lists, no
change listeners.

## Install

```bash
pnpm add opentray @opentray/ext-clipboard
```

The facade embeds its native libraries for macOS and Windows inside one package — a
normal package-manager install is the complete setup. There are no platform packages to
install and no native library to locate. Linux rejects typed
`clipboard_platform_unsupported`.

## Minimal Working Example

```ts
import { attachClipboard } from "@opentray/ext-clipboard";
import { createTray } from "opentray";

const tray = await createTray(
  { id: "com.example.tool", icon: { "text-only": "OT" } },
  { appId: "com.example.tool", appName: "Tool" }
);
const clipboard = attachClipboard(tray);

tray.onMenuClick(async ({ itemId }) => {
  if (itemId === 1) {
    const text = await clipboard.readText(); // string | null
    if (text !== null) console.log(text);    // null = board holds no text
  }
  if (itemId === 2) {
    await clipboard.writeText("copied from the tray");
  }
  if (itemId === 3) {
    await clipboard.clear();
  }
});
```

## Public Shape

```ts
import type { ClipboardCapability } from "@opentray/ext-clipboard";
```

The capability is session-scoped (`tray.extend` family) and exposes:

```ts
interface ClipboardCapability {
  readText(): Promise<string | null>;   // null when the board holds no text
  writeText(text: string): Promise<void>;
  clear(): Promise<void>;
  getBackend(): Promise<ClipboardBackendCapabilities>;
}
```

- `attachClipboard(tray, options?)` accepts only `mountId`, `artifact`, and `platform`
  (a test seam). An unknown option field throws `TypeError` — it is a programming
  error, never a silently ignored setting.
- `readText()` resolves `null` when the clipboard holds no text. That is the empty
  state — not an error, and not `""`. Every other path resolves the text verbatim with
  no size cap on the return value.
- `writeText("")` is legal: it writes an empty string (delivery semantics differ from
  `clear()` on darwin, so the two operations are not merged).
- `getBackend()` resolves one frozen immutable snapshot shared by every later call:

```ts
interface ClipboardBackendCapabilities {
  platform: "darwin" | "win32";
  textOnly: true;              // v1 is text-only; the format catalog is a v2 atom
  maxWriteUtf16: 1048576;      // frozen platform-independent write cap
  boundedOpenRetry: boolean;   // win32 = true (lock retry); darwin = false
}
```

## writeText Validation Rules (frozen)

All checks run in the facade before any dispatch; nothing is silently transformed.

- Non-string payloads throw `TypeError`.
- Measurement unit is UTF-16 code units — exactly `String.length`. Emoji already
  counted as their surrogate pairs need no adjustment.
- Payload longer than **1,048,576 UTF-16 code units (1 MiB)** rejects typed
  `clipboard_payload_too_large` with details `{ lengthUtf16, limit }`.
- A **lone surrogate** (an unpaired high or low unit, e.g. `"\uD83D"`) rejects typed
  `clipboard_payload_invalid` with details `{ reason: "lone-surrogate", index }` where
  `index` is the UTF-16 unit offset of the first offender. Replacement writes are
  forbidden because they would break read-back round-trip fidelity — normalize your
  strings yourself if they may contain sliced UTF-16.

## Platform Truth

- macOS: `NSPasteboard` on the owner thread; AppKit serializes access, so
  `boundedOpenRetry` is `false` and there is no retry path.
- Windows: classic clipboard-lock contention is real — another process may hold the
  clipboard while you dispatch. The extension retries `OpenClipboard` **only** when the
  failure is `ERROR_ACCESS_DENIED`, inside a monotonic **2000 ms total budget** with the
  backoff ladder 10→20→40→80→160→200 ms (capped). Any other open failure rejects
  immediately as `clipboard_unavailable`. When the budget is exhausted the command
  rejects typed `clipboard_locked` with details `{ attempts, elapsedMs }` (attempts
  counts the first try; elapsed includes native call time). You do not manage this
  retry — the extension owns it; surfaced `clipboard_locked` means the board was held
  for the entire budget.
- The Open→operate→Close sequence closes within a single command; no clipboard handle
  is ever held across commands.
- Linux: `unsupported by design` — every method rejects typed before any dispatch.

## Typed Errors

Every typed rejection is a `ClipboardError` with a stable `code` and structured
`details`; never parse the human message.

| Code | Meaning | Details |
| ---- | ------- | ------- |
| `clipboard_platform_unsupported` | No native clipboard for this platform (Linux). | `{ kind: "platform", platform }` |
| `clipboard_locked` | win32: the clipboard stayed locked by another process for the whole 2000 ms open budget. | `{ attempts, elapsedMs }` |
| `clipboard_unavailable` | A native clipboard API failed (win32 OS error; darwin surfaces 0 on its boolean-false paths). | `{ osErrorCode }` |
| `clipboard_payload_too_large` | `writeText` payload exceeds the frozen cap. | `{ lengthUtf16, limit }` |
| `clipboard_payload_invalid` | `writeText` payload contains a lone surrogate. | `{ reason: "lone-surrogate", index }` |

`readText` on an empty board resolves `null` — it never rejects and never returns `""`.
The shared transport-close code surfaces unchanged; the frozen clipboard family defines
no transport alias.
