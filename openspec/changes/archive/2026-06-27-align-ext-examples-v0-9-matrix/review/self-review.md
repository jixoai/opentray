# Vision-Driven Self Review

## Review State

- Change: `align-ext-examples-v0-9-matrix`
- Iteration: 1
- Recurring issue counts: none
- Exit-condition judgment: normal exit is technically available after commit evidence; archive should wait for operator acceptance because this change modifies runnable examples and proof workflow.
- Next loop action: commit implementation and review evidence, then run final `check`; do not enter another research loop unless the operator wants Lynx carrier rebuilds inside the local matrix.

## Intent Alignment

| Intent point | Evidence | Verdict |
| ------------ | -------- | ------- |
| Provide a finite replacement for shell `example:*` | `packages/cli/package.json` adds `example:matrix`; planner tests assert stable row ids and no `example:*` argument. | Aligned |
| Stage generated default runtime artifacts before visible binding | `visible-binding` row runs `cargo build -p opentray-runtime-node`, `pnpm --filter opentray build`, and `stage-local --kind runtime`; full matrix passed. | Aligned |
| Keep extension proof in extension/debug-runtime lane | Rows for WebView, badge, placement, media-query, and Lynx are labeled `extension-debug-runtime`; docs distinguish this from default runtime coverage. | Aligned |
| Keep extension atoms out of core | No core edits. Lynx loading now uses `tray.loadExtension({ name: "lynx", path: "@opentray/ext-lynx" })`; WebView and badge remain facade/native-crate owned. | Aligned |
| Pass the improved matrix and focused extension gates | Full matrix passed; `opentray` typecheck/tests passed; WebView, badge, and Lynx facade/native tests passed. | Aligned |
| Avoid committing generated artifacts | `packages/darwin-arm64/runtime/` was removed after smoke; no generated runtime artifact remains in `git status`. | Aligned |

## Deviations From Intent

1. The literal command `pnpm --filter opentray example:*` is not a safe shell surface in zsh because the shell expands or rejects the wildcard before pnpm sees it. The implemented stable surface is `pnpm --filter opentray example:matrix`.
2. Lynx carrier rebuild is not part of the local matrix. The matrix builds and stages the current Lynx dylib from source, then uses the existing packaged `OpenTrayLynxRuntime.app.zip` as required carrier evidence.
3. The visible-binding example needed a longer worker startup delay. This is not a platform law change; it avoids racing the main-thread visible runtime host registration.

## New Questions For User

1. Should the Lynx carrier rebuild become a required CI-only matrix family, separate from the local source-tree matrix?
2. Should this OpenSpec change be archived immediately after review, or kept open until the operator inspects the new matrix behavior?

## Evidence

- HTML report: `review/self-review.html`
- Matrix behavior tests: `pnpm --filter opentray test` passed with 11 files and 63 tests.
- Type gate: `pnpm --filter opentray typecheck` passed.
- Full example matrix: `pnpm --filter opentray example:matrix` passed all 9 rows: `basic`, `visible-binding`, `webview-control`, `debug-runtime-tray`, `tray-panel`, `placement`, `media-query`, `badge`, `lynx`.
- Extension facade gates: `pnpm --filter @opentray/ext-webview test`, `pnpm --filter @opentray/ext-badge test`, and `pnpm --filter @opentray/ext-lynx test` passed.
- Native extension gates: `cargo test -p opentray-ext-webview`, `cargo test -p opentray-ext-badge`, and `cargo test -p opentray-ext-lynx` passed.
- Ontology audit: `rg` over `packages/ext-*`, `crates/opentray-ext-*`, and `packages/cli/examples` found no live `space-recorded`, `spaceId`, lease, or broker-owned assumptions; remaining hits were headings, changelog history, or Windows graphics type names.
- Git commits reviewed: `23cd57e docs(spec): add ext example matrix plan`; `ff703b5 test: add opentray example matrix`.
- Uncommitted paths at review time: review artifacts and final review task checkbox updates only.
- Task checkboxes updated by this working context: 1.3, 2.1-2.5, 3.1-3.6, and 4.1-4.4. The 3.1 evidence was inherited from committed OpenSpec setup `23cd57e`; current context verified that commit exists before checking it.

## Exit Handling

- Normal exit: commit implementation plus review evidence, run `bun run openspec:vision -- check align-ext-examples-v0-9-matrix`, then ask the operator whether to archive.
- Abnormal exit: not applicable; no repeated unresolved issue remains.
- Intent realignment: not needed; the change id still matches the target.
