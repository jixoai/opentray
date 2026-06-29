# Interview Plan

## Original User Input

> 社区中有提议到，要在 ext-webview 中使用摄像头，但好像完全不支持, 这个是不是应该静默提供授权，毕竟我们这个属于原生应用的级别。
> 你审查一下，除了摄像头，还有什么权限接口可以一起处理提供的
>
> macos是不是涉及到需要构建一个 .app 的bundle? 如果是，那么还需要将 ext-badge 模块重构，我们需要将它的 .app 包的模式拿过来，作为 drawin 内核。原本只是一个cli，现在cli挪到了 .app(带 plist) 里面
>
> 那么也意味着ext-badge的底层会更加干净。
>
> ---
>
> 如果我说的没错，那么你的计划就要同步考虑到ext-badge的重构
>
> Implement the plan.
>
> 紧急前提： /Users/kzf/Dev/GitHub/jixoai-labs/agenter/openspec/schemas/vision2 使用新版的openspec Schema来推进任务
>
> 把这个Schema复制到本项目，重新创建spec change
>
> 做一项更新，开始interview之前，必须和当前采访对象确认一下话题，如果有必要，甚至要确认一下母语。如果确实不是英文母语，那么需要将思维方式（思考使用的语言）切换为目标语言。像我和你对话，涉及到英文 ，这种就有必要确认采访使用的母语。
> 采访母语非常重要，因为母语思考和翻译思考又会很大的不同。
>
> 更新完这个采访前置流程到vision2后，先把代码提交一下。
>
> 然后我们再开始做 interview_plan.md
>
> yes

## Pre-Interview Orientation

Before asking requirement questions, confirm the interview topic and interview mother tongue with the current interviewee. If the confirmed mother tongue is not English, switch the thinking language to that target language instead of translating English reasoning.

| Field | Record |
| ----- | ------ |
| Confirmed topic | Darwin `.app` runtime carrier, `ext-webview` browser permission policy, and `ext-badge` refactor so badge reuses the Darwin carrier instead of owning a private `.app` pattern. |
| Interview mother tongue | Chinese |
| Thinking language for this interview | Chinese |
| Confirmation source | User replied `yes` after the pre-interview topic and Chinese mother-tongue confirmation. |

## Q&A Ledger

Interview one question at a time. Before each question, give your recommended answer with reasoning. If a question can be answered from the codebase or existing OpenSpec changes/specs, explore it yourself instead of asking.

Default law: this repository uses `vision2` for new OpenSpec changes. Do not switch to `vision-driven` unless the user explicitly asks for the legacy workflow or the existing change already declares it.

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | The user asked whether `ext-webview` should silently authorize camera because OpenTray is close to a native app, and asked what other browser permission interfaces should be handled together. | The change must cover browser permission families, but silent privilege is not automatically accepted; authorization must conserve to named app/session/origin/policy sources. |
| 2 | User | The user asked whether macOS needs a `.app` bundle, and if so whether `ext-badge` should be refactored so its `.app` package pattern becomes the Darwin kernel/carrier. | The change must treat `.app + Info.plist` as a shared Darwin runtime carrier law, not a badge-only special implementation. |
| 3 | User | The user required using Agenter's newer `vision2` OpenSpec schema, copying it into this repo, recreating the spec change, and adding a pre-interview topic/mother-tongue/thinking-language confirmation law before committing. | The workflow source is `vision2`; legacy `vision-driven` artifacts such as `plans/plan.md` must not be created for this change. |
| 4 | User | The user confirmed `yes` for the pre-interview topic/mother-tongue confirmation. | The interview proceeds in Chinese, and the interview record can mark Chinese mother tongue and Chinese thinking language as confirmed rather than assumed. |
| 5 | Assistant | Recommended making the Darwin `.app` carrier internal shared infrastructure first, not a public API/package immediately, because the carrier law is real but the external ontology is not yet stable. | The first confirmation gate is narrowed to publication boundary rather than whether carrier refactor exists. |
| 6 | User | The user agreed. | Darwin carrier is confirmed as internal shared infrastructure for this change; specs should avoid freezing a public package/API surface unless implementation proves distribution requires one. |
| 7 | Assistant | Recommended defining a broad typed browser permission family ontology covering camera, microphone, geolocation, notifications, clipboard read, autoplay, local fonts, sensors, MIDI system exclusive, file read/write, multiple downloads, and window management, while implementing platform support honestly. | The next confirmation gate became permission family scope rather than camera-only support. |
| 8 | User | The user agreed and said development cost is similar, so anything feasible should be included. | Specs should define the broad permission family set now; implementation may still report typed unsupported for platform gaps instead of faking support. |
| 9 | Assistant | Recommended a declarative silent-authorization model: local/loopback may silently allow explicitly declared permission families, remote origins require exact origin authorization, and undeclared permissions are not silently granted. | The next confirmation gate became the default authorization model. |
| 10 | User | The user agreed, but refined the model: use native-window authorization dialogs; because there is no authorization-management UI, provide low-level interfaces. For local content, `opentrayPermissions` can manage these interfaces for both web `navigator` and backend SDK flows. Remote-origin JavaScript does not receive `opentrayPermissions` by default and must be explicitly enabled. There are two separate switch sets: a fine-grained permission-management object set, and a separate prompt-confirmation control set. Authorization dialogs usually need allow, deny, and allow-once; allow-once means this session, similar to `sessionStorage`. | Specs must separate permission-state management from prompt-confirmation policy, define `opentrayPermissions` injection as a separate capability, default remote origins to no injected permission manager, and model session-scoped grants. |
| 11 | Assistant | Recommended not adding a default durable permission database. OpenTray should expose low-level permission interfaces and session-scoped memory state; durable allow/deny records require explicit app action through backend SDK, `opentrayPermissions`, or app-owned storage. | The next confirmation gate became durable grant storage. |
| 12 | User | The user first agreed, then clarified that OpenTray needs a default JS database for out-of-the-box use. | The original "no default database" recommendation is superseded: the durable store should exist as a named JS/app-layer default adapter, not as hidden native extension persistence. |
| 13 | Assistant | Recommended using app-scoped file storage for the default JS permission database instead of page-side IndexedDB/localStorage, because permission facts must serve both backend SDK and web `opentrayPermissions`. | The next confirmation gate became the default JS database backend. |
| 14 | User | The user chose app-scoped storage and said it should not pollute the frontend. | Specs should define the default permission database as an app/runtime-scoped JS store; page-side storage must not be the default source of permission truth. |
| 15 | Assistant | Recommended using OpenTray `appId` as the default namespace for the app-scoped JS permission database, with explicit namespace override or custom adapter for advanced apps. | The next confirmation gate became app-scoped permission namespace. |
| 16 | User | The user agreed. | Specs should bind default durable permission storage to `appId`, while allowing explicit namespace override or custom adapter. |
| 17 | Assistant | Recommended binding `allow-once` to the WebView window permission session by default, with any broader app-session scope requiring explicit policy. | The next confirmation gate became `allow-once` runtime scope. |
| 18 | User | The user answered `针对WebView`. | Specs should bind `allow-once` to the WebView window permission session, not the whole app runtime or tray session. |
| 19 | Assistant | Recommended remote-origin permissions use two separate gates: exact origin allowlist for permission decisions, and separate explicit opt-in for `opentrayPermissions` injection. | The next confirmation gate became remote-origin permission and management-object policy. |
| 20 | User | The user agreed. | Specs should require exact remote origin allowlists before remote pages participate in permission decisions, and keep `opentrayPermissions` injection disabled for remote origins unless separately enabled. |
| 21 | Assistant | Recommended that Darwin carrier derive default `Info.plist` privacy usage strings from declared permission policy and allow apps to override the human-facing text. | The next confirmation gate became Darwin privacy usage string ownership. |
| 22 | User | The user agreed. | Specs should make privacy usage string generation/merge a Darwin carrier responsibility, not a per-extension plist trick. |
| 23 | Assistant | Recommended fully migrating `ext-badge` onto the shared internal Darwin carrier, preserving only distribution-facing compatibility shapes where needed. | The final confirmation gate became badge migration mode. |
| 24 | User | The user agreed. | Specs should require badge to consume the shared internal Darwin carrier and stop owning a private `.app` implementation path. |

## Evidence Read

| Source (file / change / spec) | Fact | Why it matters |
| ----------------------------- | ---- | -------------- |
| `openspec/schemas/vision2/schema.yaml:5` | The `interview` artifact generates `interview_plan.md`. | Confirms this file is the first artifact and the intent SSOT for the change. |
| `openspec/schemas/vision2/schema.yaml:19` | The schema requires confirming topic, mother tongue, and thinking language before requirement questions. | The current interview must record language orientation before architectural questions. |
| `packages/ext-badge-darwin-arm64/app/Info.plist:7` | The existing badge helper declares `CFBundleExecutable` as `OpenTrayBadgeHelper`. | Shows badge already carries a macOS `.app` identity. |
| `packages/ext-badge-darwin-arm64/app/Info.plist:11` | The existing badge helper declares `CFBundleIdentifier` as `com.opentray.ext-badge.helper`. | Shows the current bundle identity is badge-specific, not a shared Darwin runtime carrier identity. |
| `packages/ext-badge-darwin-arm64/app/Info.plist:19` | The existing badge helper declares `CFBundlePackageType` as `APPL`. | Confirms the existing shape is an app bundle, not a plain CLI binary. |
| `packages/ext-badge-darwin-arm64/app/main.swift:35` | Badge helper starts `NSApplication` and sets a regular activation policy. | Confirms the badge atom currently owns Darwin app lifecycle details. |
| `scripts/release/build-badge-dock-helper.sh:23` | The release script hard-codes `packages/ext-badge-darwin-arm64/app` as the helper source. | Confirms the carrier build path is badge-specific and should be generalized if it becomes a Darwin law. |
| `packages/ext-webview/src/index.ts:18` | `WebviewNativeApiPolicy` currently gates OpenTray-injected page APIs such as window/screen/tray/sync. | Browser permissions should be a separate policy, not overloaded onto `nativeApiPolicy`. |
| `packages/ext-webview/README.md:226` | Remote URLs do not receive injected native capability unless explicitly allowed by `nativeApiPolicy`. | Existing source policy can be reused conceptually, but it currently governs injected APIs rather than browser/device permissions. |
| `crates/opentray-ext-webview/src/macos/policy.rs:157` | Host HTML, file/data/about, and loopback HTTP(S) are classified as local. | Local source classification can guide default permission policy for host HTML and development loopback. |
| `crates/opentray-ext-webview/src/macos/policy.rs:183` | Source rules support none, any, local, remote, and exact origin matching. | Browser permission policy can follow the same origin vocabulary without coupling to native API injection. |

## User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| 静默提供授权 | Avoid showing browser-level permission prompts for trusted native-app contexts. | Silent allow only if there is a named, bounded policy source. |
| 原生应用的级别 | OpenTray should behave like a real native desktop app where platform privacy systems recognize the app identity. | Native-grade app identity and platform permission integration. |
| `.app` 的 bundle | macOS application bundle with `Info.plist`, executable identity, and privacy usage strings. | The Darwin runtime carrier, not a loose CLI. |
| drawin 内核 | User likely means Darwin kernel/carrier layer for macOS runtime packaging. | Shared Darwin runtime carrier law. |
| ext-badge的底层会更加干净 | Move app-bundle mechanics out of the badge atom so badge owns only badge semantics. | Badge becomes a cleaner capability atom. |
| 采访母语 | The language used for requirement discovery and thinking, not just output translation. | Interview mother tongue. |
| 原生窗口弹出授权对话框 | The permission prompt should be native-window owned rather than an in-page web prompt controlled by page content. | Native prompt projection for a platform permission decision. |
| 两套开关 | Permission management capability and prompt confirmation policy must be independent control families. | Separate state-management API from decision UI policy. |
| 仅本次授权 | Grant is scoped to the current OpenTray session/window permission session, not durable storage. | Session-scoped allow. |
| 默认的数据库(js），开箱即用 | A provided JavaScript-side permission store adapter should work by default without forcing every app to design storage first. | Named default JS permission database, not hidden native persistence. |
| app-scoped，不污染前端 | Durable permission facts belong to the app/runtime JS layer, not WebView page storage. | App-scoped permission source of truth. |

## Intent

### Surface Intent

在 `ext-webview` 中支持摄像头等浏览器权限，并审查还应一起纳入的权限接口；同时判断 macOS 是否必须通过 `.app` bundle 承载原本的 CLI，如果是，就把 `ext-badge` 当前私有的 `.app` 模式抽出来成为 Darwin 运行载体，让 `ext-badge` 底层更干净。

### Underlying Drive

用户真正担心的不是单个摄像头 API，而是 OpenTray 从“CLI 带原生扩展”升级到“有明确平台身份的桌面状态平台”时，权限、本体、运行载体、扩展原子之间的边界是否正确。摄像头/麦克风这类权限不能是无名特权，必须追溯到 app 身份、session、origin、policy；默认 JS 数据库可以提供开箱即用体验，但它必须是命名的 app/SDK 层 adapter；`.app + plist` 也不能继续作为 `ext-badge` 的局部技巧，而应成为可复用的 Darwin 底层法则。

### Final Visible Effect

开发者可以在 WebView 中声明浏览器权限策略，摄像头/麦克风等权限在 macOS 上由带 `Info.plist` 的 `.app` 身份承载，并按本地/远程 origin policy 决定允许、拒绝、仅本次允许或交给原生窗口弹窗确认。`ext-badge` 不再私有维护 `.app` 模式，而是复用 Darwin carrier；badge 只保留 badge/progress/attention 等语义。

### Workflow Fit

This is a new `vision2` change: `openspec/changes/darwin-runtime-carrier-and-webview-permissions/.openspec.yaml` declares the change, and the copied schema defines `interview_plan.md -> specs/**/*.md -> tasks.md -> toc.md` as the artifact chain. Do not create legacy `plans/plan.md`.

## Open Questions

Questions still needing user confirmation. Each carries your current inference before the user answers.

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |

## Decisions

Separate confirmed decisions from open questions. Do not let an inference harden into a fact before the user confirms it.

| Decision | Confirmed by | Reversible? |
| -------- | ------------ | ----------- |
| Use `vision2` for this change and do not create legacy `vision-driven` plan artifacts. | User requirement plus current repo `vision2` schema adoption commit. | No, unless the user explicitly asks to switch workflow. |
| Conduct this interview in Chinese and reason in Chinese for requirement discovery. | User replied `yes` after pre-interview confirmation. | Reversible only if the current interviewee changes language preference. |
| Treat silent privilege as a named policy question, not an automatic grant. | Architecture law plus user framing asks whether it "是不是应该" be silent, not that it must be. | Partly reversible by explicit user/product decision, but must remain named and bounded. |
| Treat macOS `.app` bundle needs as part of the Darwin runtime carrier investigation. | User explicitly linked camera support, `.app` bundle, plist, and ext-badge refactor. | No for investigation; implementation details remain open. |
| Keep the Darwin `.app` carrier as internal shared infrastructure for this change, not an immediate public API/package. | User answered `同意` to the recommendation. | Reversible before implementation hardens distribution, but specs should not expose public carrier API by default. |
| Define the broad browser permission family ontology in this change, not camera/microphone only. | User answered `同意，开发成本差不多，能做就都做了`. | Reversible before specs harden, but implementation must still distinguish real support from typed unsupported. |
| Separate permission management from prompt-confirmation policy. | User explicitly said there are two switch sets, one for `opentrayPermissions` permission management and one for whether to show confirmation dialogs. | No; this is a core security boundary. |
| Do not inject `opentrayPermissions` into remote-origin JavaScript by default. | User explicitly said remote-origin JS does not receive this object by default and must be manually enabled. | Reversible only by explicit opt-in policy per origin/source. |
| Model `allow-once` as session-scoped authorization. | User defined "仅本次" as this session, similar to `sessionStorage`. | No for this semantic; exact session identity still needs spec definition. |
| Provide a default JS permission database for out-of-the-box durable grants. | User clarified `不过我们需要提供一个默认的数据库(js），开箱即用`. | Reversible only by replacing it with another named default adapter; it must not become hidden native persistence. |
| Use app-scoped JS storage as the default permission database and do not use frontend storage as the default permission truth. | User said `app-scoped，不污染前端`. | Reversible only by explicit adapter replacement; the default must remain outside page-local storage. |
| Use OpenTray `appId` as the default namespace for the app-scoped JS permission database. | User answered `同意` to the recommendation. | Reversible by explicit namespace override or custom permission store adapter. |
| Bind `allow-once` to the WebView window permission session by default. | User answered `针对WebView`. | Reversible only by explicit future policy field; the default scope is WebView-local. |
| Remote origins must be exact-origin allowlisted before participating in browser permission decisions. | User answered `同意` to the recommendation. | No for default posture; advanced policy can add exact origins but not implicit remote trust. |
| `opentrayPermissions` injection for remote origins is separately gated and disabled by default. | User answered `同意` to the recommendation, after earlier saying remote JS does not receive the object by default. | Reversible per explicit source/origin policy only. |
| Darwin carrier owns generation/merge of `Info.plist` privacy usage strings from declared permission policy, with app-level text overrides. | User answered `同意` to the recommendation. | No for ownership; exact default strings can evolve. |
| Fully migrate `ext-badge` onto the shared internal Darwin carrier, preserving only distribution-facing compatibility shapes when needed. | User answered `同意` to the recommendation. | No for bottom-layer ownership; artifact names can remain as projection/distribution compatibility. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Silently allow all WebView permissions because OpenTray is native-like. | This creates unnamed privilege with no source-of-action conservation and would allow remote content to inherit native trust. |
| Reuse `nativeApiPolicy` as the browser permission policy. | `nativeApiPolicy` governs OpenTray-injected APIs; browser/device permissions are a different capability family and need separate ontology. |
| Keep `.app` bundle mechanics private to `ext-badge` while adding another `.app` path for `ext-webview`. | This duplicates Darwin app identity law across sibling atoms and makes future capabilities grow through glue paths. |

## User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
