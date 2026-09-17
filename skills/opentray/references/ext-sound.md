<!--
Orthogonal intents (maintained 2026-09-18; established by the add-ext-sound change):
1. Route package consumers to OS-standard sound feedback atoms (beep, named system sounds,
   low-cost file playback) for host-side callers without a visible page.
2. Preserve platform truth: darwin degraded beep levels, win32 WAV-only playback, the frozen
   common-name table, and Linux typed unsupported.
3. Keep the typed miss semantics explicit: a wrong name rejects, never a silent no-op and
   never a fallback to the default sound.
4. State the embedded packaging meaning for consumers: a normal install is complete.
-->

# ext-sound

Use this reference when the user asks how to play OS-standard feedback sounds from a tray
menu action, a background CLI, or any host-side moment without a visible page. Sounds a page
can play itself (HTMLAudioElement) stay the page's job; there is no page bridge by design.

## Install

```bash
pnpm add opentray @opentray/ext-sound
```

The facade embeds its native libraries for macOS and Windows inside one package — a normal
package-manager install is the complete setup. There are no platform packages to install and
no native library to locate. Linux rejects typed `sound_platform_unsupported`.

## Public Shape

```ts
import { attachSound } from "@opentray/ext-sound";
import { createTray } from "opentray";

const tray = await createTray(
  { id: "com.example.tool", icon: { "text-only": "OT" } },
  { appId: "com.example.tool", appName: "Tool" }
);
const sound = attachSound(tray);

tray.onMenuClick(async ({ itemId }) => {
  if (itemId === 1) await sound.beep();              // default system beep
  if (itemId === 2) await sound.playSystemSound("notification");
  if (itemId === 3) {
    try {
      await sound.playSound("./assets/done.wav");
    } catch (error) {
      // typed SoundError — see below; never a silent no-op
    }
  }
});
```

The capability is session-scoped (`tray.extend` family) and exposes:

- `beep(kind?)` — `default` / `info` / `warning` / `error` / `question`
- `playSystemSound(name)` — a common name from the frozen table or a platform-native sound name
- `playSound(path)` — low-cost file playback
- `getBackend()` — async frozen capabilities snapshot (`fileFormats` is a v1 promise set, not
  an open runtime list)

All methods resolve when playback is accepted (the native call was taken), not when it
completes; there are no completion events. `playSound` carries no options in v1.

## System Sound Resolution

The frozen common-name table (closed; new names do not join it):

| Common name | macOS | Windows |
| ----------- | ----- | ------- |
| `notification` | `Glass` | `SystemAsterisk` |
| `warning` | `Sosumi` | `SystemExclamation` |
| `error` | `Basso` | `SystemHand` |

Anything else passes through as a platform-native sound name (macOS `NSSound` catalog names,
Windows registry sound-scheme names). A miss rejects typed `sound_not_found` with a details
payload naming the request, platform, and attempted resolution stages — never a silent no-op,
never a fallback to a default sound. `default`/`info`/`question` belong to `beep` only.

## Platform Truth

- macOS: all non-default `beep` kinds degrade to the plain system beep (documented
  degradation — macOS has no leveled alert sound); `playSound` accepts the v1 promise set
  wav/aiff/mp3/m4a with no structural content validation.
- Windows: `beep` maps to the five `MessageBeep` levels. `playSound` accepts WAV only — the
  facade structurally validates the file (RIFF/WAVE magic, declared size fits the actual
  bytes, complete `fmt`/`data` chunks, 12-byte minimum, 64 MiB cap, no decoding) and rejects
  typed `sound_format_unsupported` before any playback. One file at a time sounds: a new
  playback cancels the previous one (win32 single-channel semantics).
- Linux: `unsupported by design` — every method rejects typed before any dispatch.

## Typed Errors

Every rejection is a `SoundError` with a stable `code`; never parse the human message.

| Code | Meaning |
| ---- | ------- |
| `sound_platform_unsupported` | No native sound runtime for this platform (Linux). |
| `sound_not_found` | The requested system sound name does not resolve (details carry the attempted stages). |
| `sound_format_unsupported` | win32 structural WAV validation failed. |
| `sound_file_unreadable` | The file path does not canonicalize or cannot be read. |

The shared transport-close code surfaces unchanged; the frozen sound family defines no
transport alias.
