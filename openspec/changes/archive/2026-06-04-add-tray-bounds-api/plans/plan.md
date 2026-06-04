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

> 还有一个点，需要在我们这个分支中补全的：就是获得当前tray的坐标。
> 这个功能很重要，可以用来实现自定义tray面板，配合primay menu。
>
> 我简单查询了一下资料，Windows可以用 Shell_NotifyIconGetRect，macOS可以用NSStatusItem.button.window.frame。
> eletron也有类似的接口:Electron 的 tray.getBounds()
> 至于Linux 的SNI，应该也可以间接做到。
>
>
> 这部分的能力还是内置到 webview 中：入口是`navigator.opentray.*`
>
> 或者用 `navigator.opentrayHost.*`？你觉得呢？ 还是说保持一致性：``navigator.opentraySpace.*``?
>
> 好的，我同意。另外，我要和你确定一下，我们绑定在navigator上的这些能力，不依赖前端，只通过后端，应该也是能享用同等级别的能力吧？我的意思是，你有没有类似的封装：
>
> backend: `webview.window` == frontend: `navigator.opentrayWindow`
> backend: `webview.screen` == frontend: `navigator.opentrayScreen`
> backend: `tray.getBounds` == frontend: `navigator.opentray.tray.getBounds`
>
> 或者说你有什么更好的建议吗？
>
> 另外我还有一个问题要和你讨论一下，你觉得我是否应该把screen的能力，提取到core中？还是继续保持在ext-webview中？
>
> 使用openspec vision进行推进

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | Need a way to obtain the current tray coordinates in this worktree branch. | The change must expose physical tray bounds as a first-class capability, not an app-specific helper. |
| 2 | User | This is important for custom tray panels, especially combined with `primaryEvent`. | The acceptance story is a WebView-owned custom menu/panel anchored to the tray item. |
| 3 | User | Provided likely native sources: Windows `Shell_NotifyIconGetRect`, macOS `NSStatusItem.button.window.frame`, Linux SNI maybe indirect. | Platform implementations may differ, but the public contract should stay one tray-bounds capability family. |
| 4 | User | Wants the capability reachable from WebView page JS under `navigator.opentray.*`. | The WebView extension must project the tray capability into page JS without owning the tray law itself. |
| 5 | User | Asked whether the namespace should be `navigator.opentrayHost.*`, `navigator.opentraySpace.*`, or something else. | Naming must follow the owned atom, not an overly broad host or space bucket. |
| 6 | User | Agreed with `navigator.opentray.tray.getBounds()` and wants backend/frontend capability parity. | We need the same tray-bounds capability available from trusted backend SDK handles and from the page bridge. |
| 7 | User | Asked whether screen capability should move to core or stay in ext-webview. | This change should record the current law boundary: tray bounds is a backend/core-routed capability; screen remains ext-webview-owned for now. |
| 8 | User | Explicitly asked to advance this through OpenSpec vision. | We need a proper research-plan/spec/tasks workflow, not an ad hoc implementation. |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `crates/opentray-core/src/backend.rs` | `SurfaceBackend` currently exposes `rect(surface_id)` and `show_menu(surface_id)` only at surface granularity. | Physical tray location is already recognized as a backend concern, but the current law is too coarse for multi-tray surfaces or tray-owned custom panels. |
| `crates/opentray-backend-tray-icon/src/runtime.rs` | `TrayIconRuntime` already has `rect(&SurfaceId)` returning `tray_icon_rect_unbound` by default. | There is a natural extension point for native tray rect, but it must be refined to tray-level targeting. |
| `crates/opentray-backend-tray-icon/src/projection.rs` | The tray-icon backend already compiles stable native tray icon ids per `(spaceId, trayId)`. | Native tray bounds can be keyed per tray without introducing WebView-specific state into the backend. |
| `crates/opentray-backend-tray-icon/src/native.rs` | Native runtime owns the actual `TrayIcon` handles and primary-route policy. | The physical tray bounds implementation belongs here on macOS/Windows. |
| `crates/opentray-core/src/kernel.rs` | Kernel owns `Space`/`Tray` identity, lease ownership, and backend projection; tray state is keyed by `(spaceId, trayId)`. | Tray-bounds lookup can remain generic if the kernel routes it by tray identity rather than by extension name. |
| `crates/opentray-core/src/broker.rs` | Broker request handling currently has no tray-bounds request path. | Shared broker/client protocol must grow a typed request/response for tray bounds. |
| `packages/cli/src/client.ts` | `TrayHandle` currently exposes only `commandExtension()` and `destroy()`. | Backend/frontend parity requires a typed backend tray capability surface, not just page-only injection. |
| `packages/spec/src/index.ts` | Client/server protocol has no `get-tray-bounds` frame and no tray-bounds response. | Public protocol needs additive request/response types for tray bounds. |
| `crates/opentray-ext-webview/src/macos/bootstrap.rs` | Current injected page bridge defines `navigator.window`, `navigator.opentrayWindow`, `navigator.screen`, and `navigator.opentrayScreen`. | `navigator.opentray.tray.getBounds()` should join this family as a page projection of a backend tray capability. |
| `crates/opentray-ext-webview/src/macos/bridge.rs` | The private navigator bridge already dispatches `opentray.window` and `opentray.screen` namespaces. | A new `opentray.tray` namespace fits the existing extension-owned navigator bridge law. |
| `openspec/specs/backend-adapters/spec.md` | Shared backend law already says physical rect retrieval belongs to `SurfaceBackend` and capability absence must be honest. | The new change should refine this existing law from surface-level rect to tray-level bounds instead of inventing a parallel host-only API. |
| `openspec/specs/webview-extension/spec.md` | WebView positioning already depends on backend rect capability and uses documented fallback when rect is unavailable. | Tray bounds improves a real existing product story: accurate tray-anchored panel placement without fake rects. |
| `openspec/changes/add-tray-primary-event/plans/plan.md` | Single-primary macOS behavior exists specifically so developers can build WebView-owned tray menus and panels. | Tray bounds is a direct follow-on capability that makes that custom-panel story viable. |
| `packages/cli/src/smoke/daemon-tray.ts` | The smoke path already opens a WebView surface through tray interaction. | The demo/smoke can become the acceptance surface for tray-anchored custom panels. |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts | Pending |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | Pending |
| Self-review updates | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | Pending |
| Normal archive | Commit containing `openspec archive <change>` result | Pending |
| Abnormal handoff | Commit containing `HANDOFF.md` / `vN.HANDOFF.md` evidence before returning to user discussion | Not needed yet |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
| `openspec/specs/backend-adapters/spec.md` | Physical rect retrieval is a backend capability with honest absence. | Extend. Change the granularity from surface rect toward tray bounds. |
| `openspec/specs/client-sdk/spec.md` | Public SDK exposes typed `SpaceHandle` / `TrayHandle` over broker-backed requests. | Extend. Add a tray-bounds request/response and `TrayHandle.getBounds()`. |
| `openspec/specs/webview-extension/spec.md` | WebView page bridge is extension-owned and already mirrors backend capability families into navigator objects. | Extend. Add `navigator.opentray.tray.getBounds()` as a page projection, not a new backend law. |
| `openspec/changes/enrich-webview-window-macos-capabilities/*` | Screen remains ext-webview-owned and page bridge names use `navigator.opentrayWindow` and `navigator.opentrayScreen`. | Reuse. This change should complement those window/screen capabilities without forcing screen into core now. |
| `openspec/changes/add-tray-primary-event/*` | Primary tray activation stays `menuClick`; native tray policy belongs in backend/runtime. | Reuse directly. Tray bounds is the geometric counterpart that enables WebView-owned custom menu surfaces. |
| `openspec/specs/kernel-runtime/spec.md` | Kernel stays backend-neutral and extension-neutral. | Reuse directly. No `webview` branch or platform-specific tray math belongs in core. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| “获得当前tray的坐标” | Need the physical desktop bounds of the current tray/status item. | Get the native tray icon rect. |
| “可以用来实现自定义tray面板” | The tray icon should anchor a custom WebView-owned panel or menu. | Build a custom tray popup instead of relying only on native menus. |
| “配合primary menu” | This is the follow-on capability that makes single-primary tray launchers practical. | Use the tray click to open a panel positioned from tray bounds. |
| “入口是 `navigator.opentray.*`” | Wants a namespaced page API under the OpenTray-owned navigator root. | Expose a prefixed page bridge, not a random global. |
| “`navigator.opentrayHost.*` / `navigator.opentraySpace.*`?” | Unsure whether the namespace should be grouped by provider or by ownership boundary. | We need to name the API after the actual atom being measured. |
| “backend/frontend 同等级别能力” | Wants page JS and trusted SDK callers to share one capability family with different projections. | Backend is the authority surface; navigator is the page projection. |
| “screen 提取到 core 吗” | Asks whether screen should become a broker-level capability. | Decide whether screen is now generic enough to leave ext-webview. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| `packages/cli/src/smoke/daemon-tray.ts` | Can the single-primary tray flow open a custom WebView panel anchored to tray bounds? | Keep and extend as the human-visible acceptance surface. |
| `packages/cli/examples/webview-control.ts` | Can the WebView page bridge surface native capability families ergonomically? | Keep and extend if we need an in-page tray-bounds control. |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| Should tray bounds be named under `navigator.opentray.tray` rather than `opentrayHost` or `opentraySpace`? | This decides whether the API reflects the acted-on atom or a broad container namespace. | Use `navigator.opentray.tray.getBounds()` because the measured object is the current tray, not the host or the space. |
| Should backend parity exist as `TrayHandle.getBounds()` rather than `webview.tray.getBounds()`? | This decides whether the trusted API is tray-owned or WebView-owned. | Put backend authority on `TrayHandle.getBounds()` and let ext-webview mirror it into navigator. |
| Should screen move to core now? | This is the boundary question behind the current API family design. | No. Tray bounds enters the shared backend/core-routed path; screen stays ext-webview-owned until a second non-WebView consumer proves the shared law. |

## Intent

### Surface Intent

补上“当前 tray 的坐标”这条能力，让开发者可以基于 OpenTray 自己的 tray icon/status item 做自定义 WebView 面板，并且这条能力既能从 backend SDK 用，也能从页面里的 `navigator.opentray.*` 用。

### Underlying Drive

用户正在把 OpenTray 从“能显示 tray 菜单”推进到“能承载 tray-first 应用入口”。`primaryEvent` 解决了“怎么点击”，tray bounds 解决了“点完之后面板锚定到哪里”。如果没有 tray bounds，自定义 tray panel 只能靠猜位置、cursor fallback、或者 fake rect，平台 law 就不完整。

### Final Visible Effect

开发者能运行一个人眼可验收的 tray/WebView demo，点击 tray icon 后看到一个 WebView-owned panel 准确贴着当前 tray/status item 出现，而不是飘在猜测位置。backend 代码可以直接调用 `tray.getBounds()` 做 trusted placement，页面代码可以通过 `navigator.opentray.tray.getBounds()` 读到同一组 tray bounds 并参与布局。平台不支持时，系统明确返回 `null` 或 typed unsupported，不再伪造 tray 坐标。

## Platform Diagnosis

- Current platform laws: `Space` 是聚合边界，`Tray` 是可见入口原子，backend 负责物理 tray surface，WebView extension 负责把部分能力镜像进页面 bridge。
- Does this fit as a regular atom: Yes. This is a regular tray capability upgrade plus a WebView page projection, not a law-breaking special case.
- Does this require law upgrade: Yes, but narrow. Shared backend/core-routed tray geometry law must move from surface-level `rect` to tray-level `bounds`.
- Breaking update stance: Prefer additive public API. Existing surface rect capability can be renamed or refined internally, but public SDK/protocol additions should be backward-compatible where feasible.
- User confirmations still required: none before spec writing; namespace and capability parity direction are already agreed in discussion.

## Reverse-Inferred Design

### Interaction / Visual Story

一个开发者创建 tray，并把一个 item 标记为 `primaryEvent: true`。用户点击 tray icon，WebView panel 被快速打开。WebView panel 不再凭空出现，而是根据“当前 tray 的 bounds”贴在正确的 tray/status item 附近。这个定位既可以在 trusted backend 代码里完成，也可以在页面中读取当前 tray bounds 做自适应布局。

### Interface Shape

Product-first shape:

- Trusted backend SDK:
  - `tray.getBounds(): Promise<Rect | null>`
- WebView page projection:
  - `navigator.opentray.tray.getBounds(): Promise<Rect | null>`

Naming law:

- Do not use `navigator.opentrayHost.*`: too broad and likely to become a junk drawer.
- Do not use `navigator.opentraySpace.*`: `space` is ownership/aggregation, not the visible anchor being measured.
- Use `navigator.opentray.tray.*`: it names the actual atom whose physical bounds are being queried.

Backend/frontend parity law:

- Backend authority is tray-owned.
- Frontend navigator is a page projection of the same tray-owned capability.
- `webview.window` and `webview.screen` can stay as ext-webview-owned facades; tray bounds should not be modeled as a WebView-only ability.

### Data Shape

- `Rect` remains the durable public bounds shape.
- Tray bounds are keyed by `(spaceId, trayId)`, not by surface alone.
- The native backend may store a tray-icon-id to bounds association internally, but the durable shared identifier is still `(spaceId, trayId)`.
- Absence states must stay explicit:
  - capability unavailable
  - tray exists but bounds currently unavailable
  - platform unsupported

### Architecture Shape

- `@opentray/spec`
  - owns additive protocol request/response for tray bounds
- `packages/cli`
  - owns `TrayHandle.getBounds()`
- `opentray-core`
  - owns generic routing from `(spaceId, trayId)` to backend tray-bounds lookup
  - must not learn WebView-specific behavior
- `opentray-backend-tray-icon`
  - owns macOS/Windows native tray-bounds implementation
  - may keep Linux as explicit `None` / unsupported until there is real backend evidence
- `ext-webview`
  - owns `navigator.opentray.tray.getBounds()` injection and private bridge namespace
  - does not own the underlying tray-bounds source of truth

Forbidden couplings:

- no `if ext == "webview"` or `if page wants tray bounds` in core/backend law
- no host-level junk namespace for tray geometry
- no fake tray rect synthesized from cursor or window placement when the native backend has no evidence
- no forced extraction of `screen` into core in this change

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| Linux tray-bounds support semantics | Linux SNI/desktop stacks may not offer one truthful implementation today. | Return explicit absence on unsupported Linux paths rather than inventing a fake rect. |
| Page-bridge gating for tray bounds | Page JS is a security boundary, so tray capability should follow the same declarative native API policy thinking. | Add a `tray` capability family to the existing page-bridge policy model. |

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [ ] 2. Write specs from the intent.
- [ ] 3. Write BDD tasks from specs.
- [ ] 4. Implement tasks.
- [ ] 5. Self-review against intent and decide whether to loop.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| Should the shared backend contract keep `rect(surfaceId)` as a compatibility shim or be cleanly upgraded to tray-level bounds? | This affects protocol and trait churn. | Prefer a clean additive tray-level API now; keep internal shims only if needed to avoid unnecessary breakage during implementation. |
| Should `navigator.opentray.tray.getBounds()` be enabled only when a new `nativeTrayApi` policy family is granted? | This decides whether tray bounds follows the same source-scoped law as window/screen page APIs. | Yes. Treat tray as its own policy family rather than piggybacking on `nativeWindowApi`. |
| Should `TrayHandle.getBounds()` return `null` or throw on unsupported platforms? | This affects backend ergonomics and parity with page APIs. | Return `null` when the tray exists but no truthful bounds are available; reserve typed unsupported for capability families that are not bound at all. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Put tray bounds under `navigator.opentrayHost.*` | `host` names the provider, not the tray atom being measured, and it invites future namespace sprawl. |
| Put tray bounds under `navigator.opentraySpace.*` | A space can own multiple trays; bounds need the current tray, not the aggregation boundary. |
| Model tray bounds as `webview.tray.getBounds()` | That would incorrectly make tray geometry look like a WebView-owned capability rather than a tray-owned capability mirrored into WebView. |
| Move `screen` into core as part of this change | Screen still has one primary consumer and unresolved cross-platform event modeling; this change is about tray geometry, not a general desktop-geometry law split. |
| Synthesize fake tray bounds from cursor or platform defaults | The point of this change is honest tray anchoring, not another fallback disguised as geometry truth. |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: 3
- Custom exit condition from intent: backend SDK can query tray bounds by tray identity, WebView pages can call `navigator.opentray.tray.getBounds()`, macOS/Windows tray backends return truthful bounds when available, unsupported paths stay explicit, and a human-visible tray/WebView demo can anchor a custom panel to the tray item without fake positioning.
