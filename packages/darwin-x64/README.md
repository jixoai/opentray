# @opentray/darwin-x64

OpenTray runtime artifact package for macOS Intel.

This package is installed as an optional dependency by `opentray`. CI stages
one coherent Darwin runtime artifact set before npm publish:

- `bin/opentray`, the matching runtime executable
- `app/OpenTray.app.zip`, the shared AppKit carrier for process identity,
  activation policy, Dock participation, and privacy metadata

Source control does not commit either generated artifact. Applications obtain
the complete runtime through the normal package-manager install; they do not
need `@opentray/ext-badge` or a manually copied helper bundle.
