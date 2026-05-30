# Intent Document

## Current Round

- Round: 1
- Status: Ready for apply
- Previous plan backup: none

## Workflow Command Surface

- Create change: `bun run openspec:vision -- new <change>`
- Check status: `bun run openspec:vision -- status <change>`
- Get artifact instructions: `bun run openspec:vision -- instructions <artifact> <change>`
- Strictly validate change files: `bun run openspec:vision -- validate <change>`
- Check commit evidence: `bun run openspec:vision -- commit-check <change> --phase <phase>`
- Rename after intent realignment: `bun run openspec:vision -- rename <old-change> <new-change>`
- Write abnormal-exit handoff: `bun run openspec:vision -- handoff <change>`
- Final workflow proof gate: `bun run openspec:vision -- check <change>`

## Original User Input

> 我已经初步把这些包都发布到npm上了，接下来，需要你配置 trusted publish。在scripts/目录下搞批量配置脚本（自动跳过已经配置好的）
>
> 如图： [Image #1] 使用图中的配置。
> 完成配置后，就可以配置 changesets ，然后 CI/CD 就可以实现 自动发布 release、自动发布 npm 包
> > 我记得可以用 命令 `npm trust github $pkg --repo <your-repo-name> --workflow <your-workflow.yml> --yes` 我没记错吧

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | 已经初步把这些包发布到 npm，需要配置 trusted publish。 | Script should target existing npm packages and should be safe to rerun. |
| 1 | User | 在 `scripts/` 目录下搞批量配置脚本，自动跳过已经配置好的。 | Add a batch script that discovers workspace packages, checks current trusted publisher state, and skips matches. |
| 1 | User | 使用图片配置：GitHub Actions, org `jixoai`, repo `opentray`, workflow `release.yml`, environment `npm-release`, allow `npm publish` and `npm stage publish`. | Script defaults and CI workflow must match these exact claims. |
| 1 | User | 配置 changesets，使 CI/CD 自动发布 release、自动发布 npm 包。 | Add changesets config, root scripts, and GitHub Actions release workflow. |
| 1 | User | Asked whether `npm trust github $pkg --repo <repo> --workflow <workflow.yml> --yes` is remembered correctly. | Correct the syntax to current npm CLI: `--file`, not `--workflow`, plus allowed action flags. |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| npm CLI docs | `npm trust github` requires npm >= 11.10.0, existing package, `--file`, repo/env flags, and at least one allowed action flag. | The script must use current CLI semantics. |
| npm trusted publishing docs | GitHub workflow file must exist under `.github/workflows/`; trusted publishing requires `id-token: write`; trusted publishing automatically generates provenance. | The release workflow must include OIDC permission and should not require `--provenance`. |
| changesets/action README | The action can create a release PR or run a configured publish command. | The CI should delegate version PR/publish orchestration to changesets/action. |
| `pnpm -r list --depth -1` | Workspace package names are `opentray` and `@opentray/*`. | Trusted publish script should discover these package names from workspace manifests. |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts | Will commit with implementation due small pipeline setup task. |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | Will commit after verification. |
| Self-review updates | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | Will produce before commit. |
| Normal archive | Commit containing `openspec archive <change>` result | Not archiving unless requested. |
| Abnormal handoff | Commit containing `HANDOFF.md` / `vN.HANDOFF.md` evidence before returning to user discussion | Not needed. |

## Intent

### Surface Intent

Make npm trusted publishing and changesets-based release automation repeatable for every OpenTray package.

### Underlying Drive

OpenTray has many npm packages. Manual npm UI setup across every package will drift and is hard to audit. The repository needs a scriptable trust configuration law and a release workflow whose OIDC claims match that trust configuration exactly.

### Final Visible Effect

The operator can run one command to configure or check trusted publishing for all packages, and GitHub Actions can publish via changesets without long-lived npm write tokens.

## Platform Diagnosis

- Current platform laws: monorepo package naming is stable; `packages/cli` publishes `opentray`; all other packages publish `@opentray/*`.
- Does this fit as a regular atom: Yes. Release automation is a repository operations atom.
- Does this require law upgrade: No runtime law change; it hardens distribution law.
- Breaking update stance: Safe.
- User confirmations still required: Actual npm trusted publisher mutation may require npm auth/2FA and the workflow file to exist on GitHub.

## Reverse-Inferred Design

### Interface Shape

- `pnpm run trusted-publish:configure` configures npm trusted publishers.
- `pnpm run trusted-publish:check` checks configuration without mutating npm.
- `pnpm run trusted-publish:dry-run` shows intended changes.
- `pnpm run changeset`, `pnpm run version-packages`, and `pnpm run release` drive changesets.

### Data Shape

Trusted publisher claims:

- Provider: GitHub Actions
- Repository: `jixoai/opentray`
- Workflow file: `release.yml`
- Environment: `npm-release`
- Allowed actions: `npm publish` and `npm stage publish`

### Architecture Shape

The script discovers workspace package manifests, not a hard-coded package list. The CI workflow uses the same workflow filename and environment name as npm trust configuration.

## Intent-Driven Plan

- [x] 1. Research npm trusted publishing syntax and changesets action behavior.
- [x] 2. Write specs and tasks for trusted publishing / release pipeline.
- [ ] 3. Implement trusted publish batch script.
- [ ] 4. Configure changesets and release workflow.
- [ ] 5. Verify scripts, OpenSpec change, and workflow syntax.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| Should the script mutate npm immediately? | npm requires package write auth and may validate the workflow file on GitHub. | Implement and dry-run/check locally; run configure after workflow is committed/pushed if auth allows. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Use `--workflow` in npm command | Current npm CLI uses `--file`; `--workflow` is not the documented flag. |
| Store `NPM_TOKEN` in GitHub Secrets | Trusted publishing removes the need for a long-lived npm write token. |

## Exit Conditions

- Default max review iterations: 5
- Issue recurrence threshold: 2
- Custom exit condition from intent: release workflow and script are committed and verified; actual npm mutation is attempted or clearly reported blocked by external auth/state.
