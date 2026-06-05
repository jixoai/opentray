# Vision-Driven Self Review

## Review State

- Change: `add-lynx-window-controller-and-fit-content`
- Iteration: 2
- Recurring issue counts:
  - `frameless` swallowed page input by mapping the full content area to a drag background: 1
- Exit-condition judgment: Source-side work is complete and locally verified for the explicit host-feature model. Final archive still waits on a fresh CI-built `OpenTrayLynxRuntime.app.zip` plus human visual smoke.
- Next loop action: build a new darwin runtime artifact on GitHub Actions, smoke `baseline`, `nativeWindowApi,bindWindowGlobals,nativeScreenApi,bindScreenGlobals`, `*,!frameless`, and `*`, then confirm whether full frameless mode still preserves click, scroll, and input behavior.

## Intent Alignment

| Intent point | Evidence | Verdict |
| ------------ | -------- | ------- |
| `ext-lynx` must stop being launcher-only and own a real window bridge. | `packages/ext-lynx/src/index.ts`, `packages/ext-lynx/src/runtime.ts`, `crates/opentray-ext-lynx/src/protocol.rs`, and `native/lynx-runtime-macos/OpenTrayLynxRuntime/ViewController.mm` now define a Lynx-owned `navigator.window` / `navigator.opentrayWindow` bridge with scoped `invoke`, `listen`, title/icon methods, screen methods, and startup feature flags. | Pass |
| Window metadata must stay extension-owned and map cleanly to the dedicated Lynx runtime. | The show command now accepts `title` and `icon`; the runtime bridge implements `getTitle`, `setTitle`, `getIcon`, `setIcon`, and emits `titlechange` / `iconchange`. | Pass |
| Screen capability must live in the same extension-owned family. | `nativeScreenApi` and `bindScreenGlobals` are part of the public TS facade and Rust protocol, and the macOS runtime installs `navigator.screen`, `navigator.opentrayScreen`, and optional `window.getScreenDetails()`. | Pass |
| Standalone launch law should be an explicit startup feature set, not implicit fit-content. | `fitContentSize` was removed from the public TS surface, removed from `LynxLaunchConfig`, ignored as a deprecated input bit in `ShowCommandData`, removed from the native runtime host logic, and replaced in smoke/docs with feature expressions plus a fixed `720x420` fallback shell. | Pass |
| `frameless` must not corrupt page input semantics. | `ViewController.mm` no longer sets `window.movableByWindowBackground = YES` for frameless windows. The spec now explicitly states that frameless cannot silently swallow pointer/input events. | Pass |
| The macOS runtime must no longer have a blank Dock identity. | Static packaging and runtime metadata changes remain in place, but the final visible proof still depends on a newly built runtime artifact rather than the stale locally staged carrier. | Partial |

## Deviations From Intent

1. Final Dock/title/icon visual proof is still pending because this machine cannot rebuild the runtime app locally.
2. Full end-to-end frameless visual proof is still pending because the current source-side fix must be exercised through a fresh CI-produced runtime carrier.

## Verification Evidence

- `cargo test -p opentray-ext-lynx` passed.
- `pnpm --filter opentray exec vitest run src/cli.test.ts src/smoke/daemon-lynx.test.ts` passed.
- `pnpm --filter @opentray/ext-lynx exec vitest run src/index.test.ts` passed.
- `bun test scripts/binaries/launch-lynx-smoke.test.ts` passed.
- `openspec schema validate vision-driven` passed.
- `git diff --check` passed before this review update.

## Residual Risks

1. The runtime host source now treats frameless as borderless-only, but the final truth still depends on a human smoke against a rebuilt carrier app.
2. `navigator.screen` parity is source-complete, but real screen labels and topology still need human verification on the runtime artifact because they are fully native-sourced.
3. The current change name still contains `fit-content`, while the actual settled law is now "explicit startup controls". That is a naming debt, not a protocol debt.

## Human Acceptance Pending

After CI publishes a fresh darwin runtime artifact, run:

```bash
pnpm run smoke:lynx -- --run <run-id> --bundle research/lynx/app/dist/input-probe.lynx.bundle
pnpm run smoke:lynx -- --run <run-id> --bundle research/lynx/app/dist/input-probe.lynx.bundle --features "nativeWindowApi,bindWindowGlobals,nativeScreenApi,bindScreenGlobals"
pnpm run smoke:lynx -- --run <run-id> --bundle research/lynx/app/dist/input-probe.lynx.bundle --features "*,!frameless"
pnpm run smoke:lynx -- --run <run-id> --bundle research/lynx/app/dist/input-probe.lynx.bundle --features "*"
```

Confirm all of the following with your eyes:

- the Dock icon is nonblank as soon as the Lynx runtime launches
- the initial title is visible on the native window
- click, scroll, and input all work in baseline mode
- click, scroll, and input still work with the window bridge enabled
- `*,!frameless` preserves page input, so any remaining regression can be isolated to frameless mode
- full `*` mode also preserves page input after the frameless fix

## Exit Handling

- Normal exit: not ready yet. Archive should wait for the fresh runtime artifact smoke.
- Abnormal exit: not needed. The remaining blocker is explicit and isolated.
