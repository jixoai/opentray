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

> 讨论一下，我们是否有必要引入 tauri-apps/Tao 来为我们的 ext-webview 和 ext-lynx 作为窗口基础能力
>
> 你的意思是， lynx 自己有 runtime 去管理窗口是吧？也就是说我想实现透明窗口，透明背景，磨砂背景，都很麻烦？
> 那如果要 webview 的窗口实现无边框，透明背景，磨砂背景呢？tao 有帮助吗？还是你建议直接在 wry 基础上直接做？
>
> 直接实现完成 window/macOS 的支持（应该直接基于 window-vibrancy 来实现就行吧？如果不是你得打断我）。你直接到 .worktree/$SPEC_CHANGE_ID  目录下撰写change。
> 这个change本质本质是为了丰富 ext-webview的 window的能力。
>
> 除了我上面说的这些窗口的修饰（无边框、背景与材质）。
>
> 还有包括 title、icon 等能力。以及扩展Options，实现document.title 与window.title 的双向同步、favicon与window.icon的双向同步。
>
> 还有一个非常重要的能力： navigator.opentrayScreen/navigator.screen , 接口上参考 window.getScreenDetails() 这个标准。和 navigator.window.close -> window.close 的同步绑定一样，可以通过Options来实现声明式配置。

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | 先讨论是否要引入 `tauri-apps/Tao` 作为 `ext-webview` / `ext-lynx` 的窗口基础能力。 | 这次 change 需要先回答“法则是否要升级到 Tao”而不是直接写胶水。 |
| 2 | User | 用户把能力拆成无边框、透明窗口、透明背景、磨砂背景，并追问 WebView 场景下 Tao 是否有帮助。 | 必须区分“窗口 runtime ownership”和“具体视觉能力实现路径”。 |
| 3 | User | 要直接完成 macOS window 支持，并要求如果 `window-vibrancy` 不适合就必须打断。 | 需要先验证 `window-vibrancy` 是否真能挂到现有 AppKit/Wry runtime。 |
| 4 | User | 这个 change 的本质是丰富 `ext-webview` 的 window 能力，而不是给 core 加 special case。 | 所有实现都必须留在 `@opentray/ext-webview` facade 与 native dylib 边界内。 |
| 5 | User | 除窗口修饰外，还要补 `title`、`icon`、Options 级别的 `document.title`/`window.title` 双向同步，以及 favicon/window icon 双向同步。 | 需要把 native window 元数据与 page 元数据建模成显式同步 contract，而不是临时脚本。 |
| 6 | User | 需要 `navigator.opentrayScreen` / `navigator.screen`，接口参考 `window.getScreenDetails()`，并且像 `window.close` 一样能通过 Options 做声明式绑定。 | `navigator.window` 之外还要新增 screen atom，并支持 opt-in global binding。 |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `crates/opentray-ext-webview/src/macos.rs` | 当前 macOS runtime 直接拥有 `NSWindow`、`NSView`、`wry::WebView`，并已注入 `navigator.window` / `navigator.opentrayWindow`。 | `ext-webview` 已经拥有自己的宿主窗口 runtime，不需要再引入 Tao 才能拿到窗口控制权。 |
| `crates/opentray-ext-webview/src/macos.rs` | 当前支持的 window command 是 `close`、`moveTo`、`resizeTo`、`getCapabilities`、`getStyle`、`setStyle({ frameless })`；`transparent` 与 `backgroundEffect` 目前显式返回 unsupported。 | 这是一个“能力扩展” change，不是从零造 window controller。 |
| `crates/opentray-ext-webview/src/lib.rs` | `show` 只支持 `nativeWindowApi` 与 `bindWindowGlobals` 两个注入开关，没有 title/icon/screen/sync 的 declarative contract。 | TypeScript facade 与 native parser 都需要扩协议。 |
| `packages/ext-webview/README.md` | README 已经把 frameless、transparent、blur/vibrancy 描述成 extension-owned capability，而不是 daemon 能力。 | 文档法则已经偏向本次需求，spec 需要把它硬化。 |
| `openspec/specs/webview-extension/spec.md` | 现有 spec 已规定 `navigator.window` 是 extension-owned public surface，global override opt-in，unsupported style 必须显式失败。 | 本 change 应当在现有 law 上扩 title/icon/screen，而不是另开一套平行 contract。 |
| `openspec/changes/archive/2026-06-02-add-webview-navigator-window-api/*` | 归档 change 已定义 `navigator.window` 的注入、私有 channel、callback-id 与 global override 边界。 | 本 change 需要复用这条 law，避免 screen/title/icon 再开第二协议。 |
| `~/.cargo/registry/.../wry-0.55.1/src/lib.rs` | `wry` 提供 `with_transparent(true)`、`with_background_color(...)`、`with_document_title_changed_handler(...)`。 | 透明背景与 `document.title -> native title` 的基础能力已经存在于现有 WebView 引擎层。 |
| `~/.cargo/registry/.../wry-0.55.1/src/wkwebview/mod.rs` | macOS 透明/background color 依赖 `transparent` feature，并通过 `drawsBackground` KVC 关闭默认白底。 | 透明不是 `window-vibrancy` 一把梭；需要 ext-webview 自己启用并管理 Wry/NSWindow 配置。 |
| `~/.cargo/registry/.../window-vibrancy-0.7.1/src/lib.rs` | `apply_vibrancy` / `clear_vibrancy` 接受任何 `HasWindowHandle`，在 macOS 上只要求 `RawWindowHandle::AppKit`。 | `window-vibrancy` 能直接挂在 ext-webview 现有 `AppKitViewHandle` 上，不需要 Tao/winit wrapper。 |
| `~/.cargo/registry/.../window-vibrancy-0.7.1/src/macos/vibrancy.rs` | vibrancy 实际上是在现有 `NSView` 下方插入 `NSVisualEffectView`。 | “材质”是内容视图层能力，适合留在 ext-webview 自己的 NSWindow/NSView runtime。 |
| `packages/spec/src/index.ts` / `crates/opentray-spec/src/model.rs` | OpenTray 已有 `Icon` 类型，支持 `rgba`、`encoded`、`file` 三种来源。 | native-provided window icon 不需要另造新 icon schema。 |
| `objc2-app-kit` generated bindings | `NSWindow` 已提供 `setMiniwindowImage`、`setOpaque`、`setBackgroundColor`、`setTitlebarAppearsTransparent`、`setMovableByWindowBackground`、`screen()`；`NSScreen` 提供 `screens()`、`mainScreen()`、`frame()`、`visibleFrame()`、`localizedName()`、`backingScaleFactor()`。 | macOS title/icon/screen/transparent/chrome projection 都能在现有 native atom 内直接实现。 |

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
| `openspec/specs/webview-extension/spec.md` | WebView 是 extension atom；`navigator.window`、private channel、capability-gated style、opt-in global override 已存在。 | Extend. 在这条 law 上增加 macOS window metadata/material/screen 能力。 |
| `openspec/changes/archive/2026-06-02-add-webview-navigator-window-api/specs/webview-extension/spec.md` | `navigator.window` 的 Tauri-like facade 与 callback-id 协议已经是既定 public contract。 | Reuse. 新能力必须复用同一个 private bridge family。 |
| `openspec/specs/extension-host/spec.md` | daemon 只做 generic extension forwarding，不拥有 ext-specific runtime/parser。 | Reuse directly. 不允许把 title/icon/screen 再塞回 daemon。 |
| `openspec/changes/move-webview-native-runtime-into-extension` | WebView runtime、parser、default HTML、WebKit linkage 已物理下沉到 dylib。 | Reuse directly. 本 change 不能倒退成“extension facade + daemon runtime”。 |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| “作为窗口基础能力” | 想确定窗口 law 是不是要靠 Tao 统一托管。 | Should OpenTray change its window runtime foundation? |
| “无边框、透明背景、磨砂背景” | 指原生窗口 chrome、合成背景、材质层三个不同层面的能力。 | Frameless chrome, transparent compositing, and frosted material are related but different capabilities. |
| “应该直接基于 window-vibrancy 来实现” | 用户接受用现成原子做 macOS 材质层，但要求先判断边界是否正确。 | Use a focused native helper if it fits the current law. |
| “丰富 ext-webview 的 window 的能力” | 范围是 ext-webview atom，而不是 core、broker、daemon 的重构。 | The change belongs to the extension-owned capability surface. |
| “document.title 与 window.title 的双向同步” | page metadata 与 native metadata 都可以作为 source of truth，但同步方向要可声明。 | Title sync must be configurable, not magical. |
| “favicon 与 window.icon 的双向同步” | page favicon 与 native icon 需要互通，但 native projection可能只能 best-effort。 | Icon sync needs an explicit contract and projection law. |
| “参考 `window.getScreenDetails()` 这个标准” | screen capability 应该尽量贴近 Web 标准心智，而不是暴露原生 monitor 细节。 | The API should feel like the web platform, even though it is extension-owned. |
| “通过 Options 来实现声明式配置” | 不是让页面手写桥接脚本，而是让 `show(...)` 在创建时声明能力与同步策略。 | The command contract should own bootstrap and sync policy. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| none yet | 当前需求已经足够具体，不需要先做 throwaway demo 才能锁意图。 | 直接进入 spec + implementation。 |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| none before implementation start | 用户已经把范围、目标能力与“如果不适合就打断”的决策权表达清楚了。 | 直接实施，但最终要把 `window-vibrancy` 的适用边界写清楚。 |

## Intent

### Surface Intent

把 `ext-webview` 做成一个在 macOS 上更完整的 window atom：继续保留现有 `navigator.window` law，但补齐无边框、透明背景、材质层、title、icon、screen 等能力，并通过 `show(...)` 的 declarative options 控制 page/native 双向同步与 global binding。

### Underlying Drive

用户真正要验证的不是“能不能开一个 WebView 窗口”，而是 OpenTray 的 extension law 是否足够强，能在不引入 Tao、也不回退到 daemon special case 的前提下，让一个 extension 自己拥有完整的 window capability surface。只要这次还需要 core 特判、或者为了材质层重造 runtime foundation，这条 law 就没有站稳。

### Final Visible Effect

操作者最终会看到：

- `ext-webview` 的 macOS 窗口可以稳定切换 frameless、transparent 与 material/background effect。
- 页面可以通过 `navigator.window` 控 title/icon/style，也可以在创建时声明 `document.title` <-> native title、favicon <-> native icon 的同步策略。
- 页面可以通过 `navigator.screen` / `navigator.opentrayScreen` 获取标准心智下的 screen details，并可选把 `window.getScreenDetails()` 绑定到同一条能力路径。
- native capability 全部留在 ext-webview dylib，`opentray-core` / daemon 不会长出 `webview window` 特判。
- 对 macOS 无法可靠等价的能力，例如 favicon 到原生 icon 的投影，系统会明确表现为 best-effort，而不是伪装成总能成功。

## Platform Diagnosis

- Current platform laws: WebView native runtime、parser、navigator injection 与 native state 都归 `crates/opentray-ext-webview` 所有；`opentray` 只做 generic forwarding。
- Does this fit as a regular atom: Yes. 这是 ext-webview 自己的第二层 window capability 扩展，不是 core law 崩塌。
- Does this require law upgrade: Yes, but only inside the WebView extension atom. 现有 `navigator.window` law 需要扩成 window metadata + screen capability + sync policy family。
- Breaking update stance: Prefer additive public API. 保留 `nativeWindowApi` / `bindWindowGlobals` 现有语义，在此基础上新增 title/icon/style/screen/sync options。
- User confirmations still required: none before implementation; final visual acceptance should确认透明/材质/title/icon/screen 的真实体验是否满足用户心智。

## Reverse-Inferred Design

### Interaction / Visual Story

开发者调用 `webview.show(...)` 时，不只是声明 HTML/URL 和尺寸，还能声明这个窗口的外观、元数据以及 page/native 的同步策略。窗口显示后：

1. macOS window 在创建时就带着初始 title、icon、style 与 screen/window injection policy。
2. 页面可通过 `navigator.window` 查询能力、设置 title/icon/style，或监听 title/style 等变化。
3. 页面可通过 `navigator.screen.getScreenDetails()` 读取当前屏幕与多屏信息。
4. 如果 Options 开启了 binding，`window.close()` / `window.resizeTo()` / `window.getScreenDetails()` 会委托到相同的 extension-owned capability object。
5. 如果开启了 title/icon sync，page metadata 与 native metadata 会按声明的方向同步，而不会靠隐式 DOM 魔法。

### Interface Shape

- `show(...)` 保持现有基础字段，并以 additive 方式扩展：
  - `nativeWindowApi?: boolean`
  - `bindWindowGlobals?: boolean`
  - `nativeScreenApi?: boolean`
  - `bindScreenGlobals?: boolean`
  - `title?: string`
  - `icon?: Icon`
  - `style?: { frameless?: boolean; transparent?: boolean; backgroundEffect?: string | null }`
  - `titleSync?: boolean | { documentToWindow?: boolean; windowToDocument?: boolean }`
  - `iconSync?: boolean | { faviconToWindow?: boolean; windowToFavicon?: boolean }`
- `navigator.window` / `navigator.opentrayWindow` 继续作为 promoted + prefixed pair。
- `navigator.window` 在现有 `invoke` / `listen` / `once` 之上扩展：
  - `getTitle()`
  - `setTitle(title)`
  - `getIcon()`
  - `setIcon(icon)`
  - 保留 `getStyle()` / `setStyle()` / `getCapabilities()`
- `navigator.screen` / `navigator.opentrayScreen` 是独立 capability object：
  - `getScreenDetails()`
  - 如有需要，内部仍走同类 private invoke contract，但 public API 不变成“原生 monitor RPC 面板”。
- opt-in global bindings:
  - `window.close`
  - `window.moveTo`
  - `window.resizeTo`
  - `window.getScreenDetails`

### Data Shape

- Native window state:
  - current title
  - current icon
  - current style
  - current screen snapshot
- Page metadata state:
  - current `document.title`
  - current active favicon href/data
- Declarative sync state:
  - title sync directions
  - icon sync directions
  - window global binding flag
  - screen global binding flag
- Important separation law:
  - native `Icon` is structured OpenTray data
  - page favicon is a DOM-derived URL/data reference
  - native icon projection is allowed to be best-effort when the page source cannot be losslessly materialized as an `NSImage`

### Architecture Shape

- `packages/ext-webview`
  - owns typed command contract and README contract
- `crates/opentray-ext-webview`
  - owns parser changes, bootstrap script changes, title/icon/screen/state sync law, and macOS native projection
- `window-vibrancy`
  - is a helper atom only for macOS material/vibrancy projection on the existing AppKit view
- `wry`
  - remains the WebView engine and page bootstrap transport
- `opentray-core` / daemon
  - remain generic and unaware of WebView window metadata/screen contracts

Forbidden couplings:

- no Tao refactor for this capability stage
- no `if ext == "webview"` branches in core/daemon
- no second page/native protocol outside the existing extension-owned private bridge family
- no pretending favicon/native icon are always perfectly equivalent on macOS

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| Final visual feel of transparent/material/icon projection | 这些能力既有 contract 面，也有肉眼体验面。 | 先按 macOS best-effort 正确实现，再通过 smoke/肉眼验收确认体验。 |

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [ ] 2. Write specs from the intent.
- [ ] 3. Write BDD tasks from specs.
- [ ] 4. Implement tasks.
- [ ] 5. Self-review against intent and decide whether to loop.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| 当页面存在多个 `<link rel="icon">` 时，native 同步以哪个为准？ | 影响 favicon observer 的 deterministic law。 | 默认取当前最后一个匹配的 active favicon link。 |
| native `setIcon(...)` 回写 page favicon 时，是否始终覆盖原页面 favicon？ | 影响远程 URL 页面上“用户页面资产”与“宿主窗口状态”的边界。 | 仅在 `windowToFavicon` 显式开启时覆盖。 |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| 为了 window 能力把 ext-webview 重构到 Tao | 现有 ext-webview 已经拥有 `NSWindow + wry` runtime，Tao 只会增加一层 runtime 复杂度，不能直接解决 title/icon/screen/sync contract。 |
| 只用 `window-vibrancy` 覆盖透明、材质、title/icon/screen 全部需求 | `window-vibrancy` 只负责 macOS 材质层；透明、title/icon/screen 同步仍然是 ext-webview runtime 的职责。 |
| 把 title/icon/screen 注入逻辑塞回 daemon 或 core | 这会直接破坏 extension atom law。 |
| 把 favicon/native icon 伪装成强一致 | macOS 原生 icon projection 对远程 URL/favicon 只能 best-effort，硬承诺只会制造假成功。 |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: 2
- Custom exit condition from intent: `ext-webview` 在 macOS 上拥有完整且 extension-owned 的 window metadata/material/screen capability surface；`show(...)` 能声明 sync/binding policy；`navigator.window` 与 `navigator.screen` 同时可用；实现、测试、README 与 OpenSpec 一致；不存在 Tao 依赖倒灌或 daemon special case。
