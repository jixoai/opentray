## OpenTray Lynx Runtime Host

This directory is the source of truth for the macOS Lynx host app carrier used by `@opentray/ext-lynx`.

- OpenTray owns this app layer: `BUILD.gn`, app bundle metadata, menu resources, host bridge code, and runtime launch behavior.
- Upstream Lynx is still reused for the shared runtime library, embedder APIs, devtools resources, and resource bundles.
- `scripts/release/build-lynx-runtime.sh` copies this tree into the ephemeral upstream checkout before running the proven Lynx GN/Xcode build path in CI.

The runtime artifact produced from this source root is `OpenTrayLynxRuntime.app.zip`.
