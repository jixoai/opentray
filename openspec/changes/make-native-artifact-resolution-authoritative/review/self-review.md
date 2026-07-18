# Vision-Driven Self Review

## Review State

- Change: `make-native-artifact-resolution-authoritative`
- Iteration: 1
- Recurring issue counts: none recorded
- Exit-condition judgment: implementation is aligned; archive remains blocked by missing independent review artifacts and the existing OpenSpec fixture gate
- Next loop action: complete two-axis review, resolve findings, then rerun the final vision-driven check

## Intent Alignment

| Intent point | Evidence | Verdict |
| ------------ | -------- | ------- |
| `pnpm install` must select the facade-owned native closure | Packed pnpm consumer resolved `@opentray/ext-webview-darwin-arm64` from the facade `.pnpm` closure; an old top-level package did not win | pass |
| Native extensions must prove identity before init | `cargo test -p opentray-bin -p opentray-core -p opentray-spec` and extension ABI tests pass; manifest mismatch remains pre-init rejection | pass |
| A live same-endpoint broker must be replaced when its artifact is stale | `packages/cli/src/daemon/lifecycle.test.ts` covers matching reuse, missing/different identity replacement, bounded stop, and concurrent starts | pass |
| The ready contract must carry selected broker evidence | Rust Unix/Windows metadata and protocol ready frame include canonical path and broker identity; local-broker mismatch test passes | pass |
| User-visible WebView runtime still works after self-validation | `OPENTRAY_EXAMPLE_EXIT_AFTER_MS=1500 pnpm --filter opentray example:webview-control -- --no-overlay` exited 0 after ready/load/show setup | pass |

## Deviations From Intent

1. `pnpm run verify` remains red in the repository's existing OpenSpec subprocess fixtures: 25 vision-driven/vision2 assertions receive empty child output because the fixture subprocess loses the schema/runtime context in temporary cwd. The focused product, Rust, extension, build, and typecheck lanes pass; this is kept as an explicit archive blocker rather than hidden.
2. Packed local-tarball fixtures must provide the matching `@opentray/spec` tarball directly (npm) or through a local override (pnpm), otherwise the package manager legitimately resolves the already-published same-version spec and exposes an old export surface. This does not add a runtime fallback.

## New Questions For User

1. None. The requested destructive three-phase direction is explicit.

## Evidence

- HTML report: `review/self-review.html`
- Packed pnpm fixture: `/tmp/opentray-consumer.l9P6jO`
- Packed npm fixture: `/tmp/opentray-npm-consumer.3Y7Dmp`
- Source WebView smoke: `example:webview-control --no-overlay`, exit 0
- Native inspection: `otool -L` on staged broker and WebView dylib; sizes 7.4 MiB and 7.5 MiB
- Git commits reviewed: `fc72702`, `1895b1a`
- Uncommitted paths, if any: self-review artifacts and task evidence in this change
- Task checkboxes updated by this working context: Phase Three, 7.1-7.5, 7.7-7.8

## HTML Review Report

See `review/self-review.html` for the compact evidence matrix and the blocked-gate callout.

## Exit Handling

- Normal exit: run the repository-supported archive command only after review and the final check pass.
