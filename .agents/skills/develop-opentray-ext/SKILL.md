---
name: develop-opentray-ext
description: Design, implement, split, publish, and verify OpenTray extension packages, especially native extensions with a TypeScript facade plus either embedded multi-platform libraries or per-platform dynamic library packages. Use when creating or refactoring `packages/ext-*`, platform packages such as `packages/ext-webview-darwin-arm64`, `crates/opentray-ext-*`, extension discovery, native artifact staging, release CI, or binary size/linkage acceptance.
---

# Develop OpenTray Ext

## Overview

Use this skill when the work is extension-centric rather than repo-wide. The core rule is simple: `opentray` forwards extension traffic generically, while the extension package owns product-specific protocol and native runtime behavior.

## Workflow

1. Inspect the current extension split: facade package, native crate, platform packages, OpenSpec, and loader behavior.
2. Keep runtime ownership inside the extension artifact, not in `opentray-core` or the broker binary.
3. For user-facing WebView window work, read scenario cards first and ask effect-oriented questions before designing API shape.
4. Wire platform distribution through package atoms, local staging, and CI staging. Choose the distribution kind by the size gate: an embedded multi-platform facade package (all four targets plus `platforms/manifest.json` inside one package, no `optionalDependencies`) is the first-class path while the real packed tarball stays at or below 3 MB; per-platform package atoms are mandatory beyond that (warn level at 2 MB requires an Owner split decision).
5. Prove the split with tests, source-tree visual acceptance, and native size/linkage evidence.

## Reference Map

- Architecture and ownership boundaries: read `references/boundaries.md`.
- Platform package and binary-distribution rules (per-platform atoms): read `references/platform-packages.md`.
- Embedded multi-platform packaging (`@opentray/ext-dialog` and `@opentray/ext-sound` are the canonical cases): register the component in `scripts/binaries/native-build-graph.ts`, stage all four targets under `packages/<name>/platforms/` with the generated `platforms/manifest.json` identity chain (per-target path/SHA-256/buildIdentity), and join the generic `embedded-packages` CI evidence list — the pipeline runs a real `npm pack`, unpacks the same tarball, and checks per-target identity on every embedded package with zero per-package wiring. Release evidence is a real packed tarball, never a dry run.
- Verification and acceptance checklist: read `references/verification.md`.
- Current canonical case study: read `references/webview-runtime-case-study.md`.
- WebView window style, event, and screen-aware recipes: read `references/webview-window-patterns.md`.
- Lynx host-window work is maintained in the independent
  [`jixoai/opentray-ext-lynx`](https://github.com/jixoai/opentray-ext-lynx) repository.

## Non-Negotiable Boundaries

- Do not put extension-specific parsing or runtime back into `opentray-core` or `crates/opentray-bin`.
- Do not choose the distribution shape by habit. The embedded single-package kind is first class at or below the 3 MB real-pack gate (2 MB warn); beyond the gate, split into per-platform package atoms without further debate. Either shape must go through the generic staging-manifest and real-pack evidence pipeline.
- Do not commit generated binaries to git. Stage them locally or in CI only.
- Do not fake unsupported native behavior. Return typed unsupported/capability errors.
- Do not call an extension “split out” unless binary size/linkage evidence matches the ownership story.
- Do not treat DOM/body size as the native-window law for WebView extensions; window fit policy belongs to the host capability layer.

## Minimum Proof

For native extensions, end with:

```bash
cargo test -p <native-crate>
pnpm --filter <facade-package> test
cargo build -p opentray-bin -p <native-crate> --release
wc -c <daemon-binary> <native-library>
```

On macOS, also inspect linkage with `otool -L`. The main binary should not keep the extension runtime linkage if the split is real.
