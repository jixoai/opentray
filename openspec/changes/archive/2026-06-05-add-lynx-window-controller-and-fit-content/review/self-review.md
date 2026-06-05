# Vision-Driven Self Review

## Review State

- Change: `add-lynx-window-controller-and-fit-content`
- Iteration: 3
- Recurring issue counts:
  - `frameless` swallowed page input by mapping the full content area to a drag background: 1
- Exit-condition judgment: Complete. Source-side verification passed after rebase, and the fresh CI-built Lynx runtime artifact was visually accepted by the human operator.
- Next loop action: none. The change can exit normally and be archived.

## Intent Alignment

| Intent point | Evidence | Verdict |
| ------------ | -------- | ------- |
| `ext-lynx` must stop being launcher-only and own a real window bridge. | `packages/ext-lynx/src/index.ts`, `packages/ext-lynx/src/runtime.ts`, `crates/opentray-ext-lynx/src/protocol.rs`, and `native/lynx-runtime-macos/OpenTrayLynxRuntime/ViewController.mm` now define a Lynx-owned `navigator.window` / `navigator.opentrayWindow` bridge with scoped `invoke`, `listen`, title/icon methods, screen methods, and startup feature flags. | Pass |
| Window metadata must stay extension-owned and map cleanly to the dedicated Lynx runtime. | The show command now accepts `title` and `icon`; the runtime bridge implements `getTitle`, `setTitle`, `getIcon`, `setIcon`, and emits `titlechange` / `iconchange`. | Pass |
| Screen capability must live in the same extension-owned family. | `nativeScreenApi` and `bindScreenGlobals` are part of the public TS facade and Rust protocol, and the macOS runtime installs `navigator.screen`, `navigator.opentrayScreen`, and optional `window.getScreenDetails()`. | Pass |
| Standalone launch law should be an explicit startup feature set, not implicit fit-content. | `fitContentSize` was removed from the public TS surface, removed from `LynxLaunchConfig`, ignored as a deprecated input bit in `ShowCommandData`, removed from the native runtime host logic, and replaced in smoke/docs with feature expressions plus a fixed `720x420` fallback shell. | Pass |
| `frameless` must not corrupt page input semantics. | `ViewController.mm` no longer sets `window.movableByWindowBackground = YES` for frameless windows. The spec now explicitly states that frameless cannot silently swallow pointer/input events. | Pass |
| The macOS runtime must no longer have a blank Dock identity. | Static packaging and runtime metadata changes remain in place, and the CI-built runtime artifact was visually accepted by the human operator after the final bridge fix. | Pass |

## Deviations From Intent

None for this change. `fitContentSize` was intentionally removed during the loop and replaced by explicit startup feature controls, so the change name is stale but the settled platform law is documented in the spec and skills.

## Verification Evidence

- `cargo test -p opentray-ext-lynx` passed.
- `pnpm --filter @opentray/ext-lynx test` passed.
- `pnpm --filter @opentray/ext-lynx typecheck` passed.
- `pnpm --filter opentray exec vitest run src/cli.test.ts src/smoke/daemon-lynx.test.ts` passed.
- `pnpm --filter opentray typecheck` passed.
- `bun test scripts/binaries/*.test.ts` passed.
- `bun test scripts/binaries/launch-lynx-smoke.test.ts` passed.
- `bun run openspec:vision -- validate add-lynx-window-controller-and-fit-content` passed.
- `bun run openspec:vision -- check add-lynx-window-controller-and-fit-content` passed.
- `git diff --check` passed.
- Human visual acceptance passed after the CI-built runtime artifact: `Tap top probe button`, `Local Tap Probe`, `Connect Bridge`, navigator window/screen bridge controls, click, scroll, and input all worked.

## Residual Risks

1. The current change name still contains `fit-content`, while the actual settled law is now "explicit startup controls". This is naming debt, not protocol debt.
2. The verified carrier path is macOS-focused. Future Windows/Linux Lynx work still needs separate platform extension packages and runtime-host laws before claiming cross-platform parity.

## Human Acceptance

Completed by the human operator with a fresh CI-built runtime artifact. The acceptance path covered:

- baseline smoke behavior
- explicit native window and screen bridge behavior
- `main.lynx.bundle` bridge controls
- click and scroll behavior
- input focus and typing behavior
- the final lexical `NativeModules` resolver fix

## Exit Handling

- Normal exit: ready. Run `openspec archive add-lynx-window-controller-and-fit-content` and commit the archive result.
- Abnormal exit: not needed.
