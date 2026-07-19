# Extension Verification

Use this reference as the final checklist for native extension work.

## Code Gates

Run the narrowest relevant tests first:

```bash
cargo test -p <native-crate>
pnpm --filter <facade-package> test
pnpm --filter opentray test
```

If the change touches loader behavior, also run `cargo test -p opentray-bin`.

If the extension depends on a carrier app that cannot be rebuilt locally, add a static packaging test for the owned metadata and resources so carrier regressions are still caught before CI.

## Artifact Gates

Build release artifacts and inspect them directly:

```bash
cargo build -p opentray-bin -p <native-crate> --release
wc -c target/release/opentray <native-library>
```

For macOS linkage:

```bash
otool -L target/release/opentray
otool -L <native-library>
```

If the split is correct, main-binary linkage should lose the extension runtime dependency, while the native library should gain it.

## Human-Visible Gates

If the extension changes visible behavior, run a real source-tree visual acceptance path, not only protocol tests:

```bash
OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1 pnpm --filter opentray example:debug-runtime-tray
pnpm --filter opentray example:webview-control
pnpm --filter opentray example:tray-panel
```

Use `OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1` or an equivalent extension-specific smoke path when the example supports it.

Lynx host-window verification belongs to the independent
[`jixoai/opentray-ext-lynx`](https://github.com/jixoai/opentray-ext-lynx) repository. Do
not run Lynx paths through the core workspace; use that repository's smoke and CI
carrier gates.

## Failure Interpretation

- Main binary still links runtime framework: split is fake or incomplete.
- Dylib stays tiny while main binary is huge: runtime likely still lives in the daemon.
- Demo passes only with a daemon-side special case: architecture regression.
- Platform lacks runtime support: return explicit unsupported/capability error, not fake success.
- Source looks correct but the carrier app still shows stale visuals: likely the dedicated runtime artifact was not rebuilt on CI yet.
