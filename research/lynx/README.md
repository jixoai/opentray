# Lynx Research

## Goal

Align Lynx with the same extension evolution path as `ext-webview`:

1. Prove the runtime works as a standalone native binary.
2. Then package the runtime as a platform dynamic library.
3. Finally let `opentray` load that library through the extension host law.

The current repository is only at step 1 for Lynx.

## Physical Environment Review

### What already exists

- A GitHub Actions probe builds upstream Lynx Explorer with `xcodebuild`:
  - `.github/workflows/lynx-xcodebuild.yml`
  - `scripts/research/lynx-xcodebuild-gha.sh`
- The probe now archives:
  - `LynxExplorer.app.zip`
  - bundle tree and size summaries
  - `Info.plist` summary
  - runtime smoke URL/process evidence

### What the current OpenTray host can do

- `crates/opentray-spec/src/ext.rs` already defines a C-compatible extension ABI surface.
- `openspec/specs/extension-host/spec.md` already states that dynamic extensions must use
  `extern "C"` and stable host callbacks.

### What the current OpenTray host cannot do yet

- `crates/opentray-core/src/extension.rs` still says:
  - `dynamic loading is not implemented for {name} at {path}`
- `crates/opentray-bin/src/main.rs` still uses a hardcoded `NativeWebviewLoader`.
- That loader only accepts:
  - `request.name == "webview"`
  - `request.path == "@opentray/ext-webview"`

This means the extension-host law exists in spec form, but the real dynamic-loader engine is
not yet materialized in the binary.

## Current Binary Proof

The current Lynx probe is intentionally shaped like `visual_webview`:

- build a real native executable (`LynxExplorer.app`)
- build a small launcher binary (`lynx-window-cli`)
- run a human-meaningful runtime path
- keep WebView/Lynx-specific dependencies outside `opentray-core`

Validated facts:

1. `xcodebuild` can produce `LynxExplorer.app`.
2. `cargo build -p opentray-lynx-window-cli --release` can produce a standalone launcher binary.
3. The app bundle and launcher binary can be archived and downloaded from CI.
4. `lynx-window-cli` can resolve `--bundle <path>` into a file URL, launch the Lynx runtime,
   and keep the process alive through a stability window.
5. The app can load an external `file://.../*.lynx.bundle` and stay alive through a stability
   window.

This is the correct P0 proof, because it verifies the runtime atom itself before binding it to
the still-incomplete extension host.

## Why jumping straight to `ext-lynx.dylib` is the wrong starting point

If Lynx is forced directly into a `.dylib` package right now, the work will couple two separate
unknowns:

1. whether the Lynx runtime atom itself is stable
2. whether the OpenTray host can actually load and drive a platform dylib correctly

That is exactly the kind of glue-first path we should avoid.

## Recommended Path

### Phase 1: Standalone binary probe

Status: done for macOS CI.

Target shape:

- same role as `crates/opentray-backend-tray-icon/examples/visual_webview.rs`
- a native, executable proof that can be observed and smoked independently

Current proof vehicle:

- upstream `LynxExplorer.app`
- `crates/opentray-lynx-window-cli`

Current invocation shape:

```bash
cargo run -p opentray-lynx-window-cli -- \
  --bundle /absolute/path/to/demo.lynx.bundle
```

Current CI artifact shape:

```text
research/lynx/artifacts/
  lynx-window-cli/
    lynx-window-cli
    LynxExplorer.app.zip
    runtime-smoke/homepage.main.lynx.bundle
```

### Phase 2: Generic dynamic-loader foundation

Status: not implemented.

Required law upgrade:

- replace the hardcoded `NativeWebviewLoader` path with a real extension loader
- resolve platform artifacts deterministically
- validate required `extern "C"` symbols
- bind host callbacks through the ABI in `opentray-spec`

This phase is not Lynx-specific. It is the shared law for future
`@opentray/ext-webview-darwin-arm64`, `@opentray/ext-lynx-darwin-arm64`, and similar packages.

### Phase 3: `ext-lynx-*` platform package

Status: blocked on phase 2.

Expected shape:

- platform package exports one dylib per OS/arch
- TypeScript facade remains a separate atom
- `opentray` resolves and loads the dylib through the generic host

## Practical Next Step

Do not start with `ext-lynx.dylib`.

Start by formalizing the standalone Lynx binary probe as the acceptance baseline, then implement
the generic dynamic-loader host once, and only after that introduce the Lynx dylib package.
