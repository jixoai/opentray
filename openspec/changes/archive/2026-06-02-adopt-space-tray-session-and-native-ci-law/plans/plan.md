# Intent Document

## Current Round

- Round: 1
- Status: Apply verified; public Space/Tray/Session API migration and native CI artifact law are implemented, reviewed, and not yet archived
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

> 1. 建议使用  Space / Tray / Session
> 2. 使用openspec vision 推进这些任务
> 3. 我们得把二进制的编译，全部用github CICD来做。不过得先到github marketplace上找到合适的Actions，免得自己花太多时间去配置。

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | Public naming direction should move to `Space / Tray / Session`. | Treat current `Surface / Tray / Lease` language as alpha law that needs a public API correction. |
| 1 | User | Use OpenSpec vision to advance this work. | Create a formal change before implementation; plan/spec/tasks are the source of truth. |
| 1 | User | Native binary compilation must be done by GitHub CI/CD. | Source releases must not rely on local native builds or checked-in generated binaries. |
| 1 | User | Research GitHub Marketplace Actions before configuring binary CI. | The CI law must be informed by reusable Marketplace Actions rather than handcrafted complexity. |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `packages/spec/src/index.ts` | Public protocol and SDK types still expose `SurfaceId`, `SurfaceOptions`, `SurfaceRef`, and `LeaseId`; `SurfaceOptions` contains `appId`. | Confirms the naming issue is real and not just docs wording. `appId` makes the creation options look like app identity rather than a space identity. |
| `packages/cli/src/client.ts` | Public SDK shape is `createSurface`, `SurfaceHandle`, and `TrayHandle`. | The public user-facing entry point still teaches `Surface`, so the rename must touch SDK API, examples, and docs. |
| `openspec/specs/kernel-runtime/spec.md` | Current kernel law says Rust owns `Surface`, `Tray`, and `Lease`; it defines `Lease` as the client authority. | The rename crosses a platform law, not only a TypeScript facade. |
| `openspec/specs/client-sdk/spec.md` | Current client scenarios refer to broker-created `SurfaceRef` and `createSurface`. | Client SDK specs must be amended if the user-visible API changes. |
| `openspec/specs/release-pipeline/spec.md` | Release law already covers trusted publishing, package bootstrap, and generic extension-platform packages. | Native CI work should extend release law, not invent an unrelated release mechanism. |
| `openspec/changes/ship-native-binaries-and-webview-platform-packages/specs/release-pipeline/spec.md` | Active change already requires CI to stage native artifacts before npm publish and cover six first-stage platform packages. | This change should harden the Action/tooling decision and final workflow law, not duplicate package topology. |
| `.github/workflows/release.yml` | Current workflow has `native-artifacts` matrix on platform runners, uses `dtolnay/rust-toolchain@stable`, builds `opentray-bin` and `opentray-ext-webview`, uploads artifacts, downloads them, and stages them into npm packages. | CI is directionally correct but still hand-written; Marketplace Action selection and cache/dependency law are not recorded. |
| GitHub Marketplace / GitHub repos | `actions-rust-lang/setup-rust-toolchain` combines Rust toolchain setup with optional rust-cache behavior; `Swatinem/rust-cache` is a dedicated Cargo cache action; `dtolnay/rust-toolchain` is minimal and widely used. | Recommended Rust setup should be explicit: use a toolchain action plus cache, or an integrated setup action, not custom shell bootstrapping. |
| GitHub official artifact actions | `actions/upload-artifact` and `actions/download-artifact` are the right artifact transport layer for passing platform binaries into the publish job. | OpenTray publishes npm packages, so artifact transport is a better fit than GitHub Release binary upload actions. |
| GitHub hosted runner docs | GitHub provides hosted runner labels for macOS, Ubuntu, Windows, and architecture variants, but availability/cost can differ by repository plan and runner class. | Native runners are preferable for GUI/WebView dynamic libraries; cross-compilation should not be the default law. |
| `cross` / Rust cross-build Marketplace actions | Cross build actions are useful when no native runner exists, but they introduce Docker/sysroot complexity and do not prove GUI/WebView native runtime dependencies. | Reject as default for first-stage WebView dynamic libraries; keep only as contingency for daemon-only artifacts or future non-GUI atoms. |
| `tauri-apps/tauri-action` | Tauri action is optimized for Tauri app build/release workflows. | It is not the right abstraction for OpenTray's generic daemon plus extension dynamic library artifacts staged into npm packages. |
| `taiki-e/upload-rust-binary-action` | Upload-binary style actions focus on GitHub Release assets for Rust binaries. | OpenTray's release surface is npm package tarballs, so this would be a parallel release mechanism and should be rejected for the mainline. |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts | Pending; this change has only the research-plan so far. |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | Pending. |
| Self-review updates | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | Pending. |
| Normal archive | Commit containing `openspec archive <change>` result | Not started. |
| Abnormal handoff | Commit containing `HANDOFF.md` / `vN.HANDOFF.md` evidence before returning to user discussion | Not needed. |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
| `openspec/specs/kernel-runtime/spec.md` | Kernel owns `Surface / Tray / Lease`; `Lease` is the authority for client-created trays. | Break public vocabulary toward `Space / Tray / Session`; decide whether internal Rust names migrate immediately or expose deprecated aliases first. |
| `openspec/specs/client-sdk/spec.md` | SDK connects to versioned daemon and exposes `createSurface`. | Break public SDK naming to `createSpace` and `SpaceHandle`; keep `Tray` stable. |
| `openspec/specs/broker-daemon/spec.md` | Daemon owns transport sessions and lease cleanup. | Reuse session semantics; rename user-facing health output from lease language to session language where appropriate. |
| `openspec/specs/release-pipeline/spec.md` | Trusted publishing and package bootstrap are already generic and OIDC-based. | Extend with Marketplace Action selection and no-local-binary-build release rule. |
| `openspec/changes/ship-native-binaries-and-webview-platform-packages` | Defines CI native artifacts, platform packages, and npm smoke. | Reuse package topology; this change should harden workflow Action law and future-proof CI setup. |
| `openspec/changes/move-webview-native-runtime-into-extension` | Defines runtime ownership split: main daemon is generic; WebView owns native runtime. | Preserve; native CI must build `opentray-bin` and each native extension atom without coupling them. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| `Space / Tray / Session` | Preferred public ontology: aggregation boundary, status contribution, connection lifecycle. | Rename the concepts users touch; do not keep leaking internal physical terms. |
| `Surface的Options很奇怪` | The current `SurfaceOptions.appId` shape is semantically wrong or under-specified. | Space creation options should have `id` / `spaceId` and only include app identity if it is a separate concept. |
| `使用openspec vision推进` | Do not implement ad hoc. | Create a change, write plan/spec/tasks, validate, then apply. |
| `二进制的编译，全部用github CICD来做` | Published package artifacts must come from CI platform builds. | Local binaries are only smoke inputs, never release inputs. |
| `先到github marketplace上找到合适的Actions` | Avoid bespoke release engineering when maintained Actions solve the setup/caching/artifact path. | Research and select reusable Actions before editing workflow YAML. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| none yet | The current uncertainty is naming law and CI Action selection, not runtime behavior. | No demo needed before specs. |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| Should `Surface` be renamed to `Space` everywhere, including Rust kernel/protocol field names, or only public TypeScript/docs first? | A full rename is cleaner in alpha, but touches many files and active changes. | Prefer full alpha cleanup if we are still pre-stable; keep deprecated aliases only if avoiding churn is more valuable. |
| Should `SpaceOptions` use `id`, `spaceId`, or separate `id` plus `appId`? | The current problem is not just the noun; `appId` confuses identity with grouping. | Use `id?: SpaceId` for the OpenTray grouping key and reserve `appId` only for future platform app identity if proven necessary. |
| Should `Session` replace `Lease` in protocol fields such as `leaseId`, or should `Lease` remain internal authority terminology? | `Session` is friendlier public language, while `Lease` is precise for ownership cleanup. | Public API and health output should use `sessionId`; internal kernel may keep `Lease` until the rename cost is justified. |
| Should CI continue using native hosted runners for every target, even if ARM runner availability changes? | Native WebView dynamic libraries are a poor fit for cross-compilation; runner availability is a release risk. | Prefer native hosted runners; allow `cross` only for daemon-only fallback, not WebView GUI artifacts. |

## Intent

### Surface Intent

Move the public OpenTray model toward `Space / Tray / Session`, and make GitHub CI/CD the only release-grade native binary compiler using researched, maintained GitHub Actions rather than local builds or over-custom workflow glue.

### Underlying Drive

The user is correcting two alpha-stage laws before the API and release pipeline fossilize. `Surface / Lease` were accurate from an internal implementation view, but users reason about spaces they create and sessions they connect. Likewise, native binary release cannot depend on whichever developer machine last built the artifacts; the project needs a reproducible CI artifact law.

### Final Visible Effect

A developer sees `createSpace`, `SpaceHandle`, `Tray`, and `Session` in docs/examples/health instead of the current mixed `SurfaceOptions.appId` language. A maintainer sees GitHub Actions build all native daemon and extension artifacts, move them through official artifact actions, stage them into npm packages, and publish without any checked-in or local-release binaries.

## Platform Diagnosis

- Current platform laws: `Surface` is broker-owned desktop entry; `Tray` is client contribution; `Lease` is connection authority; native artifacts are staged into npm platform atoms.
- Does this fit as a regular atom: No. Naming changes the public ontology, and CI binary compilation changes release law.
- Does this require law upgrade: Yes. Public ontology should become `Space / Tray / Session`, and release-grade native compilation should become CI-owned with explicit Action selection.
- Breaking update stance: Prefer breaking alpha cleanup over alias glue. Add compatibility aliases only when they preserve developer migration without hiding the new law.
- User confirmations resolved by current apply decision: new public API/protocol/docs use `Space`; `SpaceOptions` uses input `id` while refs/events use `spaceId`; deprecated `Surface*` aliases remain as alpha shims; CI defaults to native hosted runners with cross-build only as a documented future fallback.

## Reverse-Inferred Design

### Interaction / Visual Story

1. A developer installs `opentray`.
2. They call `createSpace({ id: "my-tool", title, icon })`.
3. They mount a `Tray` into that space and receive events under their current `Session`.
4. `opentray daemon health` reports the daemon PID, endpoint, package/protocol versions, and active sessions.
5. Release maintainers merge to `main`.
6. GitHub Actions builds native daemon and extension artifacts on platform runners, uploads them as workflow artifacts, downloads them into the publish job, stages them into npm platform packages, validates package tarballs, and publishes through trusted publishing.
7. A fresh npm install proves the published packages resolve CI-built binaries.

### Interface Shape

- Public SDK should expose `createSpace`, `SpaceOptions`, `SpaceRef`, `SpaceHandle`, `TrayHandle`, and session-oriented daemon health.
- `Tray` stays because it maps to the stable system tray vocabulary and the user accepted tray completion as phase 1/2 work.
- `Session` should be the public lifecycle word for a client connection. If `Lease` remains in Rust internals, it must be treated as a kernel authority implementation detail.
- CI should expose a reusable native artifact build contract: setup Rust, cache Cargo, install platform dependencies, build requested crates, upload artifacts, stage artifacts, validate npm tarballs.

### Data Shape

- `SpaceId`: OpenTray grouping identity for a broker-owned desktop aggregation boundary.
- `SessionId`: public connection/lifecycle identity visible in health and events where needed.
- `LeaseId`: optional internal Rust authority id if retained; must not leak into new public TypeScript APIs without deprecation markers.
- Native artifact metadata: target triple-ish package target, daemon artifact name, extension artifact names, package directory, and staging destination.
- CI artifact names: stable `native-<os>-<arch>` names that map one-to-one to platform package atoms.

### Architecture Shape

- Public API law: user-facing packages should teach `Space / Tray / Session`.
- Kernel law: the ownership tuple remains exact even if names change: `(session-or-lease authority, space/surface id, tray id)`.
- Release law: source control contains source and package manifests only; GitHub CI builds native artifacts for release.
- Action law: use maintained Marketplace Actions for toolchain/cache/artifact transport; do not create a private mini build system in shell unless no maintained Action covers the need.
- Extension law: CI builds extension artifacts as independent atoms; it must not reintroduce WebView into the daemon binary.

### Resolved User Confirmation Gates

| Gate | Decision | Implementation status |
| ---- | -------- | --------------------- |
| Public rename scope | New public API/protocol/docs use `Space`; Rust may keep internal `Lease` and backend projection compatibility names only where they remain implementation details. | Implemented with deprecated TypeScript aliases and Rust serde aliases for alpha compatibility. |
| `SpaceOptions` identity field | Use `id?: SpaceId` for creation input and `spaceId` for refs/events. | Implemented in TypeScript and Rust protocol types. |
| CI Action final choice | Use native runner matrix with `dtolnay/rust-toolchain`, `Swatinem/rust-cache`, and official artifact upload/download actions. | Implemented in `.github/workflows/release.yml` and covered by workflow static tests. |

## Intent-Driven Plan

- [x] 1. Research current repo/OpenSpec/API/CI state.
- [x] 2. Research GitHub Marketplace/native build Action options.
- [x] 3. Write specs from the intent.
- [x] 4. Write BDD tasks from specs.
- [x] 5. Implement API naming changes, compatibility/deprecation policy, and docs/examples.
- [x] 6. Harden native CI workflow with selected Actions, platform dependency setup, artifact validation, and no-local-release-binary checks.
- [x] 7. Run focused validation and self-review against intent.

## Resolved Questions

| Question | Decision |
| -------- | -------- |
| Full rename or public-only rename? | Public API/protocol/docs are renamed to `Space / Tray / Session`; internal names remain only where they encode implementation authority or backend compatibility. |
| `id` or `spaceId` in `SpaceOptions`? | Use `id` for user-facing creation input and `spaceId` for broker refs/events. |
| Keep `Lease` internally? | Keep it as an internal authority token during alpha, surfaced only as `internalLeaseId` diagnostic health metadata. |
| Integrated Rust setup action or separate toolchain/cache actions? | Use `dtolnay/rust-toolchain` plus `Swatinem/rust-cache` for explicit, readable workflow behavior. |
| Native runner matrix or `cross`? | Use native hosted runners for release-grade daemon and WebView extension artifacts; reserve `cross` for documented future fallback cases. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Keep `Surface / Lease` publicly and only add docs explaining them | The user already identified the vocabulary problem; explanation does not fix the API law. |
| Rename only symbols but keep `SurfaceOptions.appId` | The confusing options shape is part of the bug. |
| Add `Space` as a second parallel API without deprecating `Surface` | Parallel first-class words create two laws for one concept. |
| Use Tauri Action as the main build abstraction | OpenTray is not publishing Tauri apps; it stages daemon and extension artifacts into npm packages. |
| Use GitHub Release upload actions as the main release path | The release surface is npm package tarballs, not GitHub Release binaries. |
| Use `cross` by default for WebView dynamic libraries | Cross-compiling GUI/WebView native libraries hides the platform dependency problem the CI should expose. |
| Let local release builds populate npm packages | Violates the user's requirement that binary compilation happen in GitHub CI/CD. |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: The same naming ambiguity or CI artifact-source ambiguity recurs twice after correction.
- Custom exit condition from intent: OpenSpec specs/tasks define `Space / Tray / Session` public law and CI-owned native binary law; implementation and docs follow that law; release workflow builds and stages native artifacts from GitHub CI only; no generated native binaries are committed or required from local machines for release.
