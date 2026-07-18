## 1. Alignment / Investigation

- [x] 1.1 Confirm the latest `plans/plan.md` records the live `skill-creator-v2` failure, relevant loader/lifecycle code, existing OpenSpec laws, and the zero-repair install contract.
- [x] 1.2 Confirm the breaking-update stance: replace bare `TrayExtension.path` and the old extension ABI directly; no compatibility aliases, symbol fallback, cleanup instructions, or identity bypass.
- [x] 1.3 Confirm the three public TDD seams are `tray.extend(...).ensureLoaded()`, generic `load-ext`, and `connectLocalBroker/startDaemon`.
- [x] 1.4 Confirm an agent may check off only tasks it completed and verified in the current working context.

## 2. BDD Contract / Spec Evidence

- [x] 2.1 Scenario: Given a current platform package in a facade-relative pnpm closure and an older unmanaged top-level package When the extension first loads Then the SDK resolves and sends only the facade-relative exact artifact.
- [x] 2.2 Scenario: Given a supported descriptor whose platform package is missing When the extension first loads Then the SDK reports a typed target/package resolution error before broker dispatch.
- [x] 2.3 Scenario: Given an exact dylib with a mismatched embedded manifest When `load-ext` validates it Then init is never called and expected/actual identity is returned.
- [x] 2.4 Scenario: Given an extension rejects a command with native detail When the broker reports the failure Then category/message survive instead of collapsing to numeric code.
- [x] 2.5 Scenario: Given a live same-endpoint broker with missing or different artifact identity When the SDK auto-starts Then it stops and replaces that PID under the daemon lock.
- [x] 2.6 Scenario: Given a live same-endpoint broker with matching identity When the SDK auto-starts Then it returns `already-running` without spawning.
- [x] 2.7 Scenario: Given packed facade/platform tarballs installed in a temporary pnpm consumer with an orphan top-level platform package When artifact resolution runs Then the current nested artifact wins without environment overrides.
- [x] 2.8 Scenario: Given a correctly versioned platform package containing a stale native binary When release verification inspects embedded identity Then the release gate fails.

## 3. Git Evidence Before Apply

- [x] 3.1 Run `bun run openspec:vision -- validate make-native-artifact-resolution-authoritative` after plan/spec/task authoring.
- [x] 3.2 Run `bun run openspec:vision -- commit-check make-native-artifact-resolution-authoritative --phase research-plan`.
- [x] 3.3 Commit plan, specs, tasks, and directly related platform-language law before product-code work.

## 4. Phase One - Exact Artifact Resolution

- [x] 4.1 Add red client-SDK behavior tests for facade-relative resolution, orphan top-level shadowing, target selection, and missing packages through the public extension-load seam.
- [x] 4.2 Replace `TrayExtension.path` and path overrides with a documented platform-neutral native artifact descriptor and exact-file custom descriptor.
- [x] 4.3 Implement a deep Node resolver that reads facade package/contract manifests, uses package resolution from the facade origin, validates package target metadata, and returns exact path plus expected identity.
- [x] 4.4 Update WebView and Badge official facades to declare descriptors; introduce the same mounted `LynxExt` shape instead of manual identity-free loading.
- [x] 4.5 Remove normal package-root reconstruction from the broker request contract and preserve only explicit exact-file / diagnostic override inputs.
- [x] 4.6 Add concise intent comments at descriptor resolution and exact-path dispatch explaining package-manager authority and the zero-repair consumer contract.
- [x] 4.7 Run focused TypeScript tests/typechecks, mark verified Phase One BDD/tasks, and commit code/tests/task evidence together.

## 5. Phase Two - Extension Manifest And Structured Errors

- [x] 5.1 Add red `opentray-spec` / `opentray-bin` tests requiring manifest and structured-error ABI symbols and proving manifest validation occurs before init.
- [x] 5.2 Add one canonical extension contract manifest per official facade and include it in packed package files.
- [x] 5.3 Replace the dynamic extension ABI with required manifest and structured-error buffer symbols; update C-compatible types and required-symbol law.
- [x] 5.4 Export embedded manifests from WebView, Badge, and Lynx using facade package version, contract fingerprint, target, and build identity supplied from one source of truth.
- [x] 5.5 Validate exact expected/actual identities generically in `opentray-bin`; never parse extension product commands.
- [x] 5.6 Preserve structured init/command/session-cleanup error category and message through `ExtensionError` and client-visible kernel errors.
- [x] 5.7 Update native staging/release verification to compare packed facade expectation, platform metadata, and embedded manifest; add stale-binary failure fixture.
- [x] 5.8 Add concise intent comments at pre-init validation and structured error extraction.
- [x] 5.9 Run focused Rust/facade/release tests plus linkage/size inspection, mark verified Phase Two BDD/tasks, and commit code/tests/task evidence together.

## 6. Phase Three - Broker Artifact Identity

- [x] 6.1 Add red daemon lifecycle tests for matching reuse, mismatched replacement, missing-identity replacement, bounded stop, and concurrent starts.
- [x] 6.2 Resolve the broker command once per start attempt and compute a SHA-256 artifact identity from executable bytes plus target.
- [x] 6.3 Pass broker artifact identity/path to the spawned broker and write them into caller-scoped `ready.json` on macOS/Linux and Windows.
- [x] 6.4 Add broker artifact identity to protocol ready frames and validate expected/actual identity before client init succeeds.
- [x] 6.5 Under the daemon lock, replace live brokers whose ready identity is missing/mismatched; reuse only exact matches and preserve caller/version isolation.
- [x] 6.6 Add concise intent comments at the liveness-versus-identity decision and bounded replacement path.
- [x] 6.7 Run focused lifecycle/protocol/Rust transport tests, mark verified Phase Three BDD/tasks, and commit code/tests/task evidence together.

## 7. Consumer And Repository Verification

- [x] 7.1 Pack current packages and build a clean temporary pnpm consumer that loads an official extension without artifact overrides.
- [x] 7.2 Add an orphan older top-level platform package to the temporary consumer and prove facade-relative exact resolution still selects the current packed artifact.
- [x] 7.3 Run the equivalent clean flat npm-compatible resolution fixture or deterministic packed-tarball test.
- [x] 7.4 Run `cargo test -p opentray-spec -p opentray-core -p opentray-bin -p opentray-ext-webview -p opentray-ext-badge -p opentray-ext-lynx`.
- [x] 7.5 Run `pnpm --filter @opentray/spec test`, `pnpm --filter opentray test`, and all official extension facade tests/typechecks.
- [x] 7.6 Run `pnpm run build`, `pnpm run verify`, `openspec validate --all --strict`, and `git diff --check`.
- [x] 7.7 Build release broker/native extensions, inspect sizes and `otool -L`, and run the source-tree visible WebView smoke without diagnostic overrides.
- [x] 7.8 Run `bun run openspec:vision -- validate make-native-artifact-resolution-authoritative` after final implementation/task evidence.

## 8. Independent Review / Self-Review Loop

- [x] 8.1 Run `bun run openspec:vision -- commit-check make-native-artifact-resolution-authoritative --phase self-review`.
- [x] 8.2 Run the two-axis code review from the pre-change fixed point: Standards against `AGENTS.md` and repo skills, Spec against this change's `plans/plan.md` and delta specs.
- [x] 8.3 Resolve every review finding, reopen affected tasks, rerun relevant red/green and full gates, and commit any OpenSpec corrections before more implementation.
- [x] 8.4 Generate `review/self-review.md` comparing every intent/spec/phase/verification requirement against current evidence.
- [x] 8.5 Generate separate `review/self-review.html` presenting the three artifact identity flows, verification commands, and final evidence without embedding it in Markdown.
- [x] 8.6 If review enters another loop, run `bun run openspec:vision -- review-state make-native-artifact-resolution-authoritative` and persist recurrence evidence.
- [x] 8.7 Close final re-review findings: use release target names for Windows packed consumers, close the top-level SDK session after tray teardown or creation failure, and classify loader incompatibility from structured categories rather than message text.
- [x] 8.8 Re-run focused red/green tests, packed pnpm/npm consumers, `pnpm run build`, and the full `pnpm run verify` gate after the final fixes.

## 9. Archive / Completion Audit

- [x] 9.1 Confirm all task checkboxes are backed by current-context command or artifact evidence and no requirement is inferred from a narrower test.
- [x] 9.2 Run `bun run openspec:vision -- commit-check make-native-artifact-resolution-authoritative --phase archive`.
- [x] 9.3 Archive with the repository-supported OpenSpec archive command and keep archive/spec sync separate from product-code commits.
- [x] 9.4 Commit the archive result as a dedicated `docs(spec):` commit.
- [x] 9.5 Run the final vision-driven check against the archived change, strict all-spec validation, clean-worktree audit, and requirement-by-requirement completion audit.
