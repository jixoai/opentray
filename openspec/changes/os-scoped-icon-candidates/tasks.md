## 1. Alignment / Investigation

- [x] 1.1 Confirm `interview_plan.md` records the user requirement, language context, code evidence, decisions, rejected paths, and confirmation gates.
- [x] 1.2 Confirm this change declares `schema: vision2` and does not introduce legacy `plans/plan.md`, plan-backup, or self-review artifacts.
- [x] 1.3 Confirm `tray-icon` is already available with `with_icon_as_template` and that the OS-selection law belongs in tray-icon projection/native adapter atoms.

## 2. BDD Contract

- [x] 2.1 Scenario: Given current-OS icon-only and generic icon-only are both present When the resolver selects icon-only Then current-OS icon-only wins.
- [x] 2.2 Scenario: Given non-current OS candidates are present When the resolver runs on another OS Then they do not shadow generic candidates.
- [x] 2.3 Scenario: Given Darwin icon-text carries `isTemplate` and `text` When selected on Darwin Then image, text, and template metadata reach the tray-icon projection.
- [x] 2.4 Scenario: Given generic icon candidates and simple fallback already work When OS candidates are absent Then existing priority behavior is unchanged.
- [x] 2.5 Confirm each task checkbox is updated only by the agent that completed and verified that task in the current working context.

## 3. Implementation

- [x] 3.1 Run `bun run openspec:vision2 -- commit-check os-scoped-icon-candidates --phase apply` before app-code work starts if OpenSpec artifacts are committed; if not committed in this session, record that limitation before code edits.
- [x] 3.2 Extend `@opentray/spec` TypeScript icon types with Darwin, Win32, and Linux candidate keys while keeping one `icon` field.
- [x] 3.3 Extend Rust `opentray-spec` icon model and custom serde for the six OS-scoped kebab-case keys.
- [x] 3.4 Implement current-OS candidate filtering in `opentray-backend-tray-icon` projection without adding OS concepts to `opentray-core`.
- [x] 3.5 Carry Darwin template metadata through compiled tray-icon assets and call `with_icon_as_template` in the native builder.
- [x] 3.6 Update docs and changeset for patch release impact.
- [x] 3.7 When a new problem surfaces during implementation, create a typed issue with `bun run openspec:vision2 -- issues os-scoped-icon-candidates --new <bug|task|decision|risk|question> --title "<title>"` instead of silently editing the plan.
- [x] 3.8 Do not add legacy plan-backup or self-review-loop artifacts to this workflow.

## 4. Verification

- [x] 4.1 Run `bun test scripts/openspec/vision2-driven.test.ts`.
- [x] 4.2 Run `bun run openspec:vision2 -- validate os-scoped-icon-candidates`.
- [x] 4.3 Run `bun test packages/spec`.
- [x] 4.4 Run `pnpm --filter @opentray/spec typecheck`.
- [x] 4.5 Run `cargo test -p opentray-backend-tray-icon projection`.
- [x] 4.6 Run `cargo test -p opentray-spec`.
- [x] 4.7 Run `openspec validate --all --strict`.
- [x] 4.8 Run `pnpm run build`.
- [x] 4.9 Run `pnpm run verify`.
- [x] 4.10 Run `git diff --check`.

## 5. Close

- [x] 5.1 Write `toc.md` with a preface plus a footnote reference block that cites every spec file.
- [x] 5.2 Confirm there are no active `issues/*.md` files for this change.
- [x] 5.3 Run `bun run openspec:vision2 -- check os-scoped-icon-candidates` to verify footnote coverage, issue convergence, and artifact presence.
- [x] 5.4 Record macOS template visual smoke as non-blocking; existing visible examples do not specifically exercise a selected Darwin template candidate.
