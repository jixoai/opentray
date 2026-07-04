# Self Review

## Intent Match

The implementation matches the user's ontology split:

```text
style.opacity       -> whole native-window shell alpha
style.background    -> native backing/material/blur atom
style.platform.*    -> substrate-specific appearance families
```

No `opentray-core` or broker code was changed. The WebView extension facade and native runtime continue to own WebView-specific parsing, validation, projection, and event payloads.

## Platform Updates

- Added `opacity` as common WebView window style state with default `1`.
- Added shared native validation: opacity must be finite and between `0` and `1`.
- Added capability metadata field `opacity: true` on supported macOS and Windows runtimes.

## Atoms Modified

- `packages/ext-webview`: public TypeScript style/capability contracts, facade tests, style recipe helper, README.
- `crates/opentray-ext-webview`: shared parser, macOS AppKit alpha projection, Windows layered-window alpha projection, native tests, demo HTML.
- `packages/cli/examples`: WebView control demo opacity controller, debug runtime visual smoke surface, and example guidance.
- `.agents/skills/develop-opentray-ext/references/webview-window-patterns.md`: extension guidance now documents `style.opacity` as an orthogonal shell-alpha atom and scopes the old Windows `WS_EX_LAYERED` warning to background/white-block repair only.

## Risk Review

- macOS risk is low: `NSWindow.setAlphaValue(...)` is direct shell alpha and composes with existing background/material projection.
- Windows risk is medium: whole-window alpha requires `WS_EX_LAYERED` and `SetLayeredWindowAttributes`. The code keeps the public background atom unchanged, but below `opacity: 1` the runtime disables `WS_EX_NOREDIRECTIONBITMAP` because layered alpha needs a redirection-compatible compositor path.
- Linux remains unsupported by design for official WebView runtime behavior.

## Evidence

- `pnpm --filter @opentray/ext-webview test` passed: 34 tests.
- `pnpm --filter @opentray/ext-webview typecheck` passed.
- `cargo test -p opentray-ext-webview` passed on macOS target: 54 tests.
- `RUSTC=/Users/kzf/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc /Users/kzf/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo check -p opentray-ext-webview --target x86_64-pc-windows-msvc` passed.
- `pnpm --filter @opentray/ext-webview build` passed.
- `bun run openspec:vision -- validate add-webview-window-opacity` passed.
- `bun run openspec:vision -- check add-webview-window-opacity` passed.
- `git diff --check` passed.

## Documentation Review

- Public README documents macOS/Windows opacity capability and the `style.opacity` / `style.background` ontology split.
- Example guidance, the WebView control demo, and debug runtime surfaces expose opacity controls and expected `stylechange` behavior.
- OpenSpec change spec requires host/page `setStyle`, `getStyle`, `stylechange`, capability metadata, and extension-owned projection for opacity.
- Local WebView extension guidance no longer treats `WS_EX_LAYERED` as globally forbidden; it is forbidden for background/white-block repair but valid for the separate opacity atom.

## Decision

No review loop is needed. The current change is additive, contract-scoped, and preserves the extension atom boundary.
