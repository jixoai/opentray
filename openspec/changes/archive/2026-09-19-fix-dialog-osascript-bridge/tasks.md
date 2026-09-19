# fix-dialog-osascript-bridge — tasks

## 1. Native bridge (crates/opentray-ext-dialog/src/macos/bridge.rs)

- [x] 1.1 Signature triage `alert_presentation_available()` — mirror
      ext-notification `bridge.rs` (SecCodeCopySelf +
      SecCodeCopySigningInformation, adhoc flag, conservative-true on FFI
      surprise), with unit seam.
- [x] 1.2 AppleScript statement composers for display dialog /
      choose file / choose folder / choose file name — positional
      `item N of argv` references only; option flags assembled from the
      same options structs the in-process path reads.
- [x] 1.3 Child spawn (`/usr/bin/osascript -e "on run argv" -e <stmt> -e
      "end run" -- <argv…>`, piped stdout, null stdin/stderr,
      `process_group(0)`) + `try_wait` stepping + stdout parsing
      (button title → index, POSIX path(s), cancel -128 → null /
      cancelId).
- [x] 1.4 Typed rejections: `bridge-buttons-limit` (>3 buttons),
      `bridge-mixed-selection-unsupported` (pickFile with
      includeDirectories) — synchronous pre-spawn failures on the
      original requestId.
- [x] 1.5 Unit tests: statement composition literal pins, parser table,
      triage seam (presentable → in-process; unsigned → fake bridge).

## 2. Integration (crates/opentray-ext-dialog/src/macos/mod.rs, lib.rs)

- [x] 2.1 `begin()` triage: available → in-process path; else bridge
      child spawn under the same `NativeModal` registry +
      DeferredOperation transaction (Accepted frame, poll steps child).
- [x] 2.2 `step()` handles the bridge variant (`try_wait` → Continue /
      Ended); result extraction parses stdout while structures are alive;
      session cleanup and drop kill the child.
- [x] 2.3 Replace the 0.31.1 activation comment with the
      signing-class law; `activateIgnoringOtherApps` stays on the
      in-process path (harmless, correct once the carrier is signed).
- [x] 2.4 Crate tests green (`cargo test -p opentray-ext-dialog`).

## 3. Verification

- [x] 3.1 Real-machine harness: staged local dylib, alert + messageDialog
      + pickers through the bridge, synthetic routed click resolves,
      form correct via AX tree (titled buttons, no stray slots).
- [x] 3.2 Panel (`example:hostAtoms`) Dialog submenu green on this host.

## 4. Docs + release

- [x] 4.1 skills/opentray/references/ext-dialog.md Platform Truth:
      darwin bridge fallback semantics + degradation list.
- [x] 4.2 AGENTS.md dialog law: presentation triage law line (sibling of
      the notification bridge ruling).
- [x] 4.3 Changeset (patch: fix). Issue #10 follow-up comment. Commit +
      push.
