# Self Review

Date: 2026-06-04

## Verdict

The change is aligned with the intent document. `primaryEvent` is modeled as an additive role on a plain menu item and still routes through the existing `menuClick` event family.

## Law Review

- Platform update: public menu item data now carries an optional primary role; tray-icon backend projection compiles that role into a native tray-id to menu-id route.
- Kernel boundary: `opentray-core` preserves the role as menu data and routes backend-originated activation as `MenuClick`; it does not contain Windows/macOS/Linux gesture policy.
- Extension boundary: the WebView demo is only an acceptance consumer. No primary-event code imports or branches on ext-webview.
- Event law: no public `trayPrimaryClick` event was added. The owning session receives the same `menuClick` shape as normal menu selection.

## Evidence

- `bun run openspec:vision -- validate add-tray-primary-event`
- `pnpm --filter @opentray/spec test`
- `pnpm --filter opentray test`
- `pnpm --filter opentray exec tsc --noEmit`
- `cargo test -p opentray-spec -p opentray-core -p opentray-backend-tray-icon`
- `cargo check -p opentray-bin`
- `rg -n "windows|macos|darwin|linux|primary.*webview|webview.*primary|trayPrimary|primaryEvent|primary_event" crates/opentray-core/src`
- `git diff --check`
- `OPENTRAY_EXAMPLE_EXIT_AFTER_MS=2000 OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=show pnpm --filter opentray cli -- smoke daemon-tray`

The daemon tray smoke declares exactly one native menu item, `Open WebView`, with `primaryEvent: true`. That keeps the manual macOS path pure: clicking the status item should direct-trigger the item instead of opening a menu first.

Follow-up manual testing found that configuring left-click behavior is not enough on macOS when an `NSMenu` is attached to the `NSStatusItem`. The native runtime now detaches native menu chrome for macOS single-primary mode and routes the click through `TrayIconEvent` instead.

## Reopened Issues

None.

One bug was found during verification: Rust `MenuItem::Item.primary_event` serialized as `primary_event` instead of protocol `primaryEvent`. The model now pins the wire name explicitly and has a default-false regression test.
