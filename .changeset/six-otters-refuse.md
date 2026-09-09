---
"@opentray/ext-webview": patch
---

darwin: skip no-op activation-policy assertions in the webview event drain path. Every ~60Hz drain tick called `set_activation_policy`, which unconditionally re-set the application icon and re-rendered the Dock tile (`setApplicationIconImage` + `dockTile().display()` → vImage resample + Display P3 conversion), burning a steady 50–80% of one core per broker even for a fully static window. The policy target is now compared against AppKit's current value first: unchanged policy returns early, while real Accessory↔Regular transitions keep the existing icon-preservation-and-tile-invalidation law. Runtime icon mutations (setAppIcon) are unaffected — they carry their own explicit Dock-tile refresh in the tray-icon backend.
