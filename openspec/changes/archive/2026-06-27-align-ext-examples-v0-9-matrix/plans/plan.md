# Intent Document

## Current Round

- Round: 1
- Status: research-plan
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

> 重新梳理`ext-*`这些插件与0.9的内核的适配，改进 `pnpm --filter opentray example:*`的测试矩阵。并确保这些测试都能通过

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | Re-check all `ext-*` plugins against the v0.9 kernel. | Treat extension examples as v0.9 contract proof, not loose demos. |
| 1 | User | Improve the `pnpm --filter opentray example:*` test matrix. | Provide a runnable package-level matrix entrypoint, not only scattered README commands. |
| 1 | User | Ensure these tests pass. | Completion requires running the improved matrix and focused extension gates. |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `git status --short --branch` | `main` is clean and ahead of `origin/main` by 10. | New work starts from a clean v0.9 baseline. |
| `openspec/changes/opentray-v0-9/specs/extension-host/spec.md` | Extensions are scoped to tray/app runtime/session; `Space`, `surface`, and `Lease` must not cross the public extension boundary. | Matrix must catch old ontology leaking through official extension examples. |
| `openspec/changes/opentray-v0-9/specs/runtime-host/spec.md` | Default SDK visible binding is app-owned; local broker is contributor diagnostics. | Matrix must distinguish default runtime proof from debug-runtime extension proof. |
| `packages/cli/package.json` | Example scripts are individual entries; no single matrix script exists. | The requested `example:*` surface is not yet a stable proof command. |
| `pnpm --filter opentray example:basic` | Protocol-only example passes. | Baseline client/tray protocol example is healthy. |
| `pnpm --filter opentray example:*` | Fails in zsh with `no matches found: example:*`. | The literal requested command is not currently usable. |
| `OPENTRAY_EXAMPLE_EXIT_AFTER_MS=1000 pnpm --filter opentray example:visible-binding` | Fails when `@opentray/darwin-arm64/runtime/opentray_runtime.node` is not staged. | Matrix must build/stage runtime artifacts or explicitly choose a non-visible route. |
| `packages/cli/examples/_support/webview-example-support.ts` | WebView/badge examples auto-build native crates and set extension discovery env vars. | This setup should become matrix law, not one-off example behavior. |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts | Pending |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | Pending |
| Self-review updates | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | Pending |
| Normal archive | Commit containing `openspec archive <change>` result | Out of scope until user acceptance |
| Abnormal handoff | Commit containing `HANDOFF.md` / `vN.HANDOFF.md` evidence before returning to user discussion | Not needed yet |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
| `opentray-v0-9/specs/client-sdk/spec.md` | Public SDK is tray-first and host-bound; no public daemon object. | Reuse. |
| `opentray-v0-9/specs/extension-host/spec.md` | Extension host is tray/app/session-scoped and free of public `Space`/`Lease`. | Extend with example-matrix proof. |
| `opentray-v0-9/specs/runtime-host/spec.md` | Default runtime is visible binding; debug local broker is diagnostic. | Reuse and make matrix labels explicit. |
| `packages/cli/examples/EXAMPLE.md` | Has scattered WebView smoke recipes. | Consolidate into a package-level runnable matrix. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| `ext-*这些插件` | Official extension atoms: facade packages, platform packages, native crates, and source-tree examples. | All OpenTray extension families must fit the v0.9 kernel. |
| `0.9的内核` | Tray-first app/session/runtime laws from the v0.9 reset. | New tests must prove the new ontology, not old broker/space coupling. |
| `example:*的测试矩阵` | A command-level matrix for package examples. | Make example scripts runnable as a group with deterministic smoke settings. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| none yet | No spike needed; current examples already define the visible surface. | N/A |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| Should the matrix include Lynx visual carrier rebuild locally? | Full Lynx carrier may require CI/Xcode runtime artifacts. | Include source-side protocol/smoke where possible; keep CI-only carrier rebuild separate. |
| Should debug-runtime examples be kept public? | They still use local broker for extension smoke. | Keep them as contributor diagnostics and label them as such. |

## Intent

### Surface Intent

Make the `ext-*` examples prove they are adapted to the v0.9 tray/app/session kernel, then provide a runnable `opentray` example matrix command that passes.

### Underlying Drive

The v0.9 kernel reset made the default runtime app-owned and tray-first, while extension examples still exercise a contributor debug runtime. The system needs a clear proof boundary:

```text
default app runtime proof
    -> visible binding smoke

official extension proof
    -> debug runtime smoke
    -> generic extension ABI
    -> no core product branches
```

### Final Visible Effect

An operator can run one package-level command and see each example atom pass or be honestly skipped as unsupported. The matrix output should identify protocol, visible runtime, WebView, badge, placement/media-query, and Lynx coverage without requiring the operator to remember staging details.

## Platform Diagnosis

- Current platform laws: tray/app/session ownership, generic extension ABI, app-owned runtime binding, diagnostic local broker for source-tree extension smokes.
- Does this fit as a regular atom: yes. The matrix is a verification atom over existing laws.
- Does this require law upgrade: no kernel law change is needed.
- Breaking update stance: examples and scripts may be renamed or consolidated if needed; public SDK should not grow compatibility glue.
- User confirmations still required: only if the user wants CI-only Lynx carrier rebuild to become a local required matrix step.

## Reverse-Inferred Design

### Interaction / Visual Story

The developer runs:

```bash
pnpm --filter opentray example:matrix
```

The command builds/stages required source-tree artifacts, runs finite smoke examples, and prints a concise pass/fail table. Extension-specific examples use smoke env vars and short timeouts so they do not hang waiting for manual tray clicks.

### Interface Shape

- `example:matrix`: authoritative runnable matrix for package examples.
- Individual example scripts remain available for manual/human visual inspection.
- Matrix runner owns preflight: build CLI, build/stage runtime binding for default visible runtime, and run extension smoke commands with explicit env.

### Data Shape

- Runtime binding artifact is generated/staged evidence, not source truth. It must not be committed.
- Example smoke env vars are command configuration, not product ontology.
- Extension state remains owned by each extension handle and native crate.

### Architecture Shape

- Keep all extension-specific parsing/runtime behavior in `packages/ext-*` and `crates/opentray-ext-*`.
- Keep `opentray-core` generic.
- Keep local broker usage inside contributor example support where extension ABI loading is still the smoke path.
- Add the matrix as a script/helper, not as public SDK API.

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| Lynx full runtime carrier in local matrix | May require CI/Xcode artifacts beyond ordinary local dev. | Do not block the matrix on CI-only carrier rebuild; include available smoke or mark as skipped with reason. |

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [ ] 2. Write specs from the intent.
- [ ] 3. Write BDD tasks from specs.
- [ ] 4. Implement tasks.
- [ ] 5. Self-review against intent and decide whether to loop.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| Does `example:*` need to be literal shell-compatible or can the stable command be `example:matrix`? | `zsh` rejects unquoted `example:*` before pnpm runs. | Provide `example:matrix` and document quoted pnpm regex separately if useful. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Make extension examples use the default visible binding immediately | The current binding does not yet load native extension artifacts; pretending it does would fake extension support. |
| Add extension-specific branches to `opentray-core` or runtime binding | Violates official extension atom law. |
| Commit staged `.node`/dylib artifacts so examples pass | Violates source-control rule for generated native binaries. |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: 2
- Custom exit condition from intent: improved matrix passes locally, focused ext gates pass, and final report identifies any platform-skipped coverage honestly.
