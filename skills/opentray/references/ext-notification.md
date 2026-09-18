<!--
Orthogonal intents (maintained 2026-09-18; established by the add-ext-notification change):
1. Route package consumers to OS-standard notifications (title/body) for host-side
   callers without a visible page.
2. Preserve platform truth: darwin UNUserNotificationCenter with real user authorization
   and 10s deferred-timeout semantics; win32 as an always-granted composition-layer
   bridge that rides the consumer's own registered tray icon channel; Linux typed
   unsupported.
3. Keep the frozen payload bounds explicit: 64/256/64 UTF-16 units platform-independent,
   never truncated, with the win32 subtitle join jointly validated.
4. State the embedded packaging meaning for consumers: a normal install is complete.
-->

# ext-notification

Use this reference when the user asks how to show an OS-standard notification from a
tray menu action, a background CLI, or any host-side moment without a visible page.
This is a host-side atom — there is no page bridge and v1 has no activation/click
events, no action buttons, no inline replies, no grouping, and no custom sounds
(`silent` toggles the platform default sound off).

## Install

```bash
pnpm add opentray @opentray/ext-notification
```

The facade embeds its native libraries for macOS and Windows inside one package — a
normal package-manager install is the complete setup. There are no platform packages to
install and no native library to locate. Linux rejects typed
`notification_platform_unsupported`.

## Minimal Working Example

```ts
import { attachNotification } from "@opentray/ext-notification";
import { createTray } from "opentray";

const tray = await createTray(
  { id: "com.example.tool", icon: { "text-only": "OT" } },
  { appId: "com.example.tool", appName: "Tool" }
);
const notification = attachNotification(tray);

tray.onMenuClick(async ({ itemId }) => {
  if (itemId === 1) {
    // First call on macOS may implicitly trigger the system authorization prompt.
    const granted = await notification.requestAuthorization();
    if (!granted) return;
    await notification.notify({
      title: "Export finished",
      body: "report.pdf is ready.",
      silent: false, // default: platform default alert sound
    });
  }
  if (itemId === 2) {
    const status = await notification.getAuthorizationStatus();
    // "granted" | "denied" | "notDetermined" ("notDetermined" is darwin-only)
  }
});
```

## Public Shape

```ts
import type { NotificationCapability, NotifyOptions } from "@opentray/ext-notification";
```

The capability is session-scoped (`tray.extend` family) and exposes:

```ts
type NotificationAuthorizationStatus = "granted" | "denied" | "notDetermined";

interface NotificationCapability {
  notify(options: NotifyOptions): Promise<void>;
  getAuthorizationStatus(): Promise<NotificationAuthorizationStatus>;
  requestAuthorization(): Promise<boolean>; // darwin: real decision; win32: always true
  getBackend(): Promise<NotificationBackendCapabilities>;
}

interface NotifyOptions {
  title: string;    // required, non-empty, <= 64 UTF-16 code units
  body?: string;    // <= 256 UTF-16 code units
  subtitle?: string; // <= 64; darwin native field; win32 degradation joins it into body
  silent?: boolean; // default false (platform default sound); true = no sound
}
```

- `notify` is **resolve-on-acceptance** (the sound law): the promise resolves when the
  system accepts the notification for delivery. Whether and when the user actually
  sees it is presentation policy, not acceptance.
- `attachNotification(tray, options?)` accepts only `mountId`, `artifact`, and
  `platform` (a test seam); an unknown option field throws `TypeError`.
- An unknown `NotifyOptions` field rejects typed `notification_payload_invalid` with
  details `{ field }` — v1 has no platform namespace and no passthrough fields, and
  nothing is silently ignored.
- `getBackend()` resolves one frozen immutable snapshot:

```ts
interface NotificationBackendCapabilities {
  platform: "darwin" | "win32";
  authorizationModel: "user" | "always-granted";          // darwin / win32
  channel: "user-notification-center" | "tray-icon-info"; // diagnostics-only projection
  titleLimitUtf16: 64;
  bodyLimitUtf16: 256;
  subtitleLimitUtf16: 64;
  supportsSubtitle: boolean;                              // win32 = false
}
```

## Payload Bounds (frozen, platform-independent)

The limits are one common contract on both platforms — taken from the win32 balloon
buffer's physical capacity so the same strings work everywhere. All counts are UTF-16
code units (`String.length`), all checks run in the facade before any dispatch, and
**nothing is ever silently truncated**.

| Field | Limit | Violation |
| ----- | ----- | --------- |
| `title` | 64 (must also be non-empty and a string) | `notification_payload_invalid`, details `{ field: "title", lengthUtf16, limit }` |
| `body` | 256 | `notification_payload_invalid`, details `{ field: "body", lengthUtf16, limit }` |
| `subtitle` | 64 | `notification_payload_invalid`, details `{ field: "subtitle", lengthUtf16, limit }` |
| `silent` | must be boolean when present | `notification_payload_invalid`, details `{ field: "silent" }` |

**win32 subtitle degradation:** win32 balloon titles have no subtitle field, so the
facade joins the subtitle into the body as `subtitle + "—" + body` (one em dash, no
spaces; a subtitle without a body is the subtitle alone — no dangling separator). The
**joined** string must satisfy the 256-unit limit; an overflow rejects typed
`notification_payload_invalid` with `field: "body"` and the joined length. Code against
the joined form when you use subtitles on win32, or omit subtitles for identical
rendering across platforms.

## Platform Truth

### macOS

- Channel is `UNUserNotificationCenter`; the caller-specific Darwin carrier `.app`
  bundle identity (which OpenTray materializes for you) is what makes it work — no
  extra setup.
- Authorization is real: `getAuthorizationStatus()` reads the system state
  (`notDetermined` before the user has decided), and `requestAuthorization()` resolves
  the user's decision. A first `notify` while `notDetermined` implicitly triggers the
  system prompt, then delivers.
- Both authorization commands are asynchronous native callbacks settled through a
  deferred transaction: if the system never answers, a **10 s timeout** rejects typed
  `notification_failed` with details `{ reason: "authorization-timeout" }`. A denied
  state makes `notify` reject typed `notification_denied` with details `{ status }` and
  performs **zero** delivery calls — never a silent drop.
- `notify` acceptance linearizes against the cached last authorization snapshot for the
  session: the first snapshot-less notify runs its authorization query inside the 10 s
  budget, then posts; later notifies reuse the snapshot. The snapshot never crosses
  sessions.
- Notification-center retention and presentation timing are system policy; v1 has no
  activation delegate.

### Windows

- There is **no authorization concept**: `getAuthorizationStatus()` resolves
  `"granted"` and `requestAuthorization()` resolves `true`, immediately — a documented
  always-granted degradation.
- `notify` rides **your own registered tray icon's** balloon/toast channel
  (`Shell_NotifyIcon(NIM_MODIFY, NIF_INFO)` on the same `(HWND, uID)` registration the
  tray already owns). No new window, no new identity atom, no AUMID/shortcut setup —
  and this is why the tray must be registered: `notify` on a scope with no live
  registered icon rejects typed `notification_tray_absent`. With a normal
  `createTray(...)` the icon always exists.
- Balloons render as toasts on Windows 10+ and classic balloons earlier; there are no
  action buttons, and duration is system policy.
- **One balloon slot per icon:** multiple notification mounts (or rapid successive
  `notify` calls) share the channel — the later notification replaces the earlier one.
  Treat win32 notifications as latest-state, not a queue.
- `silent: true` projects `NIIF_NOSOUND`; the default plays the platform default sound.

### Linux

`unsupported by design` — every method rejects typed before any dispatch.

## Typed Errors

Every typed rejection is a `NotificationError` with a stable `code` and structured
`details`; never parse the human message.

| Code | Meaning | Details |
| ---- | ------- | ------- |
| `notification_platform_unsupported` | No native notification runtime for this platform (Linux). | `{ kind: "platform", platform }` |
| `notification_denied` | darwin: authorization is denied; zero delivery calls were made. | `{ status }` |
| `notification_payload_invalid` | Options shape/bounds failure (unknown field, bad type, empty title, over-limit, joined-body overflow on win32). | `{ field, lengthUtf16?, limit? }` |
| `notification_tray_absent` | win32 bridge: the command scope has no live registered tray icon channel. | bridge scope payload |
| `notification_failed` | Native failure or the 10 s authorization timeout. | `{ reason }` (e.g. `"authorization-timeout"`) or an OS error code |

The shared transport-close code surfaces unchanged; the frozen notification family
defines no transport alias.

## Manual Acceptance

In the OpenTray source tree, `pnpm --filter opentray example:hostAtoms` runs the tray-menu
acceptance panel covering every notification API surface and typed rejection with console
evidence blocks (see `packages/cli/examples/EXAMPLE.md`, Host-Atoms Acceptance Panel).
