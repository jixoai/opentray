# Intent Document

## Current Round

- Round: 4
- Status: Live npm bootstrap proof complete; `@opentray/example@0.0.0` was published and trusted publishing was configured/verified.
- Previous plan backup: `plans/plan-v3.md`

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

> 不是，现在的关键，是我们的ext-webview可能会扩展成 ext-webview-windows|linux|darwin-* 这样的包，这种情况下，我们就得另外发包另外测试，所以我要你做的research是，给一种通用的方案或者脚本：能一次性完成一个包的初始化和trusted publish的配置。

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | Research whether `.env` `NPM_TOKEN` can prove publish capability and whether password+OTP can configure trusted publishing. | Establish npm auth boundaries before designing automation. |
| 2 | User | Corrected the research target: `ext-webview` may split into platform packages such as `ext-webview-windows|linux|darwin-*`; these packages need separate publish and testing. | The deliverable is not only current trust state. It is a generic bootstrap law for future packages. |
| 2 | User | Asked for a general solution or script that can complete one package's initialization and trusted-publish configuration in one shot. | Design an idempotent package bootstrap script that can create/validate a workspace package, publish its initial npm version if needed, configure trusted publishing, and verify state. |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `skills/opentray/references/release.md` | Trusted publisher claims must be GitHub Actions, repo `jixoai/opentray`, workflow `release.yml`, environment `npm-release`, allowed publish + stage publish. | Every future package must receive these exact trust claims. |
| `openspec/specs/release-pipeline/spec.md` | Release CI must use OIDC trusted publishing and must not require long-lived `NPM_TOKEN`. | The bootstrap script can use local secrets only for initial setup; CI publish remains OIDC-only. |
| `.github/workflows/release.yml` | Workflow has `id-token: write`, environment `npm-release`, npm `^11.10.0`, build before publish, and no `NPM_TOKEN`. | Future package trust config will match the already-existing release workflow claims. |
| `scripts/npm/configure-trusted-publish.ts` | Existing script checks/configures trust for already-published packages, but token-only trust inspection returns `E403` for this npm account. | Future one-shot bootstrap cannot simply call token-authenticated trust config. It needs a trust-auth path. |
| `npx -y npm@latest help trust --viewer=cat` | `npm trust` requires package write access, 2FA enabled, and an already-existing package; bypass-2FA GAT and legacy basic auth credentials do not work for trust endpoints. | One-shot bootstrap must publish or detect the package before it configures trusted publishing. |
| Token-authenticated npm checks | `.env` `NPM_TOKEN` authenticates as `kezhaofeng`; package/collaborator access is `read-write`; token cannot read trust endpoints (`E403`). | Use `NPM_TOKEN` for initial package publish authority, not for trust management. |
| Temporary `npm login --auth-type legacy` research | Username/password/TOTP can create a temporary npm session; trust endpoints succeed when a fresh TOTP is passed as `NPM_CONFIG_OTP`. | Use a temporary session + per-command OTP as the script's trust-auth mechanism if full one-shot automation is required. |
| Current package survey | Existing public workspace packages include platform packages (`@opentray/darwin-*`, `@opentray/linux-*`, `@opentray/windows-*`) and extension facade packages (`@opentray/ext-webview`, `@opentray/ext-badge`, `@opentray/ext-island`). | Future `@opentray/ext-webview-*` packages should follow the same manifest/provenance law but may need extension-specific peer dependencies. |
| Live bootstrap proof: `@opentray/example` | `npm publish --access public` using `.env` `NPM_TOKEN` published `@opentray/example@0.0.0`; `npm dist-tag ls` returned `latest: 0.0.0`; `npm access get status` returned public. | The initial-publish half of the one-shot script is viable with existing local token material. |
| Live trust proof: `@opentray/example` | Temporary `npm login --auth-type legacy` plus generated `NPM_CONFIG_OTP` configured `npm trust github @opentray/example --repo jixoai/opentray --file release.yml --env npm-release --allow-publish --allow-stage-publish --yes`; final `npm trust list --json` returned the matching trust config. | The trusted-publish half of the one-shot script is viable without manual npm UI when password+TOTP are available. |
| Registry read-after-write behavior | Immediately after publish, `npm view @opentray/example version` returned 404 for a short period while `npm access list packages` already showed the package; later `npm view` returned `0.0.0`. | The script must retry registry visibility before trust configuration/verification and must not treat the first post-publish 404 as failure. |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts | Research-plan updated only. If we implement the script, specs/tasks should be added first. |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | Not started. |
| Self-review updates | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | Not started. |
| Normal archive | Commit containing `openspec archive <change>` result | Not started. |
| Abnormal handoff | Commit containing `HANDOFF.md` / `vN.HANDOFF.md` evidence before returning to user discussion | Not needed. |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
| `openspec/specs/release-pipeline/spec.md` | Trusted publishing must be batched, idempotent, and OIDC-based. | Extend with a package bootstrap requirement if implementation proceeds. |
| `openspec/changes/archive/2026-05-31-configure-trusted-release-pipeline` | Prior change implemented a trust script for already-existing packages. | Extend, do not replace: bootstrap covers the missing precondition, initial package existence. |
| `skills/opentray/references/release.md` | `NPM_TOKEN` can exist locally but CI must not use it for release publish. | Reuse. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| “不是，现在的关键” | Previous research answered a narrower question than needed. | Refocus on future package bootstrap, not current package state. |
| “ext-webview-windows|linux|darwin-*” | Official WebView extension may split native dynamic-library packages by platform and possibly arch. | `@opentray/ext-webview` remains facade; platform packages are independent npm atoms. |
| “另外发包另外测试” | Each split package needs its own npm package lifecycle and verification. | Bootstrap must cover package existence, initial publish, trust config, and dry-run/pack checks. |
| “一次性完成一个包的初始化和trusted publish的配置” | One operator command should take a local package from not-yet-published to npm-visible and trusted-publish-ready. | The script must sequence publish before trust configuration because npm trust requires an existing package. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| Temporary one-off Node/expect scripts under OS temp dir | Can legacy login + TOTP operate trust endpoints without global npm login? | Delete; implementation should use a safer project script if accepted. |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| Should the first script be fully one-shot with automated legacy login, or a portable script that requires an already-authenticated npm session for trust? | Fully one-shot requires PTY automation for `npm login --auth-type legacy`; Node core cannot portably drive that prompt without an extra dependency or platform `expect`. | Recommend a pragmatic local-operator script with two auth modes: default portable ambient auth, plus macOS/dev `legacy-env` helper guarded by explicit flag. |
| Should initial package bootstrap publish `0.0.0` placeholders, or only publish when real binaries/artifacts exist? | Publishing is immutable and creates public package surface. | For platform native packages, publish `0.0.0` placeholders only when we need npm trust configured before real binary release; otherwise publish the first real version. |

## Intent

### Surface Intent

Provide a general package bootstrap solution for future split packages such as `@opentray/ext-webview-darwin-arm64`, `@opentray/ext-webview-linux-x64`, and `@opentray/ext-webview-windows-x64`: one command should initialize the package locally if needed, publish the initial npm package if missing, configure trusted publishing, and verify the result.

### Underlying Drive

OpenTray will keep gaining orthogonal package atoms. Manual npm UI setup does not scale and is easy to forget when a new atom appears. The release platform needs a repeatable bootstrap law so future native extension packages become CI-publishable without bespoke setup.

The live proof succeeded: a new empty package, `@opentray/example@0.0.0`, was published and then configured with the expected trusted publisher. A human-interactive npm UI fallback is not required for this account as long as `.env` keeps valid `NPM_TOKEN`, `NPM_WHOAMI`, `NPM_PASSWORD`, and `NPM_2FA_SECRET`.

### Final Visible Effect

An operator can run a command shaped like:

```bash
pnpm run npm:bootstrap-package -- \
  --package @opentray/ext-webview-darwin-arm64 \
  --dir packages/ext-webview-darwin-arm64 \
  --kind extension-platform \
  --initial-version 0.0.0 \
  --publish-if-missing \
  --configure-trust \
  --trust-auth legacy-env
```

The command prints a per-stage report:

- local workspace package exists or was created;
- package manifest has repository/provenance metadata and public access policy;
- package pack/build dry-run passed;
- npm package exists or initial publish succeeded;
- trusted publisher exists or was configured;
- final trust state matches `jixoai/opentray`, `release.yml`, `npm-release`, publish + stage publish.

## Platform Diagnosis

- Current platform laws: release automation is OIDC/trusted-publish based; `NPM_TOKEN` is local operator tooling only; workflow claims must match npm trusted publisher claims exactly.
- Does this fit as a regular atom: Yes. This is a release-operations atom that completes the lifecycle for new npm package atoms.
- Does this require law upgrade: Yes, but only inside release operations: existing trust script assumes packages already exist; the new law must include package bootstrap before trusted publisher configuration.
- Breaking update stance: Do not change CI to use `NPM_TOKEN`; do not make the facade package carry platform binaries just to avoid package bootstrap.
- User confirmations still required: Whether to implement automated `legacy-env` login with platform-specific PTY tooling or keep trust auth as an explicit ambient login step.

## Reverse-Inferred Design

### Interaction / Visual Story

The user decides a new atom name. The script makes npm registry state catch up with repo state. It should be safe to rerun: existing package means skip initial publish; existing matching trust means skip trust mutation; mismatch means stop with a clear remediation path unless `--replace-trust` is explicitly passed.

### Interface Shape

Proposed script:

```bash
pnpm run npm:bootstrap-package -- [options]
```

Core options:

- `--package <name>`: required npm package name.
- `--dir <path>`: package directory; default derived from package name under `packages/`.
- `--kind <plain|platform|extension-platform>`: controls minimal manifest defaults.
- `--initial-version <version>`: default `0.0.0`.
- `--create-workspace`: create package directory/manifest/README if missing.
- `--publish-if-missing`: publish the initial version only if `npm view <pkg>` is 404.
- `--configure-trust`: ensure trusted publisher after package exists.
- `--publish-auth <token|legacy-env|ambient>`: auth mode for initial publish.
- `--trust-auth <ambient|legacy-env>`: auth mode for trust endpoints.
- `--dry-run`: default; print intended commands and validations.
- `--yes`: required for live publish/trust mutation.
- `--replace-trust`: revoke and recreate mismatched trust; off by default.

Package kind defaults:

- `plain`: `files: ["README.md"]`.
- `platform`: `files: ["bin", "README.md"]`, repository metadata, public access.
- `extension-platform`: `files: ["dist", "platforms", "README.md"]`, `peerDependencies.opentray: ">=0.0.0"`, repository metadata, public access.

Auth behavior:

- `publish-auth token`: reads `.env` `NPM_TOKEN`, writes a temporary `.npmrc`, runs `npm publish --access public`.
- `publish-auth legacy-env`: uses temp login session and `NPM_CONFIG_OTP` if token publish is blocked by 2FA.
- `trust-auth ambient`: uses existing npm login; requires operator/browser OTP if npm asks.
- `trust-auth legacy-env`: reads `.env` `NPM_WHOAMI`, `NPM_PASSWORD`, `NPM_2FA_SECRET`, creates a temporary npm session, generates TOTP, and passes `NPM_CONFIG_OTP` to `npm trust`.

Research-proofed default for this repo:

- initial publish: `publish-auth token`;
- trust configuration: `trust-auth legacy-env`;
- registry visibility: retry `npm view` / `npm dist-tag ls` after publish before trust operations.

### Data Shape

The script must report these states separately:

- local workspace package: missing, created, existing, invalid manifest;
- npm package: missing, existing, published, publish failed;
- package authority: token whoami, collaborator access, owner;
- trust state: missing, matching, mismatched, configured, auth-blocked;
- package artifact: build skipped, build passed, pack dry-run passed, pack failed.
- registry visibility: pending, visible, timed out.

### Architecture Shape

This belongs under `scripts/npm/`, not product packages. It is a release-ops platform law:

- no special case for `ext-webview` inside the script;
- package kind templates encode generic manifest defaults;
- all package-specific behavior remains in the package's own source/build scripts;
- CI release remains changesets + OIDC trusted publishing.

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| Fully automated `legacy-env` login | Requires secret-bearing prompt automation; portable Node does not provide a PTY. | Prefer implementing this behind an explicit flag and using temp files/redaction only. |
| Initial publish of placeholders | Creates immutable public npm versions. | Use `--publish-if-missing --yes`; default dry-run only. |
| Trust replacement | npm currently supports one trust config per package; replacing requires revoke. | Stop on mismatch unless `--replace-trust --yes` is explicit. |

## Intent-Driven Plan

- [x] 1. Research npm trust preconditions and auth boundaries.
- [x] 2. Correct the research target from current package state to future package bootstrap.
- [x] 3. Define the generic one-shot lifecycle: local init, artifact validation, initial publish, trust configure, final verify.
- [x] 4. Define idempotency and safety rules for package existence, existing trust, mismatched trust, and immutable versions.
- [x] 5. Live-test initial publish with an empty scoped package.
- [x] 6. Live-test trusted-publish configuration for that package.
- [x] 7. Record registry read-after-write retry requirement.
- [ ] 8. Add release-pipeline spec requirements for package bootstrap.
- [ ] 9. Add BDD tasks for dry-run, existing package skip, missing package publish plan, matching trust skip, trust auth failure, registry propagation retry, and final report.
- [ ] 10. Implement `scripts/npm/bootstrap-package.ts` or equivalent with dry-run default.
- [ ] 11. Add root script `npm:bootstrap-package`.
- [ ] 12. Verify with a dry-run for a hypothetical `@opentray/ext-webview-darwin-arm64` package.

## Live Bootstrap Proof

Target package: `@opentray/example`

Observed flow:

1. `npm view @opentray/example version --json` returned `E404` before publish.
2. A temporary empty package was created outside the repo with:
   - `name: "@opentray/example"`;
   - `version: "0.0.0"`;
   - repository `https://github.com/jixoai/opentray`;
   - `publishConfig.access: "public"`;
   - `files: ["README.md"]`.
3. `npm pack --dry-run --json` succeeded.
4. `npm publish --access public --registry https://registry.npmjs.org/` succeeded and printed `+ @opentray/example@0.0.0`.
5. `npm access list packages @opentray --json` included `@opentray/example: read-write`.
6. `npm access get status @opentray/example --json` returned public.
7. `npm dist-tag ls @opentray/example` returned `latest: 0.0.0`.
8. Temporary `npm login --auth-type legacy` succeeded using `.env` credentials and generated TOTP.
9. Initial `npm trust list @opentray/example --json` returned no trusted publisher.
10. `npm trust github @opentray/example --repo jixoai/opentray --file release.yml --env npm-release --allow-publish --allow-stage-publish --yes` succeeded.
11. Final `npm trust list @opentray/example --json` returned:
    - `type: github`;
    - `file: release.yml`;
    - `repository: jixoai/opentray`;
    - `environment: npm-release`;
    - permissions `createPackage`, `createStagedPackage`.

Important behavior:

- Immediately after successful publish, `npm view @opentray/example version` returned 404 for a short window even though `npm access list packages` already showed the package. Later `npm view` returned `"0.0.0"`.
- Therefore the production script needs a registry propagation wait loop after initial publish.

## Recommended Script Algorithm

1. Parse and validate package identity.
2. Resolve package directory and package kind.
3. If `--create-workspace`, create minimal package files when missing.
4. Validate `package.json`:
   - `name` equals `--package`;
   - `version` exists;
   - `repository.url` is `https://github.com/jixoai/opentray`;
   - scoped packages have `publishConfig.access: "public"` or publish command uses `--access public`;
   - package is not `private`.
5. Run package build if a `build` script exists.
6. Run `npm pack --dry-run --json` from the package directory.
7. Run `npm view <pkg> version --json`.
8. If package is missing and `--publish-if-missing --yes`, publish initial version with selected publish auth.
9. If initial publish succeeds, wait for registry visibility using `npm view <pkg> version`, `npm dist-tag ls <pkg>`, and bounded retry/backoff.
10. If package exists, skip publish and never try to overwrite the version.
11. Run `npm trust list <pkg> --json` with selected trust auth.
12. If trust matches, skip.
13. If trust is missing and `--configure-trust --yes`, run:

```bash
npm trust github <pkg> \
  --repo jixoai/opentray \
  --file release.yml \
  --env npm-release \
  --allow-publish \
  --allow-stage-publish \
  --yes
```

14. If trust mismatches, stop unless `--replace-trust --yes`.
15. Re-run `npm trust list <pkg> --json`.
16. Print a machine-readable JSON report and a human-readable summary.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| Should we accept a macOS-only `expect` fallback for `legacy-env`, or add a real PTY dependency if full automation matters cross-platform? | `npm login --auth-type legacy` needs a TTY; stdin piping failed in research. | For this repo, prefer no new native dependency yet; implement `legacy-env` only if a safe local PTY mechanism is accepted. |
| Should split `ext-webview` packages be OS-only or OS+arch? | Dynamic libraries are usually arch-specific; package naming affects bootstrap and optional dependency layout. | Use OS+arch packages during unstable ABI: `@opentray/ext-webview-darwin-arm64`, etc. |
| Should new platform packages start at `0.0.0` or first real release version? | Trusted publishing requires package existence, but placeholder versions are public forever. | Use `0.0.0` only for packages that must have trust configured before real release. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Configure trusted publisher before first publish | npm trust requires the package to already exist. |
| Put all future WebView dynamic libraries into `@opentray/ext-webview` | It bloats install size and breaks atom isolation. |
| Store `NPM_TOKEN` in GitHub Actions for new packages | Violates the release law; CI publish must remain OIDC trusted publishing. |
| Make the script silently revoke/recreate trust on mismatch | Too destructive for npm package settings; require an explicit flag. |
| Depend on raw username/password basic auth for trust endpoints | npm trust rejects legacy basic auth credentials; the working path is session token plus OTP. |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: 2
- Custom exit condition from intent: Met for research. A real empty package was published and trusted publishing was configured. Not met for implementation until specs/tasks and the reusable script are added and dry-run verified.
