## 1. Alignment / Investigation

- [ ] 1.1 Confirm `plans/plan.md` records the user requirement for `stable-A-B` / `alpha-A-B` protocol-line evolution and same-major minor compatibility.
- [ ] 1.2 Confirm existing runtime authority stays in broker handshake, endpoint identity, and extension ABI validation rather than npm dist-tags.
- [ ] 1.3 Confirm there is no approved destructive migration, state reset, or CI write-token change in this change.

## 2. BDD Contract

- [ ] 2.1 Add BDD coverage proving a current OpenTray protocol line formats to `<channel>-<major>-<minor>` from `@opentray/spec` source of truth.
- [ ] 2.2 Add BDD coverage proving `stable-A-B` compatibility accepts earlier minors in the same major and rejects different majors.
- [ ] 2.3 Add BDD coverage proving alpha uses the same major/minor compatibility law as stable.
- [ ] 2.4 Add BDD coverage proving release tag planning emits the current line selector for public workspace packages without extension-specific names.
- [ ] 2.5 Add BDD coverage or doc checks proving public guidance distinguishes `latest` convenience from protocol-line compatibility selectors.
- [ ] 2.6 Confirm each task checkbox is updated only after the current context has completed and verified the matching work.

## 3. Implementation

- [ ] 3.1 Run `bun run openspec:vision -- commit-check evolve-opentray-protocol-line-major-minor --phase apply` before product-code work starts and record the result.
- [ ] 3.2 Extend `@opentray/spec` protocol-line APIs with explicit line comparison / compatibility helpers while keeping extension names out of the type and parser shape.
- [ ] 3.3 Update protocol-line release tooling so generated tag plans derive from current line metadata and expose the selector clearly enough for AI-driven release work.
- [ ] 3.4 Add concise intent comments at critical effect points where the code separates install-time protocol-line selection from runtime protocol authority.
- [ ] 3.5 Update internal developer skills for release and extension packaging so maintainers know when a protocol-line bump requires tag and package-selector updates.
- [ ] 3.6 Update external `skills/opentray` usage docs so consumers and their AI agents know when to use `latest`, `stable-A-B`, and `alpha-A-B`.
- [ ] 3.7 Update only current-context completed task checkboxes and keep task progress paired with matching code or documentation evidence.

## 4. Verification

- [ ] 4.1 Run `pnpm --filter @opentray/spec test`.
- [ ] 4.2 Run targeted npm protocol dist-tag planner tests.
- [ ] 4.3 Run `pnpm run typecheck` if public TypeScript API shape changes.
- [ ] 4.4 Run `bun run openspec:vision -- validate evolve-opentray-protocol-line-major-minor`.
- [ ] 4.5 Run `git diff --check`.
- [ ] 4.6 Run `bun run openspec:vision -- commit-check evolve-opentray-protocol-line-major-minor --phase self-review` before writing final review evidence.

## 5. Self-Review Loop

- [ ] 5.1 Generate `review/self-review.md` comparing implementation against `plans/plan.md`, specs, and tasks.
- [ ] 5.2 Generate `review/self-review.html` as separate structured evidence presentation.
- [ ] 5.3 If review updates OpenSpec artifacts or reopens tasks, commit those artifact changes before the next apply loop.
- [ ] 5.4 If review enters a real loop, persist review state through the project controller before continuing.
- [ ] 5.5 If review cannot exit normally, run `bun run openspec:vision -- handoff evolve-opentray-protocol-line-major-minor` and commit handoff evidence before returning to user discussion.
- [ ] 5.6 If review exits normally, run `bun run openspec:vision -- check evolve-opentray-protocol-line-major-minor` and leave archive timing for user acceptance.
