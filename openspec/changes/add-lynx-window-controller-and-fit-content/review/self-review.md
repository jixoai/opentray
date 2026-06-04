# Vision-Driven Self Review

## Review State

- Change: `add-lynx-window-controller-and-fit-content`
- Iteration: 1
- Recurring issue counts:
  - none
- Exit-condition judgment: Source-side work is complete and locally verified. Final archive remains blocked on a CI-built `OpenTrayLynxRuntime.app.zip` plus human visual smoke, because this machine only has Command Line Tools and cannot run `xcodebuild`.
- Next loop action: rebuild the Lynx runtime carrier on GitHub Actions, stage the produced runtime zip into the darwin package, run `pnpm --filter opentray cli -- smoke daemon-lynx`, and visually confirm Dock icon, title/icon mutation, screen details, fit-content, and fixed-size opt-out.

## Intent Alignment

| Intent point | Evidence | Verdict |
| ------------ | -------- | ------- |
| `ext-lynx` must stop being launcher-only and own a real window bridge. | `packages/ext-lynx/src/index.ts`, `crates/opentray-ext-lynx/src/protocol.rs`, and `native/lynx-runtime-macos/OpenTrayLynxRuntime/ViewController.mm` now cover `navigator.window`, `navigator.opentrayWindow`, scoped `invoke/listen`, title/icon methods, screen methods, and fit-content launch options without adding daemon/core special cases. | Pass |
| Window metadata must stay extension-owned and map cleanly to the dedicated Lynx runtime. | The Lynx show command now accepts `title` and `icon`; the runtime bridge implements `getTitle`, `setTitle`, `getIcon`, `setIcon`, plus `titlechange` and `iconchange`. | Pass |
| Screen capability must live in the same extension-owned family. | `nativeScreenApi` and `bindScreenGlobals` are now part of the public TS facade and Rust protocol, and the macOS runtime installs `navigator.screen`, `navigator.opentrayScreen`, and optional `window.getScreenDetails()`. | Pass |
| Default standalone sizing should be fit-content, with fixed-size precedence and bounds. | `fitContentSize` remains default-on, explicit `width` / `height` are passed through, bounds are preserved, and the smoke/demo now exposes fit and fixed launch modes side by side. | Pass |
| The macOS runtime must no longer have a blank Dock identity. | `Info.plist` now points at `OpenTrayLynxRuntime.icns`, `BUILD.gn` stages that resource, and a static packaging test locks all three pieces together. Final visual proof still needs a CI-built carrier app. | Partial |
| Future extension work should inherit the same law. | `.agents/skills/develop-opentray-ext/references/lynx-window-host.md` and `verification.md` now describe title/icon/screen ownership, Dock icon law, and the CI-only carrier-build boundary. | Pass |

## Deviations From Intent

1. Final Dock and app-title visual proof is still pending. The source of truth is correct, but the currently installed runtime bundle on this machine has not been rebuilt from the updated host sources.
2. The local environment cannot produce that carrier rebuild because `xcodebuild` is unavailable under the active developer directory.

## Verification Evidence

- `bun test scripts/release/build-lynx-runtime.test.ts` passed.
- `pnpm --filter @opentray/ext-lynx test` passed.
- `cargo test -p opentray-ext-lynx` passed.
- `pnpm --dir research/lynx/app test` passed.
- `pnpm --dir research/lynx/app typecheck` passed.
- `pnpm --dir research/lynx/app build` passed. Rspeedy emitted one existing warning that `text-transform` in `src/App.css` is unsupported during template encode, but the bundle still built successfully.
- `pnpm --filter opentray test` passed.
- `pnpm --filter opentray typecheck` passed.
- `bun run openspec:vision -- validate add-lynx-window-controller-and-fit-content` passed.
- `bun run openspec:vision -- commit-check add-lynx-window-controller-and-fit-content --phase apply` returned `ok: true` for the current change set.
- `bun run openspec:vision -- commit-check add-lynx-window-controller-and-fit-content --phase self-review` returned `ok: true` for the current change set.
- `xcode-select -p` reports `/Library/Developer/CommandLineTools`.
- `xcodebuild -version` fails with `xcode-select: error: tool 'xcodebuild' requires Xcode, but active developer directory '/Library/Developer/CommandLineTools' is a command line tools instance`.

## Residual Risks

1. The runtime host source and static metadata are correct, but the human-visible Dock fix is still unproven until a new `OpenTrayLynxRuntime.app.zip` is built and staged.
2. `navigator.screen` parity is source-complete, but screen labels and monitor topology should still be checked on a real CI-built runtime because monitor APIs are entirely native-sourced.
3. Fit-content and fixed-size precedence were proven at code/test level in this pass, but the final visual feel must still be judged from the rebuilt runtime window, not only from the review bundle source.

## Human Acceptance Pending

After CI publishes a fresh darwin runtime artifact, run:

```bash
pnpm --filter opentray cli -- smoke daemon-lynx
```

Confirm all of the following with your eyes:

- the Dock icon is nonblank as soon as the Lynx runtime launches
- the initial title is visible on the native window
- `Set Title`, `Set Mint Icon`, and `Set Ember Icon` visibly update the window and Dock identity
- `Read Screen` and `getScreenDetails` show real screen details
- `Show Fit Window` avoids dead black margins by default
- `Show Fixed Window` still respects the explicit fixed shell

## Exit Handling

- Normal exit: not ready yet. Archive should wait for the CI-built carrier smoke.
- Abnormal exit: not needed. The remaining blocker is known and isolated.
