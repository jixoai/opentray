## 1. Alignment / Investigation

- [x] 1.1 Confirm the latest `plans/plan.md` reflects the corrected target: future split packages need one-shot npm package bootstrap plus trusted-publish configuration.
- [x] 1.2 Confirm live npm proof for `@opentray/example`: initial publish with `NPM_TOKEN`, trusted publisher configuration with password+TOTP, and final registry/trust verification.
- [x] 1.3 Confirm no destructive migration or trust replacement is assumed by default; replacement must require an explicit flag.

## 2. BDD Contract

- [x] 2.1 Scenario: Given a package is missing from npm When bootstrap runs in dry-run mode Then it reports initial publish and trust commands without mutating npm.
- [x] 2.2 Scenario: Given a package already exists on npm When bootstrap runs Then it skips initial publish and never attempts to overwrite a version.
- [x] 2.3 Scenario: Given a package has matching trusted publisher claims When bootstrap verifies trust Then it skips trust creation and reports already trusted.
- [x] 2.4 Scenario: Given token auth can publish packages but cannot inspect trust When bootstrap classifies auth Then it reports trust-auth blocked rather than package authority missing.
- [x] 2.5 Scenario: Given initial publish succeeds but `npm view` briefly returns 404 When bootstrap verifies visibility Then it retries with bounded backoff before final failure.
- [x] 2.6 Scenario: Given a trust mismatch exists When bootstrap runs without replacement confirmation Then it stops before revoking or recreating trust.
- [x] 2.7 Confirm each task checkbox is updated only after the task is completed and verified in the current working context.

## 3. Implementation

- [x] 3.1 Run `bun run openspec:vision -- commit-check research-npm-trusted-publish-auth --phase apply` before product-code work starts and commit ready OpenSpec artifacts.
- [x] 3.2 Add tests for bootstrap option parsing, package-kind manifest defaults, registry state classification, trust state matching, and report redaction.
- [x] 3.3 Implement `scripts/npm/bootstrap-package.ts` with dry-run default and explicit live mutation flags.
- [x] 3.4 Implement publish auth via temporary `.env` `NPM_TOKEN` npm config.
- [x] 3.5 Implement trust auth modes for ambient auth and legacy-env auth with temporary npm session, generated TOTP, and redacted output.
- [x] 3.6 Implement registry visibility retry after initial publish.
- [x] 3.7 Add root script `npm:bootstrap-package`.
- [x] 3.8 Add concise intent comments at critical effect points for the publish-before-trust law and registry propagation retry.
- [x] 3.9 Update only completed task checkboxes and commit them with matching implementation/test evidence.

## 4. Verification

- [x] 4.1 Run targeted tests for the bootstrap script.
- [x] 4.2 Run bootstrap dry-run for a hypothetical `@opentray/ext-webview-darwin-arm64` package without mutating npm.
- [x] 4.3 Run `bun run openspec:vision -- validate research-npm-trusted-publish-auth`.
- [x] 4.4 Run `git diff --check`.
- [x] 4.5 Run the repo-level gate relevant to this change, at minimum `pnpm run test` or the specific script test command if full repo tests are unrelatedly expensive.
- [ ] 4.6 Run `bun run openspec:vision -- commit-check research-npm-trusted-publish-auth --phase self-review` before writing final review evidence.

## 5. Self-Review Loop

- [ ] 5.1 Generate `review/self-review.md` comparing implementation against `plans/plan.md`, specs, and tasks.
- [ ] 5.2 Generate `review/self-review.html` as structured evidence for the npm bootstrap proof and dry-run verification.
- [ ] 5.3 If review updates OpenSpec artifacts or reopens tasks, commit those artifact changes before the next apply loop.
- [ ] 5.4 If the review enters a real loop, run `bun run openspec:vision -- review-state research-npm-trusted-publish-auth`.
- [ ] 5.5 If review cannot exit normally, run `bun run openspec:vision -- handoff research-npm-trusted-publish-auth` and commit the handoff evidence.
- [ ] 5.6 Do not archive until the user accepts the implemented bootstrap script and npm proof.
- [ ] 5.7 Run `bun run openspec:vision -- check research-npm-trusted-publish-auth` before claiming workflow completion.
