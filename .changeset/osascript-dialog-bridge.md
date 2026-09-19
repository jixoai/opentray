---
"@opentray/ext-dialog": patch
---

darwin: dialogs present through the osascript bridge fallback on unsigned carriers (issue #10 round 2).

macOS 26 gates interactive dialog presentation by the carrier's
code-signing class (empirical isolation matrix 2026-09-19): the
in-process NSAlert/panel of an ad-hoc/linker-signed carrier renders in
the degenerate form (untitled stacked button slots, stray help button,
`<`-prefixed suppression placeholder) and never receives any click —
human or routed-synthetic — under every activation strategy; the 0.31.1
activation-only fix is retired (`activateIgnoringOtherApps` cannot
change a signing class). Every show command now triages the process
signature (same SecCode family as the ext-notification bridge): a
properly signed carrier keeps the full in-process AppKit experience;
unsigned/ad-hoc carriers present through the Apple-signed
`/usr/bin/osascript` host (`display dialog`, `choose file/folder/file
name`) inside the same DeferredOperation transaction — spawn is the
Accepted frame, child exit is the terminal, session cleanup kills the
child, and every payload crosses as run ARGV, never AppleScript literal
interpolation. Documented bridge degradations: `detail` folds into the
message, `suppressionLabel` resolves `suppressed: false`, filter names
drop (the extension union applies), bridge dialogs carry the osascript
host icon. More than three buttons and mixed file+directory selection
reject typed (`dialog_presentation_failed` with
`reason: "bridge-buttons-limit"` / `"bridge-mixed-selection-unsupported"`)
— never a silent clamp. Real-machine evidence: standard form restored,
routed clicks resolve (alert one-button, three-button index mapping,
picker cancel → null), zero orphan processes.
