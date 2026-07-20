# @opentray/darwin-x64

OpenTray runtime artifact package for macOS Intel.

This package is installed as an optional dependency by `opentray`. CI stages
one coherent Darwin runtime artifact set before npm publish:

- `bin/opentray`, the matching runtime executable
- `app/Info.plist`, the minimal AppKit bundle template for process identity,
  activation policy, Dock participation, and privacy metadata. The runtime
  copies the matching broker into a stable caller-specific `.app` bundle.

Source control does not commit either generated artifact. Applications obtain
the complete runtime through the normal package-manager install; they do not
need `@opentray/ext-badge` or a manually copied helper bundle.
