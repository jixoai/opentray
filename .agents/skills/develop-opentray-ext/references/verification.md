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

If the extension changes visible behavior, run the real smoke path, not only protocol tests:

```bash
pnpm --filter opentray cli -- smoke daemon-tray
```

Use `OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1` or an equivalent extension-specific smoke path when the example supports it.

## Failure Interpretation

- Main binary still links runtime framework: split is fake or incomplete.
- Dylib stays tiny while main binary is huge: runtime likely still lives in the daemon.
- Demo passes only with a daemon-side special case: architecture regression.
- Platform lacks runtime support: return explicit unsupported/capability error, not fake success.
