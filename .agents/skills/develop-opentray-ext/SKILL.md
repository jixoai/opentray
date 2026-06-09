---
name: develop-opentray-ext
description: Design, implement, split, publish, and verify OpenTray extension packages, especially native extensions with a TypeScript facade plus per-platform dynamic library packages. Use when creating or refactoring `packages/ext-*`, platform packages such as `packages/ext-webview-darwin-arm64`, `crates/opentray-ext-*`, extension discovery, native artifact staging, release CI, or binary size/linkage acceptance.
---

# Develop OpenTray Ext

## Overview

Use this skill when the work is extension-centric rather than repo-wide. The core rule is simple: `opentray` forwards extension traffic generically, while the extension package owns product-specific protocol and native runtime behavior.

## Workflow

1. Inspect the current extension split: facade package, native crate, platform packages, OpenSpec, and loader behavior.
2. Keep runtime ownership inside the extension artifact, not in `opentray-core` or the broker binary.
3. For user-facing WebView window work, read scenario cards first and ask effect-oriented questions before designing API shape.
4. Wire platform distribution through package atoms, local staging, and CI staging.
5. Prove the split with tests, source-tree visual acceptance, and native size/linkage evidence.

## Reference Map

- Architecture and ownership boundaries: read `references/boundaries.md`.
- Platform package and binary-distribution rules: read `references/platform-packages.md`.
- Verification and acceptance checklist: read `references/verification.md`.
- Current canonical case study: read `references/webview-runtime-case-study.md`.
- WebView window style, event, and screen-aware recipes: read `references/webview-window-patterns.md`.
- For Lynx host-window work, sizing defaults, and bridge law: read `references/lynx-window-host.md`.

## Non-Negotiable Boundaries

- Do not put extension-specific parsing or runtime back into `opentray-core` or `crates/opentray-bin`.
- Do not ship one fat cross-platform native package. Use per-platform package atoms.
- Do not commit generated binaries to git. Stage them locally or in CI only.
- Do not fake unsupported native behavior. Return typed unsupported/capability errors.
- Do not call an extension “split out” unless binary size/linkage evidence matches the ownership story.
- Do not treat DOM/body size as the native-window law for Lynx or WebView extensions; window fit policy belongs to the host capability layer.

## Minimum Proof

For native extensions, end with:

```bash
cargo test -p <native-crate>
pnpm --filter <facade-package> test
cargo build -p opentray-bin -p <native-crate> --release
wc -c <daemon-binary> <native-library>
```

On macOS, also inspect linkage with `otool -L`. The main binary should not keep the extension runtime linkage if the split is real.
