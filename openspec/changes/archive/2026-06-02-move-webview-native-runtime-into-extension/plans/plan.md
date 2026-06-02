# Intent Document

## Current Round

- Round: 1
- Status: Runtime ownership moved into `opentray-ext-webview`; OpenSpec and docs are being aligned to the new law
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

> apply move-webview-native-runtime-into-extension change：
> 1. opentray 这里只提供底层通用能力，不耦合任何webview相关的技术，也不耦合ext-webview的入口和出口（参数解析）。opentray的对外展示出来的webview相关协议和能力，完全是靠转发给扩展ext-webview来获得。
>
> 2. ext_webview 这里包含完整的出口和入口。可以理解成ext-webview是一个独立的二进制文件。我们在不改变独立性的前提下，将它打包成动态链接库。由opentray作为它的使用入口，opentray会把所有相关的输入转发给它
>
> 用户需要看到最终的二进制文件(opentray 和 libopentray_ext_webview.dylib)的体积符合预期

> 我看了， opentray 二进制 10mb，而ext-webview的二进制500kb。这完全和我们预想中的不一样啊

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | `opentray` must stay generic and must not own WebView technology or `ext-webview` command parsing. | The daemon may know only the generic extension ABI and dispatch law. |
| 1 | User | `ext-webview` must contain the complete entrance and exit and should behave like an independent binary packaged as a dynamic library. | Command parsing, default HTML, native window lifecycle, and runtime linkage belong inside the extension artifact. |
| 1 | User | The final proof surface includes the actual sizes of `opentray` and `libopentray_ext_webview.dylib`. | Completion requires binary evidence, not just source-code shape. |
| 2 | User | The observed `10MB` daemon vs `500KB` extension split is backwards. | The architecture must be verified through linkage ownership and size redistribution. |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `crates/opentray-bin/Cargo.toml` | `opentray-bin` no longer depends on `wry`. | The daemon binary can stop carrying WebView runtime linkage. |
| `crates/opentray-bin/src/main.rs` | macOS broker uses `UnsupportedExtensionHostContext` and no longer parses WebView command payloads. | The daemon now behaves as a generic extension dispatcher. |
| `crates/opentray-ext-webview/src/lib.rs` | The extension parses `show`, `hide`, `navigate`, `evaluate`, and `postMessage` itself. | Entry and exit semantics moved into the extension artifact. |
| `crates/opentray-ext-webview/src/macos.rs` | The extension creates and owns `NSWindow`, `NSView`, and `wry::WebView` internally. | Native runtime ownership now lives inside the dynamic library. |
| `target/release/opentray` and `target/release/libopentray_ext_webview.dylib` | Release size is `1,874,112` bytes for `opentray` and `957,760` bytes for the WebView dylib on local macOS arm64 build. | The runtime weight has moved toward the extension where it belongs. |
| `otool -L target/release/opentray` | `opentray` no longer links `WebKit.framework`. | Confirms daemon/runtime decoupling at the linker boundary. |
| `otool -L target/release/libopentray_ext_webview.dylib` | The dylib links `WebKit.framework`. | Confirms the extension artifact now owns WebView linkage. |
| `openspec/changes/ship-native-binaries-and-webview-platform-packages/plans/plan.md` | The current active release plan still describes a WebView host capability path in the daemon composition layer. | OpenSpec is behind the code and needs a new change to state the new law. |
| `README.md` and `packages/cli/README.md` | User-facing docs still mention daemon-owned WebView UI capability. | Human-visible docs must match the new runtime boundary. |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts | Pending in this working tree; code move was already in progress before this change file was created |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | Pending |
| Self-review updates | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | Pending |
| Normal archive | Commit containing `openspec archive <change>` result | Not started |
| Abnormal handoff | Commit containing `HANDOFF.md` / `vN.HANDOFF.md` evidence before returning to user discussion | Not needed |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
| `openspec/specs/extension-host/spec.md` | Dynamic extension ABI is C-compatible and generic. | Reuse the ABI law; extend it so official WebView runtime no longer depends on daemon-side product behavior. |
| `openspec/specs/webview-extension/spec.md` | WebView is an extension atom outside the kernel. | Reuse the atom law; extend it so the platform dylib owns full protocol parsing and native runtime. |
| `openspec/changes/ship-native-binaries-and-webview-platform-packages` | Platform package split and package-adjacent discovery are already defined, but the plan still assumes daemon-owned WebView host capability. | Keep package topology, break the runtime-ownership assumption. |
| `skills/opentray/references/extension-host.md` | Describes dynamic loading as not yet implemented. | Update; it is now implemented and is part of the repo truth. |
| `skills/opentray/references/ext-webview.md` | Describes WebView as an extension atom, but does not say the dylib now owns the runtime. | Update to preserve future-agent alignment. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| `只提供底层通用能力` | `opentray` should expose only the generic platform law, not product-specific WebView behavior. | The daemon should know only generic extension loading and forwarding. |
| `完整的出口和入口` | `ext-webview` must own both request parsing and response/event shaping. | No daemon shadow parser or shadow event builder is allowed for WebView. |
| `独立的二进制文件` | The extension should behave like a standalone native program even though it is packaged as a dylib. | Runtime state, native dependencies, and default behavior live in the extension binary artifact. |
| `体积符合预期` | The binary split must be physically visible in the produced artifacts. | Linkage and size evidence are acceptance gates. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| none | Existing code and linker evidence are already concrete enough. | No extra spike is needed. |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| Should exact byte thresholds become a long-term contract? | Exact sizes drift with Rust/toolchain/linker changes, but ownership boundaries should stay stable. | Treat linker ownership and the relative size shift as the durable contract; use exact local byte counts as current evidence, not permanent constants. |

## Intent

### Surface Intent

Make `opentray` a pure generic extension dispatcher for WebView traffic, make `opentray-ext-webview` own the complete WebView protocol and native runtime as a platform dylib, and prove the split with the final binary artifacts.

### Underlying Drive

The user is testing whether OpenTray's atom law is real or fake. If the daemon still owns WebView parsing or links WebKit just because `ext-webview` exists, then the split is cosmetic. This change is not about making code pass; it is about making the physical runtime boundary true.

### Final Visible Effect

An operator can inspect the produced artifacts and stop worrying that WebView is secretly still inside `opentray`. `opentray` builds as the smaller generic broker binary, `libopentray_ext_webview.dylib` carries the WebView linkage, and the normal `load-ext webview` / `ext-command` path still works without daemon-side WebView parsing.

## Platform Diagnosis

- Current platform laws: generic extension ABI, package-adjacent discovery, surface/tray/lease dispatch, and platform-native packages already exist.
- Does this fit as a regular atom: No. The earlier daemon-host-capability shortcut made WebView a law-breaking special case.
- Does this require law upgrade: Yes. Official extension runtime ownership must move from daemon composition into the extension artifact.
- Breaking update stance: Accept internal breaking changes before stable release; preserve public `@opentray/ext-webview` facade semantics.
- User confirmations still required: Binary size and linker evidence; human visual smoke only if current automated evidence becomes ambiguous.

## Reverse-Inferred Design

### Interaction / Visual Story

1. A client asks the daemon to `load-ext webview`.
2. The daemon resolves the current platform `@opentray/ext-webview-<os>-<arch>` library and loads it through the generic ABI.
3. The client sends a normal `ext-command` with `ext: "webview"`.
4. The daemon forwards the envelope bytes unchanged to the loaded library.
5. The library parses `show`, `navigate`, `postMessage`, `evaluate`, and `hide`, creates the native WebView window internally, and returns scoped extension events.
6. The operator inspects the release binaries and sees WebKit linked only by the extension dylib.

### Interface Shape

- `opentray` owns: extension discovery, ABI loading, scoped dispatch, lease cleanup forwarding, and generic error reporting.
- `@opentray/ext-webview` owns: public typed TypeScript facade over `ext-command` / `ext-event`.
- `@opentray/ext-webview-<os>-<arch>` owns: native command parser, runtime state, default HTML, native window lifecycle, and returned event payload shape.
- Generic host callbacks may remain in the ABI for future privileged atoms, but WebView normal-path behavior must not depend on a WebView-specific daemon capability.

### Data Shape

- Incoming data: `ExtensionEnvelope` JSON bytes for `webview`.
- Outgoing data: extension-emitted `ExtensionEnvelope` JSON bytes.
- Runtime state: native window and WebView objects live inside the extension dylib, not inside the daemon binary.
- Proof data: `wc -c` output and linker tables such as `otool -L` on macOS.

### Architecture Shape

- `opentray-core` remains free of `wry`, `WebKit`, and WebView-specific parsing.
- `opentray-bin` knows the generic loader and broker runtime only; it does not own official WebView protocol semantics.
- `opentray-ext-webview` is the single owner of WebView protocol entry/exit and native runtime composition.
- No `if ext == "webview"` branch is allowed in `opentray-core`.
- No daemon-side shadow parser for `show`, `hide`, `navigate`, `evaluate`, or `postMessage` is allowed outside the WebView extension artifact.

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| Binary/linkage evidence | The user explicitly asked to see the final artifact split. | Required. Use local release artifacts and staged package artifacts. |
| Human visual smoke | The runtime boundary is correct only if behavior still works end-to-end. | Use targeted automated tests first; ask for another human smoke only if those checks become indirect. |

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [x] 2. Write specs from the intent.
- [x] 3. Write BDD tasks from specs.
- [x] 4. Implement tasks.
- [ ] 5. Self-review against intent and decide whether to loop.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| Should future privileged extension facilities still use the generic `invoke_host` ABI hook? | The generic hook can remain useful even though WebView no longer depends on it. | Keep the generic hook available, but do not treat it as part of the normal WebView runtime path. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Keep `wry` in `opentray-bin` and only wrap it with an extension ABI shim | This preserves the old physical coupling and keeps the binary sizes backwards. |
| Reintroduce daemon-side WebView command parsing while pretending the extension owns the feature | This violates the user's explicit requirement that the extension own full entry and exit. |
| Make exact byte counts the only contract | Toolchain drift would create noisy failures; linker ownership and relative size split are the durable truth. |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: The same runtime-coupling or stale-doc issue recurs twice after correction
- Custom exit condition from intent: `opentray` no longer links WebView runtime on macOS, `opentray-ext-webview` owns WebView parsing/runtime in source, OpenSpec/docs describe the new law, and local release artifacts show the expected split.
