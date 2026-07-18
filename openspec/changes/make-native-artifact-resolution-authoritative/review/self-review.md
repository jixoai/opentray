# Vision-Driven Self Review

## Review State

- Change: `make-native-artifact-resolution-authoritative`
- Iteration: 5
- Recurring issue counts: `packed-consumer-release-gate: 1`, `archive-delta-integrity: 2`
- Exit-condition judgment: product behavior remains aligned; all modified and removed delta identities now match current main specs
- Next loop action: validate delta integrity, rerun archive commit-check, archive the change, then run the final archived audit

## Intent Alignment

| Intent point | Evidence | Verdict |
| ------------ | -------- | ------- |
| `pnpm install` must select the facade-owned native closure | Packed pnpm consumer resolved `@opentray/ext-webview-darwin-arm64` from the facade `.pnpm` closure; an old top-level package did not win | pass |
| Native extensions must prove identity before init | `cargo test -p opentray-bin -p opentray-core -p opentray-spec` and extension ABI tests pass; manifest mismatch remains pre-init rejection | pass |
| A live same-endpoint broker must be replaced when its artifact is stale | `packages/cli/src/daemon/lifecycle.test.ts` covers matching reuse, missing/different identity replacement, bounded stop, and concurrent starts | pass |
| The ready contract must carry selected broker evidence | Rust Unix/Windows metadata and protocol ready frame include canonical path and broker identity; local-broker mismatch test passes | pass |
| User-visible WebView runtime still works after self-validation | `OPENTRAY_EXAMPLE_EXIT_AFTER_MS=1500 pnpm --filter opentray example:webview-control -- --no-overlay` exited 0 after ready/load/show setup | pass |
| Fresh packed consumers must preserve package-manager authority | `pnpm run verify:packed-consumer -- --package-manager pnpm` and `--package-manager npm` both passed; each fixture created a tray, loaded the official WebView extension through `loadExtension`, and destroyed the tray; pnpm ignored the injected orphan top-level dylib | pass |
| Diagnostic candidates must continue after a rejected artifact | `cargo test -p opentray-bin dynamic_extension::tests` covers mismatch evidence followed by a compatible candidate and exact-path no-fallback | pass |
| Release must enforce packed consumers on native runners | `release.yml` derives a WebView-only matrix from the native plan, runs pnpm/npm packed consumers on matching target runners, and makes release depend on that job | pass |

## Independent Review Findings

| Axis | Finding | Resolution | Evidence |
| ---- | ------- | ---------- | -------- |
| Standards | `opentray-core` synthesized a platform-specific all-zero broker identity when composition omitted one. | Broker identity is now a required constructor input; the native binary and in-process runtime compute their real executable identity. | Full `cargo test`; core ready-frame tests require explicit identity. |
| Standards | Public broker identity APIs lacked API comments/README coverage, and Unix/Windows transports duplicated ready metadata construction. | Added Rust/TypeScript public comments and `@opentray/spec` README guidance; both transports use `BrokerOptions::ready_metadata()`. | Spec typecheck/tests and full Rust tests pass. |
| Spec | Windows source builds killed every broker sharing the workspace executable, lock timeout was shorter than readiness, and packed-consumer evidence was manual only. | Use caller-scoped Windows Cargo target directories, wait up to five seconds for the daemon lock, add a 1.1-second concurrent-start regression, and add the permanent packed pnpm/npm gate. | CLI 95 tests pass; both packed-consumer modes pass. |
| Spec | Packed gate was not wired into release, and its fixture did not exercise the public SDK/native loader. | Added the native-runner release matrix and changed the fixture to `createTray -> loadExtension -> destroy`; output is emitted only after broker/native manifest validation and init. | `release-workflow.test.ts`; both packed modes print `loaded: true`. |
| Spec | Diagnostic fallback stopped at the first existing mismatched library. | Diagnostic candidates now retain missing/unreadable/ABI/identity classification and continue to later compatible candidates; exact absolute paths remain single-candidate. | `cargo test -p opentray-bin dynamic_extension::tests`. |
| Standards | OpenSpec tests used numeric fds/pipes that silently lost nested Bun output. | Direct Bun spawn uses file-backed sinks/sources and keeps `/bin/sh` out of the path. | 37 OpenSpec workflow tests pass under Bun 1.3.14. |
| Standards | Diagnostic ABI classification depended on matching human-readable error text. | Missing symbols and ABI version mismatch now carry the stable `abi_incompatible` category; diagnostic classification consumes categories only. | Focused Rust red/green plus full `cargo test` pass. |
| Spec | The packed consumer destroyed the tray but left the top-level SDK's broker socket open. | Top-level `createTray()` now closes its owned session after tray teardown, closes on creation failure, and shares one idempotent destroy promise across extended handles. | SDK red/green tests, packed pnpm/npm consumers, and the full repository gate pass. |
| Spec | Archive preflight found renamed scenarios and REMOVED requirements that never existed in the current main specs. | Restored existing scenario identifiers, removed phantom removals, and modeled broker-side package-root removal as an explicit replacement of the requirement that actually owned that behavior. | Both archive attempts aborted before writes; delta identity audit, strict validation, and a third archive attempt gate the correction. |

## Deviations From Intent

1. Local review ran the packed native consumer on macOS arm64; Windows native execution is configured in the release matrix but is not available in this checkout. The matrix uses the target runner and explicit target, so macOS evidence is not promoted to Windows truth.
2. Packed local-tarball fixtures provide the matching `@opentray/spec` tarball directly (npm) or through a local override (pnpm), otherwise the package manager legitimately resolves the already-published same-version spec and exposes an old export surface. This does not add a runtime fallback.

## New Questions For User

1. None. The requested destructive three-phase direction is explicit.

## Evidence

- HTML report: `review/self-review.html`
- Permanent packed consumer gate: `scripts/binaries/verify-packed-consumer.ts`, wired into the release matrix
- Packed pnpm and npm fixtures: fresh temporary directories created and removed by the gate
- Source WebView smoke: `example:webview-control --no-overlay`, exit 0
- Native inspection: `otool -L` on staged broker and WebView dylib; sizes 7.4 MiB and 7.5 MiB
- Git commits reviewed: `a1c665d..0236b2d`
- Uncommitted paths, if any: archive-readiness spec and review correction only
- Task checkboxes updated by this working context: 9.1

## HTML Review Report

See `review/self-review.html` for the compact evidence matrix and final archive conditions.

## Exit Handling

- Normal exit: run the repository-supported archive command only after review and the final check pass.
