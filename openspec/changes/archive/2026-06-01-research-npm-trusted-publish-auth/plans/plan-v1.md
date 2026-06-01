# Intent Document

## Current Round

- Round: 1
- Status: Research plan drafted; npm auth and trusted-publish mutation facts still need live verification.
- Previous plan backup: None.

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

> 我们需要research一些东西：
> 1. 你看一下能不能用 .env 里面的 NPM_TOKEN 看能不看发这个包?
> 2. 但是我们要做CI/CD的自动release的话，还得配置 trusted publish。我在 .env 文件中配置了几个字段：
> ```
> NPM_TOKEN=
> NPM_2FA_SECRET=
> NPM_PASSWORD=
> NPM_WHOAMI=
> ```
>
> 你可以探索一下用password+otp能不能实现 trusted publish 的配置`npm trust github [package] --file [--repo|--repository] [--env|--environment] [--allow-publish] [--allow-stage-publish] [-y|--yes]`
> > 可能需要先做`npm login --auth-type legacy`输入 Username、Password、OTP
>
> 更新change文件我要的research+plan。然后开始进行research，把plan中的不确定因素都固定下来，更新出一份新的plan

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | Research whether `.env` `NPM_TOKEN` can prove publish capability for this package set. | Use live npm auth checks, but do not perform a real publish. |
| 1 | User | Research whether `NPM_PASSWORD` + OTP generated from `NPM_2FA_SECRET` can configure trusted publishing via `npm trust github ...`. | Treat trusted-publish management as an external auth capability to pin down with evidence. |
| 1 | User | Update the change file with research+plan, then research and update a new plan with uncertainties fixed. | Keep this plan as the SSOT; after research, back it up and replace with a resolved plan. |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `skills/opentray/references/release.md` | Trusted publisher claims must be GitHub Actions, repo `jixoai/opentray`, workflow `release.yml`, environment `npm-release`, allowed publish + stage publish. | These claims are the target state for research and commands. |
| `openspec/specs/release-pipeline/spec.md` | The release pipeline already requires batch trusted-publisher configuration, OIDC workflow claims, no CI `NPM_TOKEN`, and changesets automation. | This change should verify external auth state, not redesign the release law unless evidence forces it. |
| `.github/workflows/release.yml` | Workflow has `id-token: write`, environment `npm-release`, npm `^11.10.0`, build before publish, and no `NPM_TOKEN`. | The workflow side appears aligned; npm-side trust mutation is the unknown. |
| `scripts/npm/configure-trusted-publish.ts` | Script reads `.env` `NPM_TOKEN`, injects a temporary npm userconfig, lists existing trust, and runs `npm trust github ... --file release.yml --env npm-release --allow-publish --allow-stage-publish --yes`. | Existing script is the primary tool to test. |
| `.env` field presence check | `NPM_TOKEN`, `NPM_2FA_SECRET`, `NPM_PASSWORD`, and `NPM_WHOAMI` are present locally. | Research can run without asking the user for credentials, while keeping values redacted. |
| `npm --version` | Local npm is `11.12.1`. | It should support the current `npm trust github` command shape. |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts | Not ready; research plan only. |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | Not started. |
| Self-review updates | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | Not started. |
| Normal archive | Commit containing `openspec archive <change>` result | Not started. |
| Abnormal handoff | Commit containing `HANDOFF.md` / `vN.HANDOFF.md` evidence before returning to user discussion | Not needed. |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
| `openspec/specs/release-pipeline/spec.md` | Trusted publishing must be batched, idempotent, and OIDC-based; release CI must not depend on long-lived `NPM_TOKEN`. | Reuse. |
| `openspec/changes/archive/2026-05-31-configure-trusted-release-pipeline` | Prior change implemented script/workflow and recorded that npm trust mutation may be externally auth-blocked. | Extend by replacing auth uncertainty with live research evidence. |
| `skills/opentray/references/release.md` | `NPM_TOKEN` is only for local operator management, not GitHub Actions publish. | Reuse. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| “看能不能发这个包” | Prove publish authority without publishing a real version. | Validate npm account/package access and dry-run packaging. |
| “CI/CD的自动release” | GitHub Actions should publish through OIDC trusted publishing. | Release workflow should not need `NPM_TOKEN`. |
| “password+otp” | Legacy npm login using username/password plus time-based OTP. | A possible way to obtain an interactive npm session accepted by `npm trust github`. |
| “把plan中的不确定因素都固定下来” | Replace assumptions with command evidence and a concrete next plan. | Research should end with clear yes/no/blocked states. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| None planned | This is credential and external npm state research, not product runtime behavior. | Not applicable. |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| Should I mutate npm trusted publisher state if auth succeeds? | `npm trust github` changes live npm package settings. | Yes, because the user explicitly asked to explore trusted-publish configuration, but only with the already agreed claims. |
| Should unpublished placeholder packages be included? | Several `@opentray/*` packages are `0.0.0` placeholders and may not exist on npm. | Check all public workspace packages; report non-existing packages separately from auth failures. |

## Intent

### Surface Intent

Research npm publish authority and trusted-publish configuration using the existing local `.env` credentials, then update this OpenSpec change plan from uncertainty to evidence-backed next steps.

### Underlying Drive

OpenTray's release law should be auditable and reproducible. The code-side release pipeline already exists; the remaining risk is operator-side npm auth state: whether local credentials can manage package trust and whether CI can later publish without a long-lived token.

### Final Visible Effect

The operator can read one plan and know:

- whether `.env` `NPM_TOKEN` authenticates and has publish/package authority;
- whether trusted publishing is already configured or can be configured by script;
- whether password+OTP legacy login is necessary;
- exactly which packages are configured, missing, unpublished, or blocked by npm auth.

## Platform Diagnosis

- Current platform laws: release automation is OIDC/trusted-publish based; `NPM_TOKEN` is local operator tooling only; workflow claims must match npm trusted publisher claims exactly.
- Does this fit as a regular atom: Yes. This is release-operations research under the existing release-pipeline law.
- Does this require law upgrade: Not expected unless npm proves `NPM_TOKEN` and legacy login cannot manage trusted publishers.
- Breaking update stance: Do not store long-lived tokens in CI even if token publishing works.
- User confirmations still required: If research discovers that some placeholder packages are not published, user decides whether to publish placeholders now or only configure released packages.

## Reverse-Inferred Design

### Interaction / Visual Story

The operator runs a small number of commands and sees deterministic rows per package: token auth, package access, trusted publisher state, configure/skip result, and any external npm auth blocker.

### Interface Shape

Use existing scripts first:

- `pnpm run trusted-publish:check`
- `pnpm run trusted-publish:configure`
- targeted `npm whoami`, `npm access`, `npm view`, and `npm trust list` commands with a temporary userconfig from `.env`.

Use legacy login only if token-authenticated trust management fails for a reason that suggests interactive auth can help.

### Data Shape

Do not confuse these states:

- token authenticates as `NPM_WHOAMI`;
- token can read package metadata;
- token can publish package versions;
- account can mutate trusted publisher configuration;
- package exists on npm;
- package already has expected trust claims.

### Architecture Shape

This is an operations atom. It must not change product runtime, core kernel, broker, or extension boundaries. If code changes are needed, they belong under `scripts/npm/` and release-pipeline specs only.

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| Live trust mutation | Changes npm package settings. | Proceed only for packages that match existing release-pipeline claims. |
| Publishing missing packages | Would create public npm artifacts. | Do not publish during research. |

## Intent-Driven Plan

- [ ] 1. Confirm current npm CLI trusted-publish syntax from npm CLI/docs.
- [ ] 2. Use `.env` `NPM_TOKEN` through a temporary npm userconfig to verify `npm whoami`.
- [ ] 3. Enumerate public workspace packages and verify npm registry existence/current version.
- [ ] 4. Check whether token-authenticated npm commands can prove package/publish authority without real publish.
- [ ] 5. Check current trusted publisher state for all public workspace packages.
- [ ] 6. If token-authenticated trust management is blocked, generate OTP from `NPM_2FA_SECRET` and test whether legacy login plus password can run `npm trust github`.
- [ ] 7. If trusted-publish mutation succeeds or is already configured, record exact package result table.
- [ ] 8. Back up this plan and replace it with a resolved evidence-backed plan.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| Does `NPM_TOKEN` have enough package access to publish all public packages? | Determines whether local release smoke can use the token and whether publish blockers are auth or package-state related. | Unknown until `whoami`, package access, and dry-run checks run. |
| Does `npm trust github` accept token auth for trust mutation? | If not, the batch script needs either ambient login guidance or an operator login helper. | Unknown; prior skill notes warn token auth may return `E403`. |
| Does legacy `npm login --auth-type legacy` work non-interactively with username/password/TOTP? | Determines whether `.env` credentials can automate trust setup. | Unknown; test only if needed and without exposing secrets. |
| Are all public workspace packages already present on npm? | `npm trust github` requires existing packages. | Unknown; placeholders may not exist or may be intentionally unpublished. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Real `npm publish` to prove authority | It mutates the public registry and is not necessary for research. |
| Storing `NPM_TOKEN` in GitHub Actions | Violates the existing release law; trusted publishing should use OIDC. |
| Printing `.env` secrets for debugging | Credentials are secret-bearing infrastructure. |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: 2
- Custom exit condition from intent: A resolved plan records npm token auth, package existence/access, trust state/configure result, legacy-login feasibility if needed, and the exact next action for release readiness.
