# @opentray/ext-opener

Official OpenTray native opener extension: open URLs and absolute file paths
with the user's default application, or reveal them in the file manager.

```bash
pnpm add @opentray/ext-opener
```

## API

```ts
import { attachOpener } from "@opentray/ext-opener";

const opener = attachOpener(tray);

await opener.open("https://example.com");        // default browser (resolve-on-acceptance)
await opener.open("/tmp/report.txt");            // default application for the file
await opener.revealInFolder("/tmp/report.txt");  // locate in Finder / Explorer
const backend = await opener.getBackend();       // { platform, allowedSchemes, supportsRevealInFolder }
```

`open` and `revealInFolder` resolve on acceptance (the native call was
taken); when or whether the target application presents is not part of the
acceptance semantics. Neither method takes options in v1.

## Target resolution (frozen preflight matrix)

- Absolute file paths dispatch verbatim. POSIX paths start with `/`; win32
  forms are `[A-Za-z]:[\\/]…` (e.g. `C:\x`) and UNC (`\\server\share\…`).
  A win32 drive-relative form (`C:x`, no separator) rejects typed with
  reason `"drive-relative"`. `\\?\`-prefixed paths pass through literally —
  normalization is the caller's responsibility. Existence is NOT an
  acceptance precondition: not-yet-existing or unreadable paths still
  dispatch and surface native rejections as `opener_failed`.
- URL targets (`new URL()`-parseable with a protocol) must pass the frozen
  v1 scheme allowlist `http`/`https`/`file`/`mailto` (case-insensitive —
  `HTTPS://` passes). Every other scheme rejects typed
  `opener_scheme_blocked` with the scheme in `details`. `file:` URLs pass
  as-is — they are never normalized to paths.
- Everything else (relative paths, protocol-less strings) rejects typed
  `opener_target_invalid` with `details.reason` (`relative`,
  `drive-relative`, `path-quote`, or `path-control-char`).

## revealInFolder

Requires an absolute path. The frozen rejection set (reject, never escape):
a path containing a quote (`"`) rejects with reason `"path-quote"`; NUL or
any C0 control character (0x00–0x1F) rejects with reason
`"path-control-char"`. Exactly one trailing separator is trimmed only when
the trimmed result is still a legal absolute path (`C:\foo\` → `C:\foo`,
`/foo/` → `/foo`); roots (`C:\`, `/`, `\\server\share\`) are never trimmed —
revealing a root opens the root itself.

## Typed errors

Consumers match on `error.code` (`OpenerError`); `message` is not a contract.

| Code | Details |
| --- | --- |
| `opener_platform_unsupported` | `{ kind: "platform", platform }` (Linux, before any broker frame) |
| `opener_target_invalid` | `{ reason: "relative" \| "drive-relative" \| "path-quote" \| "path-control-char" }` |
| `opener_scheme_blocked` | `{ scheme }` |
| `opener_failed` | win32: `{ shellExecuteResult, reason? }` (SE result code and mapped `SE_ERR_*` name); darwin: `{ osError: true }` |

win32 acceptance is frozen as a `ShellExecuteW` return value greater than
32; anything at or below 32 rejects with the integer result and, when the
value is a documented table member, the mapped reason (`noassoc`,
`filenotfound`, `accessdenied`, …).

## Platforms

darwin and win32 ship inside this package (`platforms/<target>/`); Linux
rejects typed before any broker connection. `getBackend()` answers the
frozen immutable snapshot
`{ platform, allowedSchemes: ["http","https","file","mailto"], supportsRevealInFolder: true }`.
