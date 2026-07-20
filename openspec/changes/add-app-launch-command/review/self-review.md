# Vision-Driven Self Review

## Review State

- Change: `add-app-launch-command`
- Iteration: 1
- Recurring issue counts: none; all issue counts are 0
- Exit-condition judgment: rejected by owner acceptance; two Dock identities appeared and a pinned entry did not relaunch the consumer.
- Next loop action: round 2 corrects package identity, stale bundle convergence, and persistent daemon/carrier diagnostics before repeating owner acceptance.

## Intent Alignment

| Intent point | Evidence | Verdict |
| ------------ | -------- | ------- |
| Omitted/null configuration remembers the current invocation | `packages/cli/src/app-launch.ts`; automatic snapshot unit test | Aligned |
| Explicit launchers use a direct command vector | CLI normalization tests preserve empty argv entries, resolve paths/cwd, and reject NUL | Aligned |
| Latest successful local initialization wins | `packages/cli/src/local-broker.test.ts` proves a compatible reused broker is not respawned and receives the latest descriptor | Aligned |
| Failed/external connections do not claim local launch state | CLI tests prove identity mismatch preserves the old descriptor and a successful external connection writes nothing | Aligned |
| Mutable launch state does not alter bundle identity | Packaging tests compare broker, plist, and manifest bytes before/after a prebuilt descriptor update | Aligned |
| Dock/Finder cold launch starts the consumer once | `crates/opentray-bin/tests/app_launch.rs` executes the built carrier against an executable consumer script and checks one exact argv/cwd record | Aligned |
| Invalid state cannot execute an arbitrary command | Rust and TypeScript strict parsers reject unknown fields; the native integration test returns non-zero without creating its marker | Aligned |
| Core and live-session boundaries remain unchanged | No Core/spec protocol changes; `broker` remains the only broker entry command and live reveal never reads the cold-launch descriptor | Aligned |
| Release intent is explicit | `.changeset/calm-app-launch.md` plans the fixed release line from `opentray` and `@opentray/packaging` | Aligned |

## Deviations From Intent

1. The round-1 implementation did not converge older OpenTray-owned bundles with the same `CFBundleIdentifier`; a pinned path could therefore differ from the running path.
2. Default package discovery allowed nested `npm_package_json=webui` to address the stable bundle even though the running consumer belongs to `skill-creator`.
3. Detached broker and carrier stdio were discarded, so a manual Dock failure had no durable evidence.

## New Questions For User

1. After round-2 automated and runtime evidence is green, does the sole Skill Creator Dock entry remain visually correct and relaunch after being pinned? This remains owner-owned visual acceptance.

## Evidence

- HTML report: `review/self-review.html`
- Command/evidence paths: `packages/cli/src/app-launch.test.ts`, `packages/cli/src/local-broker.test.ts`, `packages/packaging/src/app-launch.test.ts`, `packages/packaging/src/app-bundle.test.ts`, `crates/opentray-bin/tests/app_launch.rs`
- Commands passed: `pnpm run build`; `pnpm run verify`; `cargo test -p opentray-bin --test app_launch -- --nocapture`; `bun run openspec:vision -- validate add-app-launch-command`; `git diff --check`
- Git commits reviewed: `c1c9a66 docs(spec): prepare add-app-launch-command for apply`; `f3ddf42 feat: relaunch consumers from Darwin app bundles`
- Uncommitted paths at review creation: `plans/plan.md`, `tasks.md`, `review/self-review.md`, and `review/self-review.html`; these belong to the self-review evidence commit
- Task checkboxes updated by this working context: BDD 2.1-2.7, gates 3.1-3.2, implementation 4.1-4.10, verification 5.1-5.7, and review 6.1-6.2/6.7; archive/conditional loop items remain open
- Residual warnings: existing `vendor/tray-icon` unnecessary `unsafe` warnings only

## HTML Review Report

`review/self-review.html` presents the requirement map, runtime flow, command evidence, and acceptance boundary. No screenshot is claimed because the remaining Dock observation belongs to the owner.

## Exit Handling

- Normal exit is intentionally paused before archive for owner Dock acceptance.
- A visual mismatch returns to a backed-up plan revision before further code changes.
- Acceptance permits `openspec archive add-app-launch-command` as a separate final commit.
