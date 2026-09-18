<!--
Orthogonal intents (maintained 2026-09-18; established by the add-ext-opener change):
1. Route package consumers to the default-application opener atoms (open URL / absolute
   file path, reveal in file manager) for host-side callers without a visible page.
2. Preserve platform truth: the frozen scheme allowlist (relaxation is additive),
   verbatim path dispatch with no normalization, the reject-not-escape reveal set,
   the root-boundary trim law, and Linux typed unsupported.
3. Keep resolve-on-acceptance explicit: acceptance is the native call being taken, not
   the target application presenting.
4. State the embedded packaging meaning for consumers: a normal install is complete.
-->

# ext-opener

Use this reference when the user asks how to open a URL or a file with the user's
default application, or to reveal a file in Finder / Explorer, from a tray menu action
or any host-side moment. Pages own their own navigation; this extension is the
host-side `open` atom. v1 has no application picker, no default-app queries, and no
deep-link return values.

## Install

```bash
pnpm add opentray @opentray/ext-opener
```

The facade embeds its native libraries for macOS and Windows inside one package — a
normal package-manager install is the complete setup. There are no platform packages to
install and no native library to locate. Linux rejects typed
`opener_platform_unsupported`.

## Minimal Working Example

```ts
import { attachOpener } from "@opentray/ext-opener";
import { createTray } from "opentray";

const tray = await createTray(
  { id: "com.example.tool", icon: { "text-only": "OT" } },
  { appId: "com.example.tool", appName: "Tool" }
);
const opener = attachOpener(tray);

tray.onMenuClick(async ({ itemId }) => {
  if (itemId === 1) await opener.open("https://example.com");  // default browser
  if (itemId === 2) await opener.open("/tmp/report.txt");      // default app for the file
  if (itemId === 3) {
    try {
      await opener.revealInFolder("/tmp/report.txt");         // Finder / Explorer, selected
    } catch (error) {
      // typed OpenerError — see below
    }
  }
});
```

## Public Shape

```ts
import type { OpenerCapability } from "@opentray/ext-opener";
```

The capability is session-scoped (`tray.extend` family) and exposes:

```ts
interface OpenerCapability {
  open(target: string, options?: OpenOptions): Promise<void>;
  revealInFolder(path: string, options?: RevealInFolderOptions): Promise<void>;
  getBackend(): Promise<OpenerBackendCapabilities>;
}
```

- `open`/`revealInFolder` are **resolve-on-acceptance**: the promise resolves when the
  native call is taken. Whether and when the target application actually presents is
  not part of acceptance. A resolved `open` on a nonexistent path is possible by
  design — existence is not a precondition (see the target matrix).
- v1 carries no per-call options: `OpenOptions`/`RevealInFolderOptions` are reserved
  empty. An unknown field in them (or in `attachOpener` options beyond
  `mountId`/`artifact`/`platform`) throws `TypeError` — never a silently ignored
  setting. A non-string or empty target string also throws `TypeError`.
- `getBackend()` resolves one frozen immutable snapshot:

```ts
interface OpenerBackendCapabilities {
  platform: "darwin" | "win32";
  allowedSchemes: ["http", "https", "file", "mailto"]; // frozen v1 allowlist
  supportsRevealInFolder: true;
}
```

## open(target) — Frozen Target Matrix

Classification runs before any dispatch; legal targets are sent to the native side
**verbatim** — this layer never rewrites, normalizes, or expands anything.

| Target form | Result |
| ----------- | ------ |
| POSIX absolute `/tmp/report.txt` | Dispatched verbatim (`NSWorkspace.open(fileURLWithPath:)` / `ShellExecuteW("open", …)`). |
| win32 drive absolute `C:\x` or `C:/x` (`[A-Za-z]:[\\/]…`) | Dispatched verbatim. |
| UNC `\\server\share\…` | Dispatched verbatim (legal absolute). |
| `\\?\`-prefixed literal forms | Passed through literally — normalization is the caller's responsibility; this layer refuses semantically ambiguous input instead of guessing. |
| `file:` URL | Passed as-is — **never normalized into a path**. If you mean a path, pass the absolute path itself; URL decoding/encoding ambiguity is exactly why conversion is not done here. |
| Other URLs (`http:`, `https:`, `mailto:`, any case — `HTTPS://` passes) | Dispatched verbatim after the scheme gate below. |
| win32 drive-relative `C:x` (no separator after the colon) | Rejects typed `opener_target_invalid`, `details.reason: "drive-relative"` — the single-letter-colon form is a drive reference before any URL interpretation. |
| Relative path / protocol-less string (`notes/todo.txt`) | Rejects typed `opener_target_invalid`, `details.reason: "relative"`. |
| Any URL with a scheme outside the allowlist (`ssh:`, `chrome://`, custom handlers) | Rejects typed `opener_scheme_blocked`, `details: { scheme }`. |

**Scheme allowlist (frozen):** exactly `http`, `https`, `file`, `mailto`, matched
case-insensitively. Host-side opener input often comes from external data, and custom
scheme handlers have persistent-registration side effects, so v1 is deliberately
strict. Widening the list is a future additive change; tightening would break existing
callers — the list ships frozen.

**Existence is not an acceptance precondition.** A path that does not exist yet, or is
unreadable, still dispatches; the native rejection surfaces as typed `opener_failed`.
Opening a path that will appear later is not this layer's error to invent.

## revealInFolder(path) — Rejection Set, Trim Law, Root Boundary

Requires an absolute path (darwin: POSIX `/…`; win32: drive/UNC absolute forms — the
same matrix as `open`). Then, in order:

1. **Frozen rejection set — reject, never escape:** a path containing a quote (`"`)
   rejects with `details.reason: "path-quote"`; a path containing NUL or any C0
   control character (0x00–0x1F) rejects with `details.reason: "path-control-char"`.
   The win32 `explorer.exe /select,<path>` construction passes the path as one quoted
   argument with no user-controlled gap; rejecting metacharacters is frozen policy
   because an escaping matrix would be a standing attack surface.
2. **Root boundary (never trimmed):** POSIX `/`, win32 drive roots `C:\`/`C:/`, UNC
   roots `\\server\share\`, and `\\?\` drive/UNC roots are not trimmed — trimming would
   drift into drive-relative (`C:`) or the empty string. Revealing a root **opens the
   root itself** (win32: `explorer <root>` without `/select`; darwin: Finder with the
   root URL).
3. **Exactly-one trailing separator trim:** one trailing separator is trimmed only
   when the trimmed string is still a legal absolute path (`C:\foo\` → `C:\foo`,
   `/foo/` → `/foo`). POSIX trims only `/` (backslash is a legal filename character
   there); win32 trims either separator. A trim that lands on a root keeps
   open-the-root semantics.

darwin projects `NSWorkspace.activateFileViewerSelectingURLs([url])` — a void call,
accepted by definition, with no parameter injection surface. win32 acceptance for both
`open` and `/select` uses the `ShellExecuteW` result law below.

## Platform Truth

- **win32 acceptance law:** a `ShellExecuteW` return value **greater than 32** is
  acceptance (resolve). A value at or below 32 rejects typed `opener_failed` with
  details `{ shellExecuteResult: <int> }` plus, for documented table members, a mapped
  lowercase `reason` string (`"filenotfound"`, `"pathnotfound"`, `"accessdenied"`,
  `"noassoc"`, `"outofmemory"`, `"share"`, …). Unknown values carry no `reason`; the
  integer is always present.
- **darwin acceptance law:** the `NSWorkspace.open` boolean return is the oracle;
  `false` rejects typed `opener_failed` with details `{ osError: true }`.
- Linux: `unsupported by design` — every method rejects typed before any dispatch.
- The native side re-runs the same frozen preflight (defense in depth): identical
  rejections with identical details surfaces if a raw envelope bypassed the facade.

## Typed Errors

Every typed rejection is an `OpenerError` with a stable `code` and structured
`details`; never parse the human message.

| Code | Meaning | Details |
| ---- | ------- | ------- |
| `opener_platform_unsupported` | No native opener for this platform (Linux). | `{ kind: "platform", platform }` |
| `opener_target_invalid` | Target failed the frozen matrix. | `{ reason: "relative" \| "drive-relative" \| "path-quote" \| "path-control-char" }` |
| `opener_scheme_blocked` | URL scheme outside the frozen allowlist. | `{ scheme }` (lowercased canonical form) |
| `opener_failed` | The native call was rejected. | win32 `{ shellExecuteResult, reason? }`; darwin `{ osError: true }` |

The shared transport-close code surfaces unchanged; the frozen opener family defines
no transport alias.

## Manual Acceptance

In the OpenTray source tree, `pnpm --filter opentray example:hostAtoms` runs the tray-menu
acceptance panel covering every opener API surface and typed rejection with console
evidence blocks (see `packages/cli/examples/EXAMPLE.md`, Host-Atoms Acceptance Panel).
