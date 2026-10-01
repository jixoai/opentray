---
"@opentray/ext-webview": minor
---

window regions: declarative `bindWindowRegion()` on `navigator.opentrayWindow`

Pages no longer hand-wire pointerdown handlers to drive native window chrome. `bindWindowRegion(target, behavior)` binds an element (or element array, selector string, or `{ root, selector }` for shadow roots) to native window behaviors:

- `'auto'` (default): platform caption semantics — move on press plus double-click zoom (maximize/restore toggle), both platforms.
- `'none'`: inert; `handle.setBehavior("none")` pauses without unbinding.
- `'move'` / `'zoom'`: individual caption behaviors for move-only reposition strips.
- `` `resize-${edge}` `` (`resize-top` … `resize-bottom-right`): element-bound resize handles for frameless windows. macOS gains a native soft-resize session (local event monitor driving `setFrame`) behind the same internal `startSoftResize` command Windows already serves; binding a resize behavior on a platform without support throws a `TypeError`.

Semantics: strict target matching — only presses whose target IS a bound element trigger behavior, so descendants keep their normal interactivity unless independently bound. Zoom pairing is per handle; selector matches are a bind-time snapshot; rebinding an element replaces its previous binding. `startAppRegionDrag()` remains the imperative primitive underneath. Nine new bootstrap probe tests pin the normalization, matching, pairing, resize-posting, and validation contracts.
