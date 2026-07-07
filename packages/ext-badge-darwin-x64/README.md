# @opentray/ext-badge-darwin-x64

macOS x64 native package for `@opentray/ext-badge`.

This package stages two Darwin-owned artifacts:

- `lib/libopentray_ext_badge.dylib` for the OpenTray dynamic extension ABI
- `app/OpenTrayBadgeHelper.app.zip` for the Dock-facing helper bundle

The helper is intentionally separate from the OpenTray runtime host. It currently projects badge
text, overlay, attention, and click/quit lifecycle only; progress is not a Dock projection on this
helper.

## Build

```bash
bash scripts/release/build-badge-dock-helper.sh /tmp/OpenTrayBadgeHelper.app.zip
```

## Runtime knobs

- `OPENTRAY_BADGE_DOCK_TITLE`
- `OPENTRAY_BADGE_DOCK_BADGE`
- `OPENTRAY_BADGE_DOCK_ICON_NAME`
- `OPENTRAY_BADGE_DOCK_ICON_PATH`
- `OPENTRAY_BADGE_DOCK_CLICK_SIGNAL`
- `OPENTRAY_BADGE_DOCK_LOG`

The helper stays source-only in git. The app bundle is staged locally or in release jobs.
