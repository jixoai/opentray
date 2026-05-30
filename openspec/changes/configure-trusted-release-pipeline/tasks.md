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
- [x] 4.2 Run OpenSpec validation and workflow check.
- [x] 4.3 Run workspace verification.
- [x] 4.4 Run `git diff --check`.

## 5. Self-Review Loop

- [x] 5.1 Generate `review/self-review.md`.
- [x] 5.2 Generate `review/self-review.html`.
- [x] 5.3 Run `bun run openspec:vision -- check configure-trusted-release-pipeline`.
