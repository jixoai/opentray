# Intent Document

## Current Round

- Round: 1
- Status: Registry package publish and first-stage real-environment smoke passed; final OpenSpec closure checks in progress
- Previous plan backup: `plans/plan-v2.md`

## Current Implementation Finding

The dynamic extension ABI now includes a per-command host capability context. `opentray-core` passes only the generic `ExtensionHostContext` law, while `opentray-bin` implements the daemon-owned WebView UI capability in the macOS composition layer. The WebView dynamic library is required for registration, invokes the `webview` host capability through C-compatible callbacks and JSON bytes, and returns scoped extension events for `show`, `postMessage`, `evaluate`, `navigate`, and `hide`.

The dynamic extension discovery law now searches both daemon-adjacent platform packages and the requested npm facade package's dependency roots. This matters for real registry installs because package managers such as pnpm may place `@opentray/ext-webview-<os>-<arch>` beside `@opentray/ext-webview`, not beside `@opentray/<os>-<arch>`.

This resolves the prior architecture blocker without passing Rust `ActiveEventLoop`, `Window`, `WebView`, backend, or kernel registry types across the ABI. CI cross-platform artifacts have run, npm package publish has been recovered, trusted publishing is configured for the WebView platform packages, and `opentray@0.2.4` now points at refreshed daemon platform packages (`@opentray/<platform>@0.1.1`). Fresh npm-registry install smoke passed for daemon health/start/stop, WebView show/postMessage/evaluate/navigate/hide, idle release, and human visual confirmation from installed packages.

The release closure exposed one durable law update: daemon platform packages must be versioned with `opentray`, and WebView platform packages must be versioned with `@opentray/ext-webview`. `.changeset/config.json` now uses fixed groups for those package atoms so future releases do not leave published facades pointing at stale native artifacts.

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

> 但在拆包前必须先定义 extension host law：是 sidecar process、动态库 ABI，还是 daemon 内建
>     capability provider。
>
>
> 这个我们之前已经讨论过，已经在相关的specs中有明确的技术方案，我要求和第一阶段一起做，一步到位。
>
> 我们的目标就是验证一个架构的合理性，所以不要偷懒，全面暴露问题

> 完成第一阶段，并成功发布npm包，最终使用npm包通过正式真实环境的测试

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | Extension host law is already decided in specs; do not treat sidecar/dynamic/internal provider as an unresolved future choice. | Use existing dynamic C-compatible ABI specs as the target law. |
| 1 | User | `@opentray/ext-webview-*` platform split must be done in the first stage, not deferred. | WebView platform native packaging is a release blocker. |
| 1 | User | The first-stage goal is to validate architecture, so the implementation must expose hard problems rather than hide them behind an internal shortcut. | Replace daemon built-in WebView special casing with a real host boundary. |
| 2 | System goal | Finish first stage, publish npm packages, and validate from real npm packages in a formal environment. | Final completion requires registry publish and post-publish install smoke, not just local workspace tests. |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `openspec/specs/extension-host/spec.md` | Dynamic extension ABI must use `extern "C"` functions and C-compatible structures; Rust types must not cross the boundary; JSON payloads may cross ABI. | This settles the extension host target law for first-stage implementation. |
| `openspec/specs/extension-host/spec.md` | Internal adapter may bootstrap P0 only if it exercises the same host contract as dynamic libraries. | Current daemon WebView adapter is acceptable only as transitional evidence, not final first-stage release state. |
| `openspec/specs/extension-host/spec.md` | Extension discovery must use package-adjacent artifacts, user config directories, and `OPENTRAY_EXT_PATH` with deterministic auditing. | Native WebView packages need explicit path resolution and error reporting. |
| `openspec/specs/webview-extension/spec.md` | WebView is an extension atom outside the kernel and must route through extension host commands/events. | WebView provider registration belongs in extension platform atoms; daemon-owned UI authority must be exposed only as host capability. |
| `openspec/specs/webview-extension/spec.md` | The TypeScript facade must stay platform-neutral and must not import platform binary packages. | `@opentray/ext-webview` must depend on public contracts; platform packages are optional native artifacts. |
| `packages/cli/src/daemon/broker-command.ts` | Dev resolver builds `opentray-bin` from workspace and has no installed platform package lookup. | Real npm install cannot start daemon without a platform package resolver. |
| `packages/cli/package.json` | `opentray` already declares six daemon platform packages as optional dependencies. | Package topology is ready, but binary staging and resolver behavior are missing. |
| `.github/workflows/release.yml` | Release runs on a single Ubuntu job and publishes after JS build. | It cannot build macOS/Windows/Linux native artifacts before publishing. |
| `packages/ext-webview/package.json` | Facade publishes `dist` and `platforms`, but no extension platform optional packages exist. | Need new `@opentray/ext-webview-<os>-<arch>` atoms. |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts | Pending. |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | Pending. |
| Self-review updates | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | Pending. |
| Normal archive | Commit containing `openspec archive <change>` result | Not started. |
| Abnormal handoff | Commit containing `HANDOFF.md` / `vN.HANDOFF.md` evidence before returning to user discussion | Not needed. |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
| `openspec/specs/extension-host/spec.md` | Dynamic C-compatible extension ABI and deterministic discovery are required. | Reuse as the target law; implement missing host boundary. |
| `openspec/specs/webview-extension/spec.md` | WebView facade is platform-neutral and native implementation is an extension atom. | Extend with platform package distribution and dynamic library discovery. |
| `openspec/specs/monorepo-workspace/spec.md` | Platform package atoms are first-class workspace packages. | Extend the package set with ext-webview platform atoms. |
| `openspec/specs/release-pipeline/spec.md` | CI publishes via trusted publishing and can bootstrap new package atoms. | Extend release workflow to include matrix native artifacts before publish. |
| `openspec/changes/fix-daemon-idle-and-menu-quit` | Current change proves daemon health and macOS WebView visual path through an internal adapter. | Keep as evidence; final release architecture replaces the internal adapter with dynamic library registration plus host capability. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| `一步到位` | First-stage release must include real architecture boundaries, not a staged shortcut. | No deferring ext-webview platform packages to a later milestone. |
| `验证一个架构的合理性` | The goal is architectural falsification as much as feature delivery. | Build the hard packaging/ABI path now so flaws appear before release. |
| `不要偷懒` | Do not pick the smaller internal-provider path because it is easier to pass tests. | Remove WebView special casing and expose host/discovery/publish complexity. |
| `全面暴露问题` | Prefer early failure surfaces over hidden compatibility debt. | CI, npm package shape, dynamic loading, and registry smoke all become acceptance gates. |
| `代码发布的时候是不会带有二进制文件` | Git source must not commit generated native artifacts. | CI or local staging scripts populate `bin/` / `lib/` only for package tests and npm publish. |
| `真实的npm上的包测试` | Workspace tests are insufficient. | Install from npm registry in a fresh project and run daemon/WebView smoke. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| none yet | Need scripts/tests that simulate artifact staging without committing binaries. | Add under `scripts/` and test. |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| Should first-stage dynamic WebView support every platform equally, or may unsupported native runtime return typed capability absence? | Linux WebView dependencies and Windows/macOS event-loop ownership may diverge. | Publish all platform packages, but allow per-platform runtime to fail with structured unsupported/capability errors if the OS backend cannot visually show yet. |
| Should platform packages publish first real version only, or prepublish `0.0.0` ext-webview placeholders for trust setup? | npm versions are immutable; placeholders create public surface. | Use first real version if trust is already manually configured; use bootstrap script only for packages missing on npm. |

## Intent

### Surface Intent

Finish first stage in the real shape: source code remains binary-free, CI builds native artifacts, npm publishes platform-specific daemon and WebView extension packages, and a clean project installed from npm can start daemon, load WebView through the extension host, and pass visual/health smoke.

### Underlying Drive

The user is not asking for the easiest demo. The product pressure is to prove whether OpenTray's atom law works when confronted with real native packaging, dynamic ABI, CI artifacts, npm trusted publishing, and post-publish installation. If the architecture cannot survive this path, first stage is not complete.

### Final Visible Effect

An operator can install `opentray` and `@opentray/ext-webview` from npm in a fresh directory. The installed package resolves the current platform daemon binary from `@opentray/<platform>`, starts a version/protocol-scoped daemon, resolves `webview` to the current platform `@opentray/ext-webview-<os>-<arch>` dynamic library, opens a native WebView window, mutates it with `postMessage` and `Evaluate JS`, reports `daemon health`, exits, and releases idle daemon state.

## Platform Diagnosis

- Current platform laws: `Surface`, `Tray`, `Lease`, protocol frames, extension registry, and platform package atoms already exist.
- Does this fit as a regular atom: Partly. Package atoms fit the current law, but dynamic library loading needs the missing extension-host runtime law implemented.
- Does this require law upgrade: Yes. The daemon must gain a generic dynamic extension loader/discovery boundary; the current WebView-specific loader is insufficient.
- Breaking update stance: Accept breaking internal changes before first-stage release; preserve public TS facade where possible.
- User confirmations still required: Human visual confirmation from npm-installed packages after CI publish.

## Reverse-Inferred Design

### Interaction / Visual Story

1. CI builds native daemon and WebView extension artifacts on each supported platform.
2. CI downloads artifacts into package-local `bin/` and `lib/` directories before publish.
3. npm publishes JS packages, daemon platform packages, and WebView platform packages via trusted publishing.
4. A clean local project installs from npm.
5. `opentray daemon health` reports absent without starting.
6. A demo command starts daemon automatically.
7. Daemon resolves and loads the WebView dynamic library through extension host discovery.
8. WebView commands produce visible window changes.
9. The daemon exits after idle and the next run starts the same-version daemon again.

### Interface Shape

- `opentray` CLI resolves daemon binary by platform optional package.
- `@opentray/ext-webview` remains a typed facade over `TrayHandle.commandExtension`.
- `@opentray/ext-webview-<os>-<arch>` packages expose package-adjacent dynamic libraries.
- Daemon extension loader accepts package name/path, resolves candidates, validates ABI symbols, and returns structured load errors.
- CI staging scripts copy native artifacts into package directories without committing them.

### Data Shape

- daemon artifact: `packages/<platform>/bin/opentray[.exe]`.
- WebView artifact: platform-specific dynamic library under `packages/ext-webview-<os>-<arch>/lib` or `bin`.
- ABI metadata: ABI version, extension name, command JSON bytes, event JSON bytes, structured status code.
- package version group: `opentray` with daemon platform packages; `@opentray/ext-webview` with ext-webview platform packages.
- npm smoke evidence: installed package version, resolved daemon binary path, resolved WebView library path, health output, visible demo output.

### Architecture Shape

Platform law updates:

- Dynamic extension loading is daemon composition law, not `opentray-core` native dependency law.
- WebView is a native extension atom; no `ext == "webview"` branch in core.
- Package resolver is generic over platform artifacts.
- Release workflow is artifact-staging law; source tree remains binary-free.

Forbidden couplings:

- `@opentray/ext-webview` facade must not import platform packages.
- `opentray-core` must not import `wry`, `libloading`, platform npm packages, or WebView-specific runtime.
- Release workflow must not publish fake binaries.
- npm post-publish smoke must not use workspace links.

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| Fresh npm install visual test | Only a real registry install proves optional package and dynamic library shape. | Treat as required before marking first stage complete. |
| Platform support truth | CI can build artifacts, but each OS may expose native WebView limitations. | Publish structured unsupported errors rather than fake success. |

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [x] 2. Write specs from the intent.
- [x] 3. Write BDD tasks from specs.
- [x] 4. Implement package atoms and artifact staging.
- [x] 5. Implement daemon binary resolver and tests.
- [x] 6. Implement generic dynamic extension host ABI boundary.
- [x] 7. Move WebView registration behind platform dynamic libraries and expose daemon UI authority through host capability.
- [x] 8. Implement CI matrix artifact build and publish staging.
- [x] 9. Add changesets and package version grouping.
- [x] 10. Publish through npm trusted publishing.
- [ ] 11. Run fresh npm registry install smoke and human visual verification.
- [x] 12. Self-review against intent and decide whether to loop.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| Should Windows ARM64 be required for visual WebView smoke in first release? | Runner/build support and native WebView2 availability may differ. | Build and publish package; allow typed unsupported smoke if visual runtime is not yet testable. |
| Should Linux WebView package require system WebKit dependencies or bundle strategy? | npm package cannot always supply system GUI libraries. | Do not bundle system packages; document capability/error and CI build dependencies. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Register a daemon-internal WebView provider when the dynamic library is missing | It hides the extension host problem the first stage is meant to validate. |
| Put all WebView native artifacts into `@opentray/ext-webview` | Bloats installs and violates platform atom isolation. |
| Commit generated binaries to git | User explicitly requires source release without checked-in binaries. |
| Use workspace smoke as final proof | User requires formal real npm environment testing. |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: Same package resolver, dynamic loading, or npm smoke issue recurs twice after a fix.
- Custom exit condition from intent: npm packages publish successfully; a fresh npm install resolves daemon and WebView platform artifacts; daemon health and visual WebView smoke pass from installed packages; no generated binaries are committed to source.
