# Intent Document

## Current Round

- Round: 2
- Status: Research complete; npm auth boundaries and current trusted-publisher state are fixed by live evidence.
- Previous plan backup: `plans/plan-v1.md`

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
| 1 | User | Research whether `.env` `NPM_TOKEN` can prove publish capability for this package set. | Use live npm auth checks and dry-run packaging; do not perform a real publish. |
| 1 | User | Research whether `NPM_PASSWORD` + OTP generated from `NPM_2FA_SECRET` can configure trusted publishing via `npm trust github ...`. | Treat trusted-publish management as a separate auth capability from package publish access. |
| 1 | User | Update the change file with research+plan, then research and update a new plan with uncertainties fixed. | Keep `plans/plan.md` as the resolved SSOT and preserve the first draft as `plans/plan-v1.md`. |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `skills/opentray/references/release.md` | Trusted publisher claims must be GitHub Actions, repo `jixoai/opentray`, workflow `release.yml`, environment `npm-release`, allowed publish + stage publish. | These claims are the target state for all checks. |
| `openspec/specs/release-pipeline/spec.md` | Release CI must use OIDC trusted publishing and must not require long-lived `NPM_TOKEN`. | `NPM_TOKEN` can be local operator evidence, not CI publish infrastructure. |
| `.github/workflows/release.yml` | Workflow has `id-token: write`, environment `npm-release`, npm `^11.10.0`, build before publish, and no `NPM_TOKEN`. | Workflow claims match npm trusted-publisher requirements. |
| `scripts/npm/configure-trusted-publish.ts` | Existing script can use `.env` token or ambient login, resolves an npm runtime with trust action flags, and skips mutation if state inspection fails. | The script is safe, but token-only mode cannot inspect trust on this npm account. |
| `.env` presence check | `NPM_TOKEN`, `NPM_2FA_SECRET`, `NPM_PASSWORD`, and `NPM_WHOAMI` are present. | Research can run without asking for credentials and without printing secret values. |
| `npm trust` help from path npm `11.12.1` | Local path npm lacks `--allow-publish` / `--allow-stage-publish` in `npm trust github --help`. | Runtime support must be detected by command help, not by version alone. |
| `npx -y npm@latest trust github --help` | npm `11.16.0` supports `--file`, `--repo`, `--env`, `--allow-publish`, `--allow-stage-publish`, `--yes`. | Existing script correctly falls back to `npx -y npm@latest`. |
| `npx -y npm@latest help trust --viewer=cat` | Trust commands require npm 11.10+, package write access, account 2FA, existing package, and at least one permission flag; bypass-2FA GAT and legacy basic auth credentials are not supported. | The supported path is a login/session token plus OTP, not raw username/password basic auth. |
| Token-authenticated `npm whoami` | `.env` `NPM_TOKEN` authenticates as `kezhaofeng`. | Token identity matches the intended npm operator. |
| Token-authenticated `npm access list packages @opentray --json` | All `@opentray/*` public workspace packages report `read-write`. | Token can prove scoped package write authority. |
| Token-authenticated `npm access list collaborators opentray --json` | `opentray` reports `kezhaofeng: read-write`. | Token can prove unscoped package write authority. |
| Token-authenticated `npm owner ls <pkg>` and `npm view <pkg> version --json` | All 11 public workspace packages exist on npm; first-stage packages are `0.1.0`, placeholders/platform packages are `0.0.0`; owner is `kezhaofeng`. | No package is missing for trusted-publish configuration. |
| Token-authenticated `npm publish --dry-run` for `opentray`, `@opentray/spec`, `@opentray/ext-webview` | Dry-run reaches tarball validation and then rejects already-published version `0.1.0`. | Packaging path is visible; a real publish proof would require a new version, so dry-run cannot be the only authority proof. |
| Token-authenticated `pnpm run trusted-publish:check` | Fails with `E403` on `GET /-/package/<pkg>/trust`. | `.env` `NPM_TOKEN` cannot read or write trusted-publisher configuration. |
| Ambient `pnpm run trusted-publish:check --auth ambient` | Fails with `E401`; global npm is not logged in. | Ambient login is not currently usable. |
| Temporary `npm login --auth-type legacy` with username/password/TOTP | Succeeds and writes an auth token to a temporary `.npmrc`; `npm whoami` succeeds from that temp session. | Password+TOTP can create an npm CLI session without polluting global `~/.npmrc`. |
| Temporary login then `npm trust list` without OTP | Fails with `EOTP` and returns an npm browser authentication URL. | Trust endpoints require per-operation 2FA unless an authenticated skip window is active. |
| Temporary login then `NPM_CONFIG_OTP=<totp> npm trust list` | Succeeds for `@opentray/spec`. | Password+TOTP plus `NPM_CONFIG_OTP` can operate trust endpoints. |
| Temporary login then all-package `npm trust list` with fresh OTP | All 11 public workspace packages have matching `github` trust config: `release.yml`, `jixoai/opentray`, `npm-release`, `createPackage`, `createStagedPackage`. | Trusted publishing is already correctly configured for the current package set. |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts | Research plan exists; no product code should start from this change without specs/tasks if implementation is requested. |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | Not started. |
| Self-review updates | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | Not started. |
| Normal archive | Commit containing `openspec archive <change>` result | Not started. |
| Abnormal handoff | Commit containing `HANDOFF.md` / `vN.HANDOFF.md` evidence before returning to user discussion | Not needed. |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
| `openspec/specs/release-pipeline/spec.md` | Trusted publishing must be batched, idempotent, and OIDC-based; release CI must not depend on long-lived `NPM_TOKEN`. | Reuse. |
| `openspec/changes/archive/2026-05-31-configure-trusted-release-pipeline` | Prior change implemented script/workflow and recorded that npm trust mutation may be externally auth-blocked. | Extend the operational knowledge: token-only is blocked, password+TOTP session works. |
| `skills/opentray/references/release.md` | `NPM_TOKEN` is only for local operator management, not GitHub Actions publish. | Reuse. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| “看能不能发这个包” | Prove npm write authority without publishing a real version. | `NPM_TOKEN` can authenticate and show read-write package access; real publish still needs a new version. |
| “CI/CD的自动release” | GitHub Actions should publish through OIDC trusted publishing. | Release workflow should not need `NPM_TOKEN`. |
| “password+otp” | Legacy npm login plus generated TOTP, then pass OTP into trust commands. | Use a temporary session token and `NPM_CONFIG_OTP`; do not rely on raw basic auth. |
| “把plan中的不确定因素都固定下来” | Replace assumptions with command evidence and concrete next steps. | This plan records yes/no outcomes for auth, package existence, and trust state. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| Temporary one-off Node/expect scripts under OS temp dir | Can legacy login + TOTP operate trust endpoints without global npm login? | Delete; evidence is recorded here, but temp code is not product code. |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| Should the repository script grow a first-class `--auth legacy-env` mode using `NPM_WHOAMI`/`NPM_PASSWORD`/`NPM_2FA_SECRET`? | Current `trusted-publish:check` fails with token-only auth even though a temporary login + OTP works. | Recommended if maintainers need repeatable CLI checks without manual browser auth. |
| Should actual trust mutation be performed by the script in future, or remain an operator-only recovery path now that all packages are configured? | All packages are already trusted, so mutation is not needed today. | Keep mutation path but do not run it unless a future package is missing/mismatched. |

## Intent

### Surface Intent

Research npm publish authority and trusted-publish configuration using the existing local `.env` credentials, then update this OpenSpec plan from uncertainty to evidence-backed next steps.

### Underlying Drive

OpenTray's release law should be auditable and reproducible. The code-side release pipeline exists; the risk was external npm auth state. That risk is now split cleanly:

- publish/package write authority can be proven by `NPM_TOKEN`;
- trusted-publisher management cannot use this `NPM_TOKEN`;
- trusted-publisher management can use a temporary legacy-login session plus per-operation TOTP;
- all current public workspace packages are already correctly configured.

### Final Visible Effect

The operator can stop worrying about initial trusted-publish setup for the current package set. Every public workspace package already has the expected GitHub trusted publisher. For future packages, the operator knows the working auth path: temporary `npm login --auth-type legacy`, then `npm trust ...` with `NPM_CONFIG_OTP` or browser 2FA.

## Platform Diagnosis

- Current platform laws: release automation is OIDC/trusted-publish based; `NPM_TOKEN` is local operator tooling only; workflow claims must match npm trusted-publisher claims exactly.
- Does this fit as a regular atom: Yes. This is release-operations research under the existing release-pipeline law.
- Does this require law upgrade: No release-law upgrade is required. A script ergonomics upgrade is useful because token-only check mode cannot inspect trust state.
- Breaking update stance: Do not store long-lived tokens in CI even if token package access works.
- User confirmations still required: Whether to add a secret-bearing legacy-env automation mode to `scripts/npm/configure-trusted-publish.ts`.

## Reverse-Inferred Design

### Interaction / Visual Story

The operator should see deterministic rows per package:

- package exists;
- account has read-write package authority;
- trusted publisher state matches `jixoai/opentray` + `release.yml` + `npm-release`;
- missing/mismatched rows can be configured with the same claims.

### Interface Shape

Current supported checks:

- `NPM_TOKEN` path:
  - proves `npm whoami`;
  - proves package/collaborator read-write access;
  - cannot inspect or mutate trust state for this account/token.
- temporary login + OTP path:
  - `npm login --auth-type legacy` with `NPM_WHOAMI`, `NPM_PASSWORD`, generated TOTP;
  - pass fresh OTP through `NPM_CONFIG_OTP` / `npm_config_otp` to `npm trust list` or `npm trust github`;
  - use `npx -y npm@latest` when path npm help does not expose action flags.

Potential script upgrade:

- `--auth legacy-env` reads the same `.env` keys, creates a temp userconfig, logs in through a PTY/expect-compatible flow, generates TOTP, and supplies `NPM_CONFIG_OTP` per trust command.
- It must never print password, OTP, or generated auth tokens.
- It should default to check/list first and mutate only missing packages.

### Data Shape

Do not confuse these states:

- token authenticates as `NPM_WHOAMI`: confirmed;
- token can read package metadata: confirmed;
- token/account has package write authority: confirmed by read-write access and ownership/collaborator checks;
- token can mutate trusted publisher configuration: false, `E403`;
- temporary login + OTP can operate trust endpoints: confirmed;
- package exists on npm: confirmed for all 11 public workspace packages;
- package already has expected trust claims: confirmed for all 11 public workspace packages.

### Architecture Shape

This is an operations atom. It does not change product runtime, core kernel, broker, or extension boundaries. If implementation follows, it belongs under `scripts/npm/` and release-pipeline docs/specs. CI release must remain OIDC-only.

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| Add `--auth legacy-env` | It automates password + TOTP handling and therefore carries higher secret-handling risk. | Recommend adding only if maintainers need repeatable trust checks for future packages. |
| Run actual trust mutation | Changes npm package settings. | Not needed now; all packages are already configured. |
| Publish a new version to prove actual registry write | Would create public immutable artifacts. | Do not do this for research. Use release workflow after product changes are ready. |

## Intent-Driven Plan

- [x] 1. Confirm current npm CLI trusted-publish syntax from npm CLI/help.
- [x] 2. Use `.env` `NPM_TOKEN` through a temporary npm userconfig to verify `npm whoami`.
- [x] 3. Enumerate public workspace packages and verify npm registry existence/current version.
- [x] 4. Check whether token-authenticated npm commands can prove package/publish authority without real publish.
- [x] 5. Check current trusted publisher state for all public workspace packages.
- [x] 6. If token-authenticated trust management is blocked, generate OTP from `NPM_2FA_SECRET` and test whether legacy login plus password can run `npm trust github`.
- [x] 7. If trusted-publish mutation succeeds or is already configured, record exact package result table.
- [x] 8. Back up the first plan and replace it with this resolved evidence-backed plan.
- [ ] 9. Optional next implementation: add `--auth legacy-env` support to `scripts/npm/configure-trusted-publish.ts` and document the safe operator flow.
- [ ] 10. Optional next verification: run the first real release workflow after the next package version bump lands on `main`.

## Trusted Publisher State Table

| Package | npm version | Package authority | Trusted publisher |
| ------- | ----------- | ----------------- | ----------------- |
| `opentray` | `0.1.0` | owner/collaborator `read-write` | `github`, `jixoai/opentray`, `release.yml`, `npm-release`, publish + stage publish |
| `@opentray/spec` | `0.1.0` | `read-write` | `github`, `jixoai/opentray`, `release.yml`, `npm-release`, publish + stage publish |
| `@opentray/ext-webview` | `0.1.0` | `read-write` | `github`, `jixoai/opentray`, `release.yml`, `npm-release`, publish + stage publish |
| `@opentray/ext-badge` | `0.0.0` | `read-write` | `github`, `jixoai/opentray`, `release.yml`, `npm-release`, publish + stage publish |
| `@opentray/ext-island` | `0.0.0` | `read-write` | `github`, `jixoai/opentray`, `release.yml`, `npm-release`, publish + stage publish |
| `@opentray/darwin-arm64` | `0.0.0` | `read-write` | `github`, `jixoai/opentray`, `release.yml`, `npm-release`, publish + stage publish |
| `@opentray/darwin-x64` | `0.0.0` | `read-write` | `github`, `jixoai/opentray`, `release.yml`, `npm-release`, publish + stage publish |
| `@opentray/linux-arm64` | `0.0.0` | `read-write` | `github`, `jixoai/opentray`, `release.yml`, `npm-release`, publish + stage publish |
| `@opentray/linux-x64` | `0.0.0` | `read-write` | `github`, `jixoai/opentray`, `release.yml`, `npm-release`, publish + stage publish |
| `@opentray/windows-arm64` | `0.0.0` | `read-write` | `github`, `jixoai/opentray`, `release.yml`, `npm-release`, publish + stage publish |
| `@opentray/windows-x64` | `0.0.0` | `read-write` | `github`, `jixoai/opentray`, `release.yml`, `npm-release`, publish + stage publish |

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| Should `trusted-publish:check` support `--auth legacy-env`? | Token-only check fails even when npm trust is correct, so future maintainers cannot verify from `.env` without a custom one-off login flow. | Yes, but only if implemented with temp files, redaction, and no global npmrc mutation. |
| Should the next release be triggered now or after broker-transport implementation? | Release workflow proof is the final external CI/CD acceptance, but current changesets only cover daemon/protocol changes. | Wait until the next intended package release point unless user asks to publish immediately. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Real `npm publish` to prove authority | It mutates the public registry and requires a new immutable version. |
| Storing `NPM_TOKEN` in GitHub Actions | Violates the existing release law; trusted publishing should use OIDC. |
| Printing `.env` secrets for debugging | Credentials are secret-bearing infrastructure. |
| Treating token `E403` as package permission failure | Access checks prove package write authority; trust management has a separate auth boundary. |
| Using raw legacy basic auth for trust endpoints | npm trust documentation says legacy basic auth credentials do not work for trust commands/endpoints. The working path is login-created session token plus OTP. |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: 2
- Custom exit condition from intent: Met for research. A resolved plan records npm token auth, package existence/access, trust state/configure result, legacy-login feasibility, and the exact next action for release readiness.
