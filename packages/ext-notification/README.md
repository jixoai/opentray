# @opentray/ext-notification

Official OpenTray notification extension: OS-standard title/body notifications for host-side callers (tray menu actions, background CLIs, moments without a visible page). There is no page bridge; v1 has no activation events, action buttons, inline replies, grouping, or custom sounds.

## Role

- `attachNotification(tray)` returns a session-scoped capability: `notify(options)`, `getAuthorizationStatus()`, `requestAuthorization()`, and an async `getBackend()` capabilities snapshot.
- `notify` is resolve-on-acceptance (the sound law): the promise resolves when the system accepts the notification for delivery; whether and when the user sees it is presentation policy, not acceptance.
- Payload bounds are frozen platform-independent common contract measured in UTF-16 code units (`String.length`), enforced in the facade before any dispatch, and never silently truncated: `title` non-empty ≤ 64, `body` ≤ 256, `subtitle` ≤ 64; violations reject typed `notification_payload_invalid` (`details: { field, lengthUtf16, limit }`). Unknown `NotifyOptions` fields reject the same way (`details: { field }`) — v1 has no platform namespace and no passthrough. Unknown attach option fields throw instead of being silently ignored.
- darwin authorization is real: `UNUserNotificationCenter`-backed status reads and requests settle as deferred transactions with a 10 s timeout (`notification_failed`, `details: { reason: "authorization-timeout" }`); a denied state makes `notify` reject typed `notification_denied` (`details: { status }`) with zero delivery calls, and acceptance linearizes against the cached last authorization snapshot for the session (never trusted across sessions).
- win32 is a documented always-granted degradation: authorization commands answer `granted`/`true` immediately. `notify` rides the consumer's own registered tray icon balloon/toast channel (`Shell_NotifyIcon(NIM_MODIFY, NIF_INFO)` on the existing `(HWND, uID)` registration) — no new window or identity atom; a scope without a live registered icon rejects typed `notification_tray_absent`. One balloon slot per icon: a later notification replaces the earlier one. `silent: true` projects `NIIF_NOSOUND`.
- win32 subtitle degradation: the facade joins the subtitle into the body as `subtitle + "—" + body` (em dash; a subtitle without a body stays alone), and the joined string is jointly validated against the 256-unit limit — an overflow rejects typed, never truncates.
- All methods on Linux reject typed `notification_platform_unsupported` before any dispatch.
- Rejections surface as `NotificationError` with a stable `code` from the frozen five-code family; backend error details pass through as-is. The shared transport-close code surfaces unchanged (the notification family defines no transport alias).

The shared schema (types, the frozen bounds, and the typed error family) lives in `@opentray/spec` and is re-exported here.

## Install

```bash
pnpm add opentray @opentray/ext-notification
```

## Typed Errors

| Code | Meaning | Details |
| ---- | ------- | ------- |
| `notification_platform_unsupported` | No native notification runtime for this platform (Linux). | `{ kind: "platform", platform }` |
| `notification_denied` | darwin: authorization is denied; zero delivery calls were made. | `{ status }` |
| `notification_payload_invalid` | Options shape/bounds failure (unknown field, bad type, empty title, over-limit, joined-body overflow on win32). | `{ field, lengthUtf16?, limit? }` |
| `notification_tray_absent` | win32 bridge: the command scope has no live registered tray icon channel. | bridge scope payload |
| `notification_failed` | Native failure or the 10 s darwin authorization timeout. | `{ reason }` (e.g. `"authorization-timeout"`) or an OS error code |

## Platform Matrix

| Capability | macOS | Windows |
| ---------- | ----- | ------- |
| Channel | `UNUserNotificationCenter` | Registered tray icon `Shell_NotifyIcon(NIM_MODIFY, NIF_INFO)` balloon/toast channel |
| `authorizationModel` | `user` (`granted`/`denied`/`notDetermined`; deferred, 10 s timeout) | `always-granted` (immediate `granted`/`true`, documented degradation) |
| `title` / `body` / `subtitle` limits | 64 / 256 / 64 UTF-16 units (platform-independent constants) | 64 / 256 / 64 UTF-16 units |
| `subtitle` | Native field (`supportsSubtitle: true`) | Joined into body as `subtitle—body` (`supportsSubtitle: false`); joined form ≤ 256 jointly validated |
| `silent` | Default = platform alert sound; `true` omits it | `NIIF_NOSOUND` when `true` |
| Concurrency | System notification-center policy | One balloon slot per icon: later replaces earlier (latest-state, not a queue) |
| Rendering | Notification Center (retention is system policy) | Toast on Win10+, classic balloon before; no action buttons, system-controlled duration |
| Linux | `unsupported by design` (typed rejection before dispatch) | — |

## Packaging

The facade ships one embedded native package: `platforms/<target>/` libraries for darwin-arm64/x64 and win32-arm64/x64 plus the `platforms/manifest.json` identity chain — no `optionalDependencies` platform packages. Consumers never install or locate the native library manually.

Consumer guides live in the public `skills/opentray` documentation.
