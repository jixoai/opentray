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

> 我已经手动配置好全部仓库的trusted publish，你可以继续完成剩下的代码

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | 已经手动配置好全部仓库的 trusted publish。 | Treat npm-side trust setup as externally completed, but verify what the local auth context can verify. |
| 1 | User | 可以继续完成剩下的代码。 | Continue release-readiness code instead of stopping at manual npm setup. |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `pnpm run trusted-publish:check` | `.env NPM_TOKEN` still returns `E403` for trust state reads. | The token cannot verify manual trust configuration; this is external auth state, not proof of bad repo code. |
| `bun run scripts/npm/configure-trusted-publish.ts --auth ambient --check` | Ambient npm auth returns `EOTP`. | Local verification still requires npm browser/OTP auth. |
| `pnpm exec changeset status --verbose` | First-stage changeset would bump `@opentray/ext-badge` and `@opentray/ext-island` to `1.0.0` as peer dependents of `opentray`. | Roadmap extension placeholders would be accidentally published as stable major packages. |
| `node_modules/@changesets/assemble-release-plan/src/determine-dependents.ts` | Changesets major-bumps peer dependents unless `onlyUpdatePeerDependentsWhenOutOfRange` is true. | The correct release law is a config change, not a package workaround. |
| `node_modules/@changesets/types/CHANGELOG.md` | The experimental flag only bumps peer dependents when peer dependency ranges leave range. | This matches OpenTray's first-stage release intent. |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts | Pending. |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | Pending. |
| Self-review updates | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | Pending. |
| Normal archive | Commit containing `openspec archive <change>` result | Pending. |
| Abnormal handoff | Commit containing `HANDOFF.md` / `vN.HANDOFF.md` evidence before returning to user discussion | Not needed. |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
| `openspec/specs/release-pipeline/spec.md` | Release-worthy development carries changesets and build-before-publish. | Extend with peer-dependent release containment. |
| `openspec/specs/monorepo-workspace/spec.md` | `ext-badge` and `ext-island` are initial packages, but not first-stage runtime/API packages. | Reuse package identity while preventing accidental stable release. |
| `skills/opentray/references/release.md` | Do not bump placeholder packages just because docs mention them. | Extend to encode the changesets peer-dependent trap. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| `trusted publish` | npm trusted publisher setup for all public packages. | External npm trust state. |
| `剩下的代码` | Remaining repository-side release readiness after manual npm setup. | Fix code/config gaps that would break or mis-shape CI release. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| none | `changeset status --verbose` is enough to expose the issue. | No demo needed. |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| Should roadmap extension placeholders be bumped in first-stage release? | Changesets currently plans a stable `1.0.0` for placeholder extensions. | No; first-stage should only release packages with actual API/runtime value. |

## Intent

### Surface Intent

Trusted publish is manually configured, so finish the remaining repository code needed for a clean release path.

### Underlying Drive

The release pipeline must not create misleading package versions. Placeholder extension atoms are valid package identities, but a first-stage release should not accidentally turn them into stable major releases because they peer-depend on `opentray`.

### Final Visible Effect

`pnpm exec changeset status --verbose` reports only `opentray`, `@opentray/spec`, and `@opentray/ext-webview` for the first-stage release. `@opentray/ext-badge` and `@opentray/ext-island` remain untouched until they gain real APIs.

## Platform Diagnosis

- Current platform laws: release pipeline is a repository operations law; extension packages are optional atoms.
- Does this fit as a regular atom: Yes.
- Does this require law upgrade: Yes, within release law only: peer-dependent bumps must be range-gated.
- Breaking update stance: Safe; this prevents accidental release expansion.
- User confirmations still required: None; the user asked to finish remaining code, and this is a release correctness bug.

## Reverse-Inferred Design

### Interaction / Visual Story

The operator runs `changeset status`, sees only first-stage packages, pushes, and trusts CI not to publish roadmap extension placeholders as stable packages.

### Interface Shape

Changesets config should express: peer dependents only update when their peer dependency range is actually out of range.

### Data Shape

The durable release set for this batch is:

- `opentray`
- `@opentray/spec`
- `@opentray/ext-webview`

Roadmap placeholder packages are not part of this release set.

### Architecture Shape

This stays in `.changeset/config.json` and release docs. Do not work around it by deleting peer dependencies or adding fake changesets for placeholder packages.

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| none | The desired behavior follows from first-stage release scope and placeholder package state. | Apply the range-gated peer-dependent policy. |

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [x] 2. Write specs from the intent.
- [x] 3. Write BDD tasks from specs.
- [ ] 4. Implement changesets peer-dependent release containment.
- [ ] 5. Verify release status, build, package dry-run, OpenSpec, and whitespace.
- [ ] 6. Self-review and archive.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| Can current local npm auth verify manual trusted publish? | It would close external trust evidence. | No; record `E403/EOTP` and continue repository code. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Remove `opentray` peer dependencies from roadmap extensions | The peer relation is semantically correct; only release bump behavior is wrong. |
| Add changesets for `ext-badge` and `ext-island` | That would publish placeholders as if they gained runtime/API value. |
| Ignore `changeset status` because CI will handle it | CI would inherit the same release plan. |

## Exit Conditions

- Default max review iterations: 5
- Issue recurrence threshold: 2
- Custom exit condition from intent: `changeset status` excludes placeholder extensions, build/package dry-run succeeds, and OpenSpec validates.
