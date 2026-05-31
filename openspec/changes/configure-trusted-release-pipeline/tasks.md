## 1. Alignment / Investigation

- [x] 1.1 Confirm npm trusted publisher CLI syntax and required flags.
- [x] 1.2 Confirm the package set from workspace manifests.

## 2. BDD Contract

- [x] 2.1 Scenario: Given expected trust claims When script dry-run is used Then every public workspace package resolves to `npm trust github <pkg> --repo jixoai/opentray --file release.yml --env npm-release --allow-publish --allow-stage-publish --yes`.
- [x] 2.2 Scenario: Given release workflow is inspected When trusted publishing is used Then workflow has `id-token: write`, environment `npm-release`, and no `NPM_TOKEN` dependency.
- [x] 2.3 Confirm each task checkbox will be updated only by the agent that completed and verified that task in the current working context.

## 3. Implementation

- [x] 3.1 Add trusted publisher batch script under `scripts/`.
- [x] 3.2 Add root package scripts for trusted publish configure/check/dry-run.
- [x] 3.3 Add changesets config and root changeset/version/release scripts.
- [x] 3.4 Add GitHub Actions `release.yml` with OIDC permissions and `npm-release` environment.
- [x] 3.5 Update README/AGENTS with release operations.

## 4. Verification

- [x] 4.1 Run trusted publish script in dry-run mode.
- [x] 4.2 Run trusted publish check/configure against npm and record external auth result.
- [x] 4.3 Run workspace verification.
- [x] 4.4 Run `git diff --check`.

## 5. Self-Review Loop

- [x] 5.1 Generate `review/self-review.md`.
- [x] 5.2 Generate `review/self-review.html`.
- [x] 5.3 Run `bun run openspec:vision -- check configure-trusted-release-pipeline`.

## 6. First-Stage Release Hardening

- [ ] 6.1 Add a build gate before changesets publish in `.github/workflows/release.yml`.
- [ ] 6.2 Add a first-stage changeset for `opentray`, `@opentray/spec`, and `@opentray/ext-webview`.
- [ ] 6.3 Update README release instructions so local release validation includes build output.

## 7. OpenTray Skill Codification

- [ ] 7.1 Initialize `skills/opentray` with `$skill-creator`.
- [ ] 7.2 Replace generated skill TODOs with concise navigation and laws.
- [ ] 7.3 Add independent extension articles for `ext-webview`, `ext-badge`, and `ext-island`.
- [ ] 7.4 Add supporting articles for kernel runtime, backend adapters, extension host, visual acceptance, and release operations.
- [ ] 7.5 Run the skill validator.

## 8. Final Verification

- [ ] 8.1 Run `pnpm run build`.
- [ ] 8.2 Run `pnpm run verify`.
- [ ] 8.3 Run `openspec validate --all --strict`.
- [ ] 8.4 Run `bun run openspec:vision -- validate configure-trusted-release-pipeline`.
- [ ] 8.5 Run `bun run openspec:vision -- check configure-trusted-release-pipeline`.
- [ ] 8.6 Run `git diff --check`.
