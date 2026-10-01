---
"opentray": patch
---

Win32 tray icon fidelity: pixel-sourced icons now register at the tray's physical slot size (premultiplied area-average downscale) instead of leaving a full-resolution bitmap to the shell's cheap stretch, and `isTemplate` is honored on Windows — the glyph re-tints to the current taskbar theme and follows system theme flips (`WM_SETTINGCHANGE`).
