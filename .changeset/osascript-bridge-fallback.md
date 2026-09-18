---
"@opentray/ext-notification": minor
---

darwin: notifications present on unsigned carriers through the
osascript bridge fallback.

macOS 26 refuses UNUserNotificationCenter authorization for
ad-hoc/linker-signed apps in every launch shape (empirical isolation
matrix: direct-exec, LaunchServices launch, LSUIElement, accessory
AppKit — no prompt, no Settings entry, banners never present; a plist
key is not the variable). Every darwin notify now triages the running
process's code-signature class (SecCodeCopySelf +
SecCodeCopySigningInformation): a properly signed app keeps the full
UN-center experience; unsigned/ad-hoc carriers post through
/usr/bin/osascript's `display notification` (Apple-signed host, always
allowed) with title/body/subtitle passed as run ARGUMENTS — never
interpolated into AppleScript literals — and the default alert sound
unless silent. Acceptance stays resolve-on-acceptance (spawn success);
bridge banners attribute to the osascript host icon (documented
degradation). Authorization commands keep honest UN semantics; a
denied snapshot still rejects typed with zero delivery. Developers who
can sign get the full path by re-signing their carrier with a
Developer ID identity.
