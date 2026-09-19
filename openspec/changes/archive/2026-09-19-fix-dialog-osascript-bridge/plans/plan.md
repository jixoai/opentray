# fix-dialog-osascript-bridge — Intent Document (SSOT)

## Problem

Issue #10 (round 2, 2026-09-19): on real macOS hosts every ext-dialog modal
renders in a degenerate form (vertical stacked buttons, untitled extra button
slots, a stray help "?" button, `<`-prefixed suppression placeholder,
desaturated default button) and NO click ever reaches it — the facade promise
hangs forever. The 0.31.1 fix (`activateIgnoringOtherApps(true)` before
`beginModalSessionForWindow`) does not work: the Owner's physical clicks and
routed synthetic clicks are both lost, and `frontmost` never flips.

## Empirical root cause (isolation matrix, 2026-09-19, macOS 26.5)

Every in-process NSAlert variant fails identically: unbundled CLI child,
bundled `.app`, LaunchServices-launched bundle, Accessory policy, Regular
policy, no activation, `activateIgnoringOtherApps`, Regular-bump,
window-level full stack (`makeKeyAndOrderFront` + `orderFrontRegardless` +
activate re-assert), classic blocking `runModal`, modal-session stepping,
activation-before-build. A minimal 40-line Swift probe reproduces the exact
degenerate form + dead clicks — the broker/carrier is NOT the variable.

Control: `/usr/bin/osascript`'s `display dialog` (Apple-signed host) renders
the standard alert form and a routed click resolves it immediately
(`button returned:OK`), even while non-frontmost. The running broker carrier
and the probe are both `ad-hoc, linker-signed` (codesign evidence).

Conclusion: macOS 26 gates interactive dialog presentation by the
process's code-signature class — the same law family as the UN notification
refusal (empirical matrix 2026-09-18) that produced the Owner-ruled
osascript bridge fallback for ext-notification.

## Decision (Owner precedent applied: osascript bridge fallback)

Mirror the ext-notification darwin bridge law for ext-dialog:

1. **Signature triage** at each dialog begin: the same
   `SecCodeCopySelf` + `SecCodeCopySigningInformation` self-check.
   A properly signed carrier keeps the full in-process NSAlert/panel path.
   Unsigned/ad-hoc carriers present through `/usr/bin/osascript` bridges.
   Unexpected FFI failure → conservative in-process path.
2. **Bridge mappings** (payload as `run` ARGV only — never AppleScript
   string-literal interpolation; the notification bridge law):
   - `messageDialog` → `display dialog` (buttons 1-3, default button,
     cancel button via error -128 catch, severity icon note/caution/stop,
     title). Degradations: `detail` folds into the message text with a
     blank line; `suppressionLabel` is not expressible (result
     `suppressed` is `false`); more than 3 buttons is a typed
     `dialog_presentation_failed` (`reason: "bridge-buttons-limit"`) —
     never a silent clamp.
   - `pickFile` → `choose file` (prompt from `title`/`darwin.panelMessage`,
     `defaultPath` → default location, filters → `of type` union of all
     extensions — name-only filters drop their name, `showsHidden` →
     invisibles, `multiple` → multiple selections allowed). Mixed
     files+directories selection is not expressible → typed
     `bridge-mixed-selection-unsupported`.
   - `pickDirectory` → `choose folder` (prompt, default location,
     invisibles).
   - `pickSavePath` → `choose file name` (prompt, default name from the
     `defaultPath` basename, default location from its parent).
     `filters`/`defaultFilterIndex`/`createDirectories` have no bridge
     knob — documented degradations.
   - Cancel (`error number -128`) resolves `null` for pickers and the
     `cancelId` index for messageDialog — the existing contracts.
3. **DeferredOperation transaction unchanged**: the bridge spawns the
   child at begin (Accepted frame); each `poll_owner` quantum
   `try_wait`s the child; child exit is the modal-Ended event; the
   terminal parses the child's stdout. Session cleanup kills the child.
   Bridge dialogs attribute to the osascript host icon (same documented
   degradation as notification banners).

## Non-goals

- No facade/API change (transparent platform projection).
- No new ABI symbols; no protocol change.
- Developer-ID signing guidance stays with the notification law's docs.

## Acceptance

- Real-machine: panel Dialog submenu scenarios on this ad-hoc host render
  through the bridge and resolve on real clicks (synthetic routed click +
  Owner acceptance).
- Unit: bridge statement composition pins (argv-only), result parsing
  (button title → index, POSIX paths, cancel -128), triage seams, typed
  rejections (>3 buttons, mixed selection).
- The 0.31.1-era comment claiming activation cures the degenerate form is
  replaced by this law.
