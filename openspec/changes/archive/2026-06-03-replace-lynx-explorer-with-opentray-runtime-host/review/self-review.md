# Vision-Driven Self Review

## Review State

- Change: `replace-lynx-explorer-with-opentray-runtime-host`
- Iteration: 1
- Recurring issue counts:
  - none
- Exit-condition judgment: The change now meets the stated exit condition. The Lynx carrier is OpenTray-owned, GitHub-built darwin runtime artifacts passed in both preflight and release, npm packages were published successfully, and a fresh-install smoke run from npm resolved the packaged review bundle plus the published runtime zip.
- Next loop action: none. The change met its exit condition and was archived.

## Intent Alignment

| Intent point                                                                             | Evidence                                                                                                                                                                                                                              | Verdict |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| The carrier must stop depending on a borrowed `LynxExplorer.app` shell as product truth. | `native/lynx-runtime-macos/` is the repo-owned source of truth, and the release build copies that tree into the ephemeral upstream checkout before the Lynx build graph runs.                                                     | Pass    |
| The runtime artifact identity must become OpenTray-owned.                                | `OpenTrayLynxRuntime.app.zip` is the runtime path used by `crates/opentray-ext-lynx`, platform package staging, `verify-native-artifacts.yml`, `release.yml`, and the published `@opentray/ext-lynx-darwin-*` packages.          | Pass    |
| Release verification must not depend only on local Xcode.                                | `Verify Native Artifacts` run `26881392689` passed on GitHub Actions, including both darwin jobs; `Release` run `26886058460` also rebuilt and staged the same runtime carrier before publishing.                               | Pass    |
| After npm publish, maintainers need one final human-audit command.                       | From a fresh temp project, `pnpm add opentray @opentray/ext-lynx` followed by `pnpm exec opentray smoke daemon-lynx` resolved `opentray@0.4.1`'s packaged `assets/lynx-review/main.lynx.bundle` and `@opentray/ext-lynx` runtime. | Pass    |

## Deviations From Intent

1. The packaged Lynx review asset is still a tracked built bundle rather than a repo-native source app pipeline. That debt is explicitly acceptable for this phase because the goal was carrier ownership, release proof, and user-visible smoke proof, not source-authored demo retooling.
2. The fresh-install smoke proof here used `OPENTRAY_EXAMPLE_EXIT_AFTER_MS=2500` for unattended verification. Human acceptance should still use the same command without that env var so the reviewer can inspect the window manually.

## New Questions For User

1. None on architecture. The remaining work is archive bookkeeping only.

## Evidence

- GitHub artifact preflight:
  - `Verify Native Artifacts` run `26881392689`
  - both `Native artifacts (darwin-arm64)` and `Native artifacts (darwin-x64)` completed with `success`
- GitHub release publish:
  - `Release` run `26886058460`
  - `Release packages` completed with `success`
  - version commit pushed to branch as `439baa8 chore: version packages`
- Published npm versions:
  - `opentray@0.4.1`
  - `@opentray/ext-lynx@0.1.1`
  - `@opentray/ext-lynx-darwin-arm64@0.1.1`
  - `@opentray/ext-lynx-darwin-x64@0.1.1`
- Fresh-install npm audit:
  - temp project installed `opentray` and `@opentray/ext-lynx` from npm
  - smoke command:
    - machine proof: `OPENTRAY_HOME="$(mktemp -d)" OPENTRAY_EXAMPLE_EXIT_AFTER_MS=2500 pnpm exec opentray smoke daemon-lynx`
    - human audit command: `pnpm exec opentray smoke daemon-lynx`
  - emitted `shown` event resolved:
    - bundle: `.../node_modules/opentray/assets/lynx-review/main.lynx.bundle`
    - runtime zip: `.../node_modules/@opentray/ext-lynx-darwin-arm64/runtime/OpenTrayLynxRuntime.app.zip`

## HTML Review Report

`review/self-review.html` carries the same evidence in presentation form for quick scanning.

## Exit Handling

- Normal exit: archived successfully as `2026-06-03-replace-lynx-explorer-with-opentray-runtime-host`.
- Abnormal exit: not needed for this change.
