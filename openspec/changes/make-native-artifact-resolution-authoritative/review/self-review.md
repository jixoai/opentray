# Vision-Driven Self Review

## Review State

- Change: `make-native-artifact-resolution-authoritative`
- Iteration: 1
- Recurring issue counts: none recorded
- Exit-condition judgment: implementation and independent review fixes are aligned; archive remains blocked only by the existing OpenSpec fixture gate and final commit checks
- Next loop action: repair the repository OpenSpec subprocess fixtures, run the full gate, then archive

## Intent Alignment

| Intent point | Evidence | Verdict |
| ------------ | -------- | ------- |
| `pnpm install` must select the facade-owned native closure | Packed pnpm consumer resolved `@opentray/ext-webview-darwin-arm64` from the facade `.pnpm` closure; an old top-level package did not win | pass |
| Native extensions must prove identity before init | `cargo test -p opentray-bin -p opentray-core -p opentray-spec` and extension ABI tests pass; manifest mismatch remains pre-init rejection | pass |
| A live same-endpoint broker must be replaced when its artifact is stale | `packages/cli/src/daemon/lifecycle.test.ts` covers matching reuse, missing/different identity replacement, bounded stop, and concurrent starts | pass |
| The ready contract must carry selected broker evidence | Rust Unix/Windows metadata and protocol ready frame include canonical path and broker identity; local-broker mismatch test passes | pass |
| User-visible WebView runtime still works after self-validation | `OPENTRAY_EXAMPLE_EXIT_AFTER_MS=1500 pnpm --filter opentray example:webview-control -- --no-overlay` exited 0 after ready/load/show setup | pass |
| Fresh packed consumers must preserve package-manager authority | `pnpm run verify:packed-consumer -- --package-manager pnpm` and `--package-manager npm` both passed; pnpm ignored the injected orphan top-level dylib | pass |

## Independent Review Findings

| Axis | Finding | Resolution | Evidence |
| ---- | ------- | ---------- | -------- |
| Standards | `opentray-core` synthesized a platform-specific all-zero broker identity when composition omitted one. | Broker identity is now a required constructor input; the native binary and in-process runtime compute their real executable identity. | Full `cargo test`; core ready-frame tests require explicit identity. |
| Standards | Public broker identity APIs lacked API comments/README coverage, and Unix/Windows transports duplicated ready metadata construction. | Added Rust/TypeScript public comments and `@opentray/spec` README guidance; both transports use `BrokerOptions::ready_metadata()`. | Spec typecheck/tests and full Rust tests pass. |
| Spec | Windows source builds killed every broker sharing the workspace executable, lock timeout was shorter than readiness, and packed-consumer evidence was manual only. | Use caller-scoped Windows Cargo target directories, wait up to five seconds for the daemon lock, add a 1.1-second concurrent-start regression, and add the permanent packed pnpm/npm gate. | CLI 95 tests pass; both packed-consumer modes pass. |

## Deviations From Intent

1. `pnpm run verify` remains red in the repository's existing OpenSpec subprocess fixtures: 25 vision-driven/vision2 assertions receive empty child output because the fixture subprocess loses the schema/runtime context in temporary cwd. The focused product, Rust, extension, packed-consumer, build, and typecheck lanes pass; this is kept as an explicit archive blocker rather than hidden.
2. Packed local-tarball fixtures must provide the matching `@opentray/spec` tarball directly (npm) or through a local override (pnpm), otherwise the package manager legitimately resolves the already-published same-version spec and exposes an old export surface. This does not add a runtime fallback.

## New Questions For User

1. None. The requested destructive three-phase direction is explicit.

## Evidence

- HTML report: `review/self-review.html`
- Permanent packed consumer gate: `scripts/binaries/verify-packed-consumer.ts`
- Packed pnpm and npm fixtures: fresh temporary directories created and removed by the gate
- Source WebView smoke: `example:webview-control --no-overlay`, exit 0
- Native inspection: `otool -L` on staged broker and WebView dylib; sizes 7.4 MiB and 7.5 MiB
- Git commits reviewed: `a1c665d..9f26e3f` plus the review-fix worktree
- Uncommitted paths, if any: review fixes, permanent packed-consumer gate, and current review evidence
- Task checkboxes updated by this working context: 2.7, 8.2-8.5

## HTML Review Report

See `review/self-review.html` for the compact evidence matrix and the blocked-gate callout.

## Exit Handling

- Normal exit: run the repository-supported archive command only after review and the final check pass.
