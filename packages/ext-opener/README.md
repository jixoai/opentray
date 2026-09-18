# @opentray/ext-opener

Official OpenTray opener extension: open URLs and absolute file paths with the user's default application, or reveal them in the file manager — host-side atoms for tray menu actions, background CLIs, and moments without a visible page. v1 has no application picker, no default-app queries, and no deep-link return values.

## Role

- `attachOpener(tray)` returns a session-scoped capability: `open(target)`, `revealInFolder(path)`, and an async `getBackend()` capabilities snapshot.
- `open`/`revealInFolder` are resolve-on-acceptance: they resolve when the native call is taken; whether and when the target application presents is not part of the acceptance semantics. Neither method takes options in v1 (reserved empty options objects); unknown option fields throw instead of being silently ignored, as do unknown `attachOpener` option fields and non-string/empty target strings.
- Legal targets dispatch **verbatim** — no rewriting, no normalization, no existence probing. The native side re-runs the same frozen preflight as defense in depth (identical codes and details), so raw envelopes cannot bypass it.
- Rejections surface as `OpenerError` with a stable `code` from the frozen four-code family; backend error details pass through as-is. The shared transport-close code surfaces unchanged (the opener family defines no transport alias).

The shared schema (types, the frozen scheme allowlist, and the typed error family) lives in `@opentray/spec` and is re-exported here.

## Install

```bash
pnpm add opentray @opentray/ext-opener
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

## Target resolution (frozen preflight matrix)

- Absolute file paths dispatch verbatim. POSIX paths start with `/`; win32 forms are `[A-Za-z]:[\\/]…` (e.g. `C:\x`) and UNC (`\\server\share\…`). A win32 drive-relative form (`C:x`, no separator) rejects typed with reason `"drive-relative"`. `\\?\`-prefixed paths pass through literally — normalization is the caller's responsibility, and this layer rejects semantically ambiguous input instead of guessing. Existence is NOT an acceptance precondition: not-yet-existing or unreadable paths still dispatch and surface native rejections as `opener_failed`.
- URL targets (`new URL()`-parseable with a protocol) must pass the frozen v1 scheme allowlist `http`/`https`/`file`/`mailto` (case-insensitive — `HTTPS://` passes). Every other scheme rejects typed `opener_scheme_blocked` with the scheme in `details`. `file:` URLs pass as-is — they are never normalized to paths; callers who mean a path should pass the absolute path itself.
- Everything else (relative paths, protocol-less strings) rejects typed `opener_target_invalid` with `details.reason` (`relative`, `drive-relative`, `path-quote`, or `path-control-char`).
- The allowlist ships frozen: widening it is a future additive change; tightening would break existing callers.

## revealInFolder

Requires an absolute path (darwin: POSIX `/…`; win32: drive/UNC absolute forms). The frozen rejection set (reject, never escape): a path containing a quote (`"`) rejects with reason `"path-quote"`; NUL or any C0 control character (0x00–0x1F) rejects with reason `"path-control-char"` — the win32 `/select,<path>` construction passes one quoted argument with no user-controlled gap, and rejecting metacharacters is frozen policy because an escaping matrix is a standing attack surface. Exactly one trailing separator is trimmed only when the trimmed result is still a legal absolute path (`C:\foo\` → `C:\foo`, `/foo/` → `/foo`; POSIX trims only `/`, win32 either separator); roots (`/`, `C:\`, `\\server\share\`, `\\?\` drive/UNC roots) are never trimmed — revealing a root opens the root itself (win32 `explorer <root>` without `/select`; darwin Finder with the root URL). darwin projects `NSWorkspace.activateFileViewerSelectingURLs([url])` — a void call, accepted by definition, with no parameter injection surface.

## Typed errors

Consumers match on `error.code` (`OpenerError`); `message` is not a contract.

| Code | Details |
| --- | --- |
| `opener_platform_unsupported` | `{ kind: "platform", platform }` (Linux, before any broker frame) |
| `opener_target_invalid` | `{ reason: "relative" \| "drive-relative" \| "path-quote" \| "path-control-char" }` |
| `opener_scheme_blocked` | `{ scheme }` (lowercased canonical form) |
| `opener_failed` | win32: `{ shellExecuteResult, reason? }` (SE result code and mapped `SE_ERR_*` name); darwin: `{ osError: true }` |

win32 acceptance is frozen as a `ShellExecuteW` return value greater than 32; anything at or below 32 rejects with the integer result and, when the value is a documented table member, the mapped lowercase reason (`filenotfound`, `pathnotfound`, `accessdenied`, `noassoc`, `outofmemory`, `share`, …). darwin acceptance uses the `NSWorkspace.open` boolean as the oracle; `false` rejects with `{ osError: true }`.

## Platforms

| Capability | macOS | Windows |
| ---------- | ----- | ------- |
| `open` (URL) | `NSWorkspace.open(url)` — boolean is the acceptance oracle | `ShellExecuteW("open", url)` — result > 32 is acceptance |
| `open` (path) | `NSWorkspace.open(URL(fileURLWithPath:))` from the raw string | `ShellExecuteW("open", path)` |
| `revealInFolder` | `NSWorkspace.activateFileViewerSelectingURLs([url])` (void = accepted) | `explorer.exe /select,<path>` (or `explorer <root>` for roots) |
| `getBackend().allowedSchemes` | `["http","https","file","mailto"]` (frozen) | `["http","https","file","mailto"]` (frozen) |
| Linux | `unsupported by design` (typed rejection before any broker connection) | — |

## Packaging

The facade ships one embedded native package: `platforms/<target>/` libraries for darwin-arm64/x64 and win32-arm64/x64 plus the `platforms/manifest.json` identity chain — no `optionalDependencies` platform packages. Consumers never install or locate the native library manually.

Consumer guides live in the public `skills/opentray` documentation.
