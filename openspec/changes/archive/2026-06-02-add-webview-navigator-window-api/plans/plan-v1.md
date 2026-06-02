# Intent Document

## Current Round

- Round: 1
- Status: Research-plan written from user-confirmed navigator API law; specs and tasks pending
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

> 我没意见，你在ext-webview这个包的README.md中补充一些TODO，主要是关于frameless相关的功能：
> 1. 实现无边框窗口，那么就需要向JS提供原本边框的一些能力，close这个不用说，比如resize、move
> 2. 无边框追求的是样式上的极致体现，所以比如背景透明的一些支持（这方面只能说尽力，windows  10/11/7 支持起来还都不一样），更复杂的是背景高斯模糊的支持（这也只能尽力，强行支持结果只会很卡）
>
> 接下来，你就持续推进任务，把第二阶段的工作全部完成。中间如果有遇到什么问题（特别是我没和你讨论过的架构问题与设计问题），及时停下来和我讨论。不要自作主张

> 只认 postMessage 协议，但前提是你把接口挂在在哪里，而且不能和window.postMessage互相污染，得隔离。
> 按照web 的标准，外部能力应该聚合在 navigator 对象上，比如我们可以做一个 `navigator.wryWindow`(或者可以有更好的名字)做控制。底层是 `navigator.wryWindow.#channel.postMessage` 在做通讯。然后封装成`navigator.wryWindow.close/move/resize/getStyle/setStyle/addEventListener('...')` 等易用的异步接口。其中有一些接口还可以绑定到全局的Web标准接口上，比如 window.resizeTo/window.close 等

> 1. 用navigator.opentrayWindow+navigator.window。把opentray作为类似webkit的前缀，对外宣发就用 navigator.window，未来遇到和标准冲突可以用 navigator.opentrayWindow
> 2. 同意，就用开关来进行全局的override控制

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | Frameless windows need JS access to abilities normally provided by native chrome, including close, resize, and move. | The WebView extension must expose native window controls to page JS. |
| 1 | User | Frameless exists for visual polish, so transparent background and blur should be explored, but Windows differences and performance risk mean support must be best-effort. | Style APIs must be capability-gated and return unsupported instead of forcing slow or unstable effects. |
| 1 | User | The agent must stop for architecture issues not discussed with the user. | Navigator API placement and override policy required explicit confirmation before implementation. |
| 2 | User | The bottom protocol should only recognize postMessage, but it must not pollute or collide with `window.postMessage`. | The public API must use an isolated native channel, not global `message` events. |
| 2 | User | External abilities should aggregate under `navigator`. | The public JS API should be a navigator-owned capability object. |
| 2 | User | Easy async methods should wrap the private channel: close, move, resize, getStyle, setStyle, addEventListener. | The injected object should be ergonomic while preserving a protocol boundary. |
| 2 | User | Some methods may optionally bind to global Web standards such as `window.resizeTo` and `window.close`. | Global overrides are allowed only as an explicit capability mode. |
| 3 | User | Use `navigator.opentrayWindow` and `navigator.window`; promote `navigator.window`, keep `navigator.opentrayWindow` as prefixed fallback if future standards conflict. | The extension must install both navigator properties to the same capability object. |
| 3 | User | Global overrides use a switch. | `window.close` / `window.resizeTo` overrides must be off by default and enabled only by explicit option. |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `packages/ext-webview/src/index.ts` | The facade currently exposes `show`, `hide`, `navigate`, `evaluate`, and `postMessage`; `show` has no injected API or style options. | The facade needs typed options for navigator API injection and global override mode. |
| `crates/opentray-ext-webview/src/lib.rs` | The native extension owns WebView command parsing and runtime dispatch. | The new JS API must be implemented inside the extension artifact, not in `opentray` or `opentray-core`. |
| `crates/opentray-ext-webview/src/macos.rs` | The macOS runtime owns `NSWindow`, `NSView`, and `wry::WebView`, and already supports `show`, `hide`, `navigate`, `evaluate`, and synthetic `postMessage`. | Window controls and style operations can be handled where native window state already lives. |
| Wry 0.55 local source | `WebViewBuilder::with_initialization_script` injects JS before load; `with_ipc_handler` receives JS messages via `window.ipc.postMessage`. | The extension can inject navigator APIs and route a private channel through Wry IPC without using global `window.postMessage`. |
| `.agents/skills/develop-opentray-ext/references/boundaries.md` | Native extension crates own request parsing, returned event shape, native window/runtime lifecycle, and platform dependencies. | Confirms this is an extension atom change, not a core platform change. |
| `.agents/skills/develop-opentray-ext/references/webview-runtime-case-study.md` | WebView runtime moved out of the daemon; file size/linkage evidence is the proof. | The new navigator API must not reverse that split by adding daemon-side WebView behavior. |
| `packages/ext-webview/README.md` | Frameless TODO now documents close/resize/move, transparent background, Windows differences, blur performance risk, and typed unsupported errors. | README captures product direction; specs must harden it into a capability contract. |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts | Pending |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | Pending |
| Self-review updates | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | Pending |
| Normal archive | Commit containing `openspec archive <change>` result | Not started |
| Abnormal handoff | Commit containing `HANDOFF.md` / `vN.HANDOFF.md` evidence before returning to user discussion | Not needed |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
| `openspec/specs/webview-extension/spec.md` | WebView is an extension atom outside kernel/core. | Extend with navigator window-control capability. |
| `openspec/specs/extension-host/spec.md` | Dynamic extension ABI is generic and C-compatible. | Reuse; no new daemon product branch is allowed. |
| `openspec/changes/move-webview-native-runtime-into-extension` | The WebView dylib owns runtime, parser, default HTML, and WebKit/wry linkage. | Reuse as a hard boundary. |
| `openspec/changes/adopt-space-tray-session-and-native-ci-law` | Public vocabulary moved to Space/Tray/Session and release artifacts are CI-owned. | Reuse package/release law; this change should not alter release topology. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| `只认 postMessage 协议` | Native side should receive a message protocol, not arbitrary direct global JS mutation. | The private channel is the only low-level transport. |
| `不能和window.postMessage互相污染，得隔离` | Do not use or listen to global web message traffic. | No `window.postMessage` / `message` event contract. |
| `navigator.window` | Preferred public API surface for web authors. | The promoted object that users call. |
| `navigator.opentrayWindow` | Prefixed fallback namespace if future standards collide with `navigator.window`. | Same object, stable escape hatch. |
| `opentray作为类似webkit的前缀` | OpenTray-specific names should act like vendor-prefixed web platform extensions. | The prefix is a compatibility fallback, not the main marketing surface. |
| `全局的override控制` | `window.close` / `window.resizeTo` can be overridden only behind an explicit switch. | Default off; opt-in per WebView show/options. |
| `尽力` | Platform visual effects are best-effort. | Capability-gated support with typed unsupported errors. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| none yet | The user confirmed the key architecture law before implementation. | Add tests before implementation instead of a throwaway demo. |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| Should `navigator.window` be installed on remote URL pages by default? | Remote pages may be untrusted and should not automatically receive native window authority. | Default injection for extension-owned HTML; require explicit `nativeWindowApi: true` for URL content. |
| Should move/resize names be `move`/`resize` or standard-like `moveTo`/`resizeTo`? | Ergonomics vs Web API consistency. | Provide `move`/`resize` aliases plus `moveTo`/`resizeTo`; docs promote standard-like names. |
| Should transparent/blur be implemented now or only typed as capability placeholders? | Real blur has platform/performance risk. | Implement the style protocol and typed unsupported responses first; add macOS transparent support only if low-risk. |

## Intent

### Surface Intent

Expose frameless WebView window controls to page JavaScript through `navigator.window` and `navigator.opentrayWindow`, backed by an isolated private postMessage-style channel that does not touch `window.postMessage`. Allow optional global `window.close` / `window.resizeTo` overrides only when explicitly enabled.

### Underlying Drive

Frameless UI removes platform chrome, so OpenTray must give HTML chrome a safe way to regain close/move/resize/style control. The user wants this to feel like a web platform capability, not like a random global injected by an app framework. The API must be ergonomic, but the platform law must remain message-based, scoped, capability-gated, and extension-owned.

### Final Visible Effect

A WebView page can call `await navigator.window.close()`, `await navigator.window.resizeTo(480, 320)`, or `await navigator.window.setStyle({ transparent: true })` without knowing about the native ABI. The page does not receive or emit global `message` noise, and `navigator.opentrayWindow` remains available as the prefixed fallback. If a capability is unsupported, the promise rejects with a typed unsupported error instead of silently faking success.

## Platform Diagnosis

- Current platform laws: WebView runtime and parser live inside `opentray-ext-webview`; `opentray` forwards scoped extension traffic generically; platform packages distribute the native dylib.
- Does this fit as a regular atom: Mostly yes, because the capability belongs inside the WebView extension atom.
- Does this require law upgrade: Yes inside the extension atom: page JS now needs a stable injected navigator capability and a private native channel law.
- Breaking update stance: Additive public API; no breaking change to existing `show` / `hide` / `navigate` / `postMessage` facade.
- User confirmations still required: Remote URL injection policy and whether style effects beyond typed placeholders should be implemented in this iteration.

## Reverse-Inferred Design

### Interaction / Visual Story

1. A client shows a WebView with native window API injection enabled.
2. The page sees `navigator.window` and `navigator.opentrayWindow`.
3. Custom HTML chrome calls `navigator.window.resizeTo(...)` or `navigator.window.close()`.
4. The navigator object serializes a request onto a private channel.
5. The native extension validates the request, checks capability support, applies the window operation, and returns an async result.
6. Optional events such as `stylechange`, `moved`, `resized`, or `closed` are emitted from the navigator object, not global `window`.
7. If global override mode is enabled, selected `window.close` / `window.resizeTo` calls delegate to the same navigator object.

### Interface Shape

- Public JS object: `navigator.window`.
- Prefixed fallback object: `navigator.opentrayWindow`.
- Both properties point to the same EventTarget-like object.
- Primary methods: `close`, `move`, `moveTo`, `resize`, `resizeTo`, `getStyle`, `setStyle`, `getCapabilities`, `addEventListener`, `removeEventListener`.
- Global overrides: `window.close`, `window.resizeTo`, and optionally `window.moveTo`, installed only when `bindWindowGlobals` is true.
- TypeScript facade options: `show` should accept native API injection and global binding options.

### Data Shape

- Channel request: `{ id, namespace: "opentray.window", method, params }`.
- Channel response: `{ id, ok: true, value }` or `{ id, ok: false, error: { code, message } }`.
- Style state: frameless, transparent, backgroundEffect, and platform-specific support metadata.
- Capability state: close, move, resize, transparent, background effects, global bindings, and platform.

### Architecture Shape

- JS injection script lives in `crates/opentray-ext-webview`.
- The script uses Wry IPC internally but does not expose `window.ipc` as OpenTray's public API.
- No `window.postMessage` or global `message` listener is part of the OpenTray protocol.
- Native request handling lives next to the WebView runtime state in the extension dylib.
- `opentray-core` and `opentray-bin` remain unaware of `navigator.window`.

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| Remote URL injection policy | Remote pages receiving native window controls can be a security footgun. | Inject only when explicitly enabled by the `show` command; docs warn against enabling it for untrusted URLs. |
| Blur/transparency implementation depth | The user explicitly called out platform variance and performance risk. | Implement typed API and unsupported errors now; avoid forced blur unless platform support is cheap and stable. |

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [ ] 2. Write specs from the intent.
- [ ] 3. Write BDD tasks from specs.
- [ ] 4. Implement navigator API injection, private channel, native command handling, facade types, and docs.
- [ ] 5. Verify with TypeScript tests, Rust tests, macOS smoke, and self-review.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| Remote URL injection default | It determines whether arbitrary web pages can access native window controls. | Off unless `nativeWindowApi: true` is present. |
| Style effect depth | Blur/acrylic/vibrancy can become slow or platform-fragile. | Capability shape first; best-effort implementation only where safe. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Use `window.postMessage` as the transport | It pollutes the global web messaging surface and collides with page code. |
| Expose Wry's `window.ipc.postMessage` as the public API | It leaks the implementation engine and gives users the wrong abstraction. |
| Default-patch `window.close` / `window.resizeTo` | It surprises normal pages and violates the user's explicit override-switch decision. |
| Put navigator API handling in `opentray-bin` | It would reverse the extension runtime split. |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: The same global pollution, core coupling, or unsupported-style fake-success issue recurs twice after correction
- Custom exit condition from intent: WebView pages can use `navigator.window` and `navigator.opentrayWindow` through an isolated channel, global overrides are opt-in, unsupported style/window operations return typed errors, and `opentray-core` / `opentray-bin` remain free of WebView-specific navigator API logic.
