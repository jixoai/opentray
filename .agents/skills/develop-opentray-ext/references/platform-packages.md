# Platform Packages

Use this reference when creating or updating `packages/ext-<name>-<os>-<arch>` or their CI/publish flow.

## Naming and Layout

Follow the existing atom pattern:

- Facade package: `@opentray/ext-<name>`
- Platform packages are capability-specific. Do not assume every extension supports every OpenTray daemon target.
  - `@opentray/ext-webview` currently publishes `darwin-arm64`, `darwin-x64`, `windows-arm64`, and `windows-x64` native packages only.
  - The core `opentray` daemon still publishes macOS, Linux, and Windows packages.
- Native artifact path:
  - macOS: `lib/libopentray_ext_<name>.dylib`
  - Windows: `bin/opentray_ext_<name>.dll`

`packages/ext-<name>` should use `optionalDependencies` only on supported platform atoms and keep public API platform-neutral. Unsupported extension platforms should be explicit capability absence, not placeholder package shells.

## Source-Control Rule

Do not commit generated binaries. Package directories are distribution shells only. Populate `bin/` or `lib/` right before smoke or publish.

Local staging uses:

```bash
bun run scripts/binaries/stage-local.ts --kind webview --source target/release/libopentray_ext_webview.dylib
```

Use the target-specific `--package-os` and `--arch` flags when staging for a non-host target.

## CI Rule

The release workflow should:

1. build native artifacts with `cargo build --release`,
2. upload them as artifacts,
3. download them into the release job,
4. stage them into npm package directories,
5. validate the real packed tarball with `pnpm pack` plus tar inspection,
6. publish via trusted publishing.

The repo already demonstrates this shape in `.github/workflows/release.yml`.

## Protocol-Line Tag Rule

Extension platform packages are distribution atoms in the same OpenTray protocol line as their facade and compatible core package.

- Use the OpenTray-wide tags `stable-A-B` / `alpha-A-B`; do not mint extension-specific tags such as `stable-webview-1-0`.
- Replace `A-B` with the current line from `@opentray/spec`; same-major newer minor bumps stay in the same extension-agnostic closure.
- A facade package such as `@opentray/ext-webview` and its platform packages must be tagged together for a compatible package closure.
- The tag is an install-time selector only. Runtime compatibility is still enforced by the broker handshake and dynamic extension ABI version.

## Package Bootstrap

When introducing a new package atom, use the existing bootstrap helper instead of hand-writing every manifest:

```bash
bun run scripts/npm/bootstrap-package.ts --package @opentray/ext-foo-darwin-arm64 --kind extension-platform --create-workspace --yes
```

Read `bun run scripts/npm/bootstrap-package.ts --help` first. The helper can scaffold package shells and optionally configure trusted publishing once the package exists on npm.
