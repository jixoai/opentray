## 1. Alignment / Investigation

- [x] 1.1 Confirm local npm trust verification still fails from current auth context.
- [x] 1.2 Confirm `changeset status --verbose` currently includes unwanted placeholder extension bumps.
- [x] 1.3 Confirm changesets supports range-gating peer-dependent bumps.

## 2. BDD Contract

- [x] 2.1 Scenario: Given first-stage changeset When release status is calculated Then only `opentray`, `@opentray/spec`, and `@opentray/ext-webview` are release targets.
- [x] 2.2 Scenario: Given roadmap extension placeholders When `opentray` remains in peer range Then they are not bumped.

## 3. Implementation

- [x] 3.1 Configure changesets to update peer dependents only when peer ranges are out of range.
- [x] 3.2 Update release docs/skill reference to record the peer-dependent release law.

## 4. Verification

- [x] 4.1 Run `pnpm exec changeset status --verbose`.
- [x] 4.2 Run `pnpm run build`.
- [x] 4.3 Run `npm pack --dry-run --json ./packages/cli ./packages/spec ./packages/ext-webview` after build.
- [x] 4.4 Run `pnpm run verify`.
- [x] 4.5 Run `openspec validate --all --strict`.
- [x] 4.6 Run `bun run openspec:vision -- validate fix-changeset-peer-release-bumps`.
- [x] 4.7 Run `bun run openspec:vision -- check fix-changeset-peer-release-bumps`.
- [x] 4.8 Run `git diff --check`.

## 5. Self-Review Loop

- [x] 5.1 Generate `review/self-review.md`.
- [x] 5.2 Generate `review/self-review.html`.
- [ ] 5.3 Archive the completed change after verification.
