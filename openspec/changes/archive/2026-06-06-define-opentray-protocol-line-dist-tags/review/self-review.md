# Vision-Driven Self Review

## Review State

- Change: `define-opentray-protocol-line-dist-tags`
- Iteration: 1
- Recurring issue counts: none
- Exit-condition judgment: normal apply can exit after OpenSpec validation/check and diff verification.
- Next loop action: no design loop required; next decision is whether to archive after user review.

## Intent Alignment

| Intent point | Evidence | Verdict |
| ------------ | -------- | ------- |
| Protocol-line tags are OpenTray-wide, not extension-specific | `@opentray/spec` exposes `OPENTRAY_PROTOCOL_FAMILY = "opentray-protocol"` and tests reject `stable-webview-1-0` / `alpha-lynx-1-0`. | Aligned |
| npm tag is install-time selector, not runtime authority | OpenSpec says runtime handshake and ABI validation remain authoritative; tests keep `PROTOCOL_VERSION` separate from `stable-1-0`. | Aligned |
| Release tooling can plan protocol-line tags | `scripts/npm/protocol-dist-tags.ts` emits dry-run-first `npm dist-tag add <pkg>@<version> <tag>` plans. | Aligned |
| Official extensions use the same OpenTray protocol-line tag as core | Internal extension skills now say extension facade/platform atoms share `stable-1-0` / `alpha-1-0`, with no extension-specific protocol-line names. | Aligned |
| External users get clear install guidance | `skills/opentray/references/getting-started.md` now distinguishes `latest`, `stable-1-0`, and `alpha-1-0`. | Aligned |

## Deviations From Intent

1. CI does not automatically mutate `stable-1-0` / `alpha-1-0` after publish. This is intentional: npm trusted publishing OIDC is publish/stage-publish oriented, while `npm dist-tag add` is a separate registry mutation that would require a separate auth decision.

## New Questions For User

1. Should OpenTray later allow a traditional npm write token only for `npm dist-tag add` in CI, or keep protocol-line tag updates as an operator-authenticated command until npm exposes a trusted-publishing path for dist-tag mutation?

## Evidence

- HTML report: `review/self-review.html`
- Command evidence:
  - `pnpm --filter @opentray/spec test`: 17 tests passed.
  - `bun test scripts/npm/protocol-dist-tags.test.ts`: 4 tests passed.
  - `bun test scripts/npm/*.test.ts`: 11 tests passed.
  - `pnpm run protocol-tags:dry-run -- --channel stable --package opentray --package @opentray/spec`: emitted `stable-1-0` tag plan.
  - `pnpm run typecheck`: completed for `@opentray/spec`, `opentray`, `@opentray/ext-lynx`, and `@opentray/ext-webview`.
- Git commits reviewed:
  - `03a16fd feat: tray extension mounts and tray icon normalization` is already on local `main` ahead of `origin/main`; this review does not modify that commit.
  - `b0efd60 chore: version packages` is `origin/main`.
- Uncommitted paths, if any:
  - `.changeset/smooth-lobsters-burn.md`
  - `openspec/changes/define-opentray-protocol-line-dist-tags/**`
  - `package.json`
  - `packages/spec/src/index.ts`
  - `packages/spec/src/index.test.ts`
  - `scripts/npm/protocol-dist-tags.ts`
  - `scripts/npm/protocol-dist-tags.test.ts`
  - `.agents/skills/develop-opentray/references/release.md`
  - `.agents/skills/develop-opentray-ext/references/boundaries.md`
  - `.agents/skills/develop-opentray-ext/references/platform-packages.md`
  - `skills/opentray/SKILL.md`
  - `skills/opentray/references/getting-started.md`
- Task checkboxes updated by this working context: yes, only current change tasks were checked.

## HTML Review Report

Created `review/self-review.html` as the structured evidence presentation. No screenshots are required because this is a protocol/release tooling change.

## Exit Handling

- Normal exit should run `bun run openspec:vision -- validate define-opentray-protocol-line-dist-tags`.
- Normal exit should run `bun run openspec:vision -- check define-opentray-protocol-line-dist-tags`.
- Do not archive until the user accepts this law, because the remaining product decision is whether protocol-line tag mutation should stay operator-authenticated or eventually become CI-authenticated.
