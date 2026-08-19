# Intent Document

## Current Round

- Round: 8
- Status: Darwin App bundles now use a stable npm-package-derived path. Runtime-managed bundles are reinitialized in place for every new broker process, while explicitly prebuilt bundles are validated and launched without mutation. All `@opentray/*-plugin` adapters share one packaging implementation for prebuilding the same contract.
- Previous plan backup: `plans/plan-v7.md`

## Workflow Command Surface

- Create change: `bun run openspec:vision -- new <change>`
- Check status: `bun run openspec:vision -- status <change>`
- Get artifact instructions: `bun run openspec:vision -- instructions <artifact> <change>`
- Strictly validate change files: `bun run openspec:vision -- validate <change>`
- Check commit evidence: `bun run openspec:vision -- commit-check <change> --phase <phase>`
- Rename after intent realignment: `bun run openspec:vision -- rename <old-change> <new-change>`
- Write abnormal handoff: `bun run openspec:vision -- handoff <change>`
- Final workflow proof gate: `bun run openspec:vision -- check <change>`

## Original User Input

> 我希望skill-creator-v2这个项目的窗口管理改一个方案，就是和普通的应用程序一样，启用 showInSwitchers ，点击托盘会打开应用程序，同时系统任务栏会出现窗口图标，然后关闭窗口，这个图标也会被关闭。但是可以点击托盘再次打开这个窗口。
>
> 这个能做到吗？以目前的能力。还是说要加新功能？
>
> 如果有 showInSwitchers 的能力，就不用keepOnTop 了。这也是为什么我希望skill-creator-v2能进行改变窗口管理的原因。
> keepOnTop的核心原因是因为没有开启showInSwitchers的能力，所以必须通过keepOnTop来确保窗口始终在可交互的区域。
>
> 所以我们需要让macOS也支持showInSwitchers。之前做ext-badge的时候已经，我已经确定这个效果是可行的。
>
> 但是我们还需要优化一下这里的标准。比如他的命名应该叫什么？ showInSwitchers 这种命名是行为命名，我觉得应该专门为它定一个名字。
>
> 建议用 style.appMode:bool ，然后顶层加一个 appIcon 字段，默认继承 icon。你看这个设计行不行，怎么改进
>
> 开始使用 openspe 进行推进
>
> 我现在 pnpm dev 启动后，dock确实出现了一个图标。但是这个新图标有问题，title是opentray，然后图标是一个 exec图标
>
> 因为要快速迭代，skill-creator-v2建议先直接link本地的 opentray。你只需要确保每次我做 pnpm dev 之前的所有准备工作就行
>
> 我觉得我们的appIcon这个参数应该严格一点，虽然也是数组，但是是面向特定平台的数组，和trayIcon不一样。appIcon必须跟随操作系统平台的标准来。然后我们才能基于此标准去做辅助工具链。同时这样的好处是，别人可以不使用我们给的工具，开发者可以自己使用工具来做好标准平台图标的生成，然后直接使用就行了。
>
> 我已经为 skill-creator-v2 生成了原生了 /Users/kzf/Dev/GitHub/jixoai-labs/skill-creator-v2/resources/app-icon 。不过暗色模式的支持可能得另外写代码：我们可以在appIcon里面提供一个主题变体字段。通过设置变体来切换图标`setAppIcon('dark')`
>
> 当然也可以不使用变体，直接手动注入图标也是可以。但是声明式变体的好处，是能规范化管理
>
> 这方面ext-weview不用适配，如果有需要开发者完全可以基于ipc自己实现一个基于变体名词安全切换图标的功能
>
> 默认的变体名是，`"default"`，不填写就是默认default名字。可以考虑支持数组：`['default','light']`。
>
> 变体的作用，还可以用在比如一个垃圾篓应用，存在 `empty` 和 `files` 两种变体。
>
> 目录必须稳定；默认基于 npm 包名，例如 `~/.opentray/apps/@jixoai+skill-creator/Skill Creator.app`，同时允许 `createTray` 显式指定 `appBundle` 路径。
>
> 每次重新生成应该有开关。运行时可以重新初始化稳定 bundle，也可以直接使用由 `@opentray/*-plugin` 预构建的 bundle。

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | `skill-creator-v2` should behave like a normal application: tray primary action reveals the window, the window appears in the system taskbar/switcher, closing it removes the taskbar icon, and the tray can reveal it again. | The target is a retained window session with normal Shell membership, not a recreated window per click. |
| 2 | User | `keepOnTop` is only a workaround for the absence of switcher membership and should no longer be needed for the application-mode consumer. | `keepOnTop` remains an independent z-order capability; app mode must not imply it. |
| 3 | User | macOS must support the same app-mode effect; the existing `ext-badge` `.app` carrier proves the effect is feasible. | Darwin runtime activation policy and app identity become part of the same cross-platform contract. |
| 4 | User | `showInSwitchers` is behavior-shaped naming and should be replaced by a dedicated standard name. | Public API uses `style.appMode`; the old public Windows field is removed rather than aliased. |
| 5 | User | Proposed `style.appMode: bool` plus a top-level `appIcon` that defaults to `icon`, with a request for design improvement. | App identity is configured at the App-facing runtime seam; the initial inheritance proposal is superseded by turn 14's strict platform asset boundary. |
| 6 | User | The work must now proceed through OpenSpec. | This change must complete the vision-driven artifact chain before product-code implementation. |
| 7 | User | Confirmed removal of public `showInSwitchers`, App runtime placement of `appIcon`, and Darwin Regular/Accessory aggregation. | These are approved breaking/platform decisions; implementation may proceed after the artifact update. |
| 8 | User | Requested that `appIcon` inheritance follow Windows system icon matching rules. | The resolver must separate AppUserModelID/group identity from icon artwork; turn 14 later removes tray inheritance entirely. |
| 9 | User | Asked for interfaces to change App icon and title, and whether they belong in `ext-badge` or Core. | App identity mutation is a Core/runtime contract; ext-badge remains status overlay capability; window title/icon remain ext-webview metadata. |
| 10 | User | Clarified that although the platform-neutral Core must not package `.app`, the OpenTray core runtime distribution should contain the App bundle. | Separate kernel source ownership from Darwin runtime distribution: the shared carrier ships with `@opentray/darwin-*`, while `ext-badge` no longer owns a private carrier. |
| 11 | User | macOS visual acceptance found a Dock item titled `opentray` with the generic `exec` icon. | A carrier artifact that is merely staged but never launches the broker is not a carrier implementation. The broker must run from a caller-specific materialized bundle and App artwork must reach `NSApplication`. |
| 12 | User | During rapid iteration, `skill-creator-v2` should directly link the local OpenTray checkout; every `pnpm dev` must prepare all required local artifacts first. | Add a reproducible linked-consumer preparation command and wire it into `skill-creator-v2` `predev`; do not require a publish cycle for native acceptance. |
| 13 | User | The icon generator itself must participate in cache identity; changing `color-symbol` to `flat-symbol` must update the tray/app assets, and the whole chain must move into the linked `@opentray/vite-plugin`. | Move normalization and ICNS generation into the plugin, hash its built implementation plus source/recipe/encoder identity, rebuild it from `skill-creator-v2` `predev`, and resolve source-dev icons from `webui/static` so stale `webui/build` output cannot win. |
| 14 | User | `appIcon` must be a strict platform-oriented array distinct from `trayIcon`; developers may provide standards-compliant assets without OpenTray's generator. | Replace generic `Icon` with a discriminated `AppIconAsset[]`: Darwin `.icns`, Windows `.ico`, and Linux freedesktop PNG/SVG entries. Select the current OS strictly and remove tray icon inheritance. |
| 15 | User | App identity assets may declare variants and `setAppIcon("dark")` selects one; callers may still inject an AppIcon directly. WebView needs no adaptation, and application IPC may own typed variant commands. | Variants are Core App identity state, orthogonal to WebView and optional to consumers. Named selection never replaces the declared catalog. |
| 16 | User | The default name is `default`; omission means `default`; one asset may declare aliases such as `["default", "light"]`; variants also model semantic states such as trash `empty/files`. | `variant` is a semantic state key, not a theme enum. Normalize one or many names, validate uniqueness per variant, and expose a type-level name extractor. |
| 17 | User | A runtime App bundle must live at a stable path derived from the caller npm package name, with an explicit custom path for applications that need stronger control. | Separate npm package identity from caller labels. The default Darwin path is `~/.opentray/apps/<encoded-package-name>/<sanitized-app-name>.app`; an explicit `appBundle.path` wins. |
| 18 | User | Reinitialization should overwrite the stable bundle rather than replace it through a temporary directory, and must be configurable so a prebuilt bundle can be used directly. | Managed mode rewrites only OpenTray-owned files through sibling-file atomic replacement inside the stable bundle and commits its manifest last. Prebuilt mode is read-only and rejects missing or incompatible bundles. |
| 19 | User | Build-system packages can provide plugins that generate the prebuilt bundle. | `@opentray/packaging` owns one generator/manifest contract; Vite, esbuild, webpack, and tsdown packages expose lifecycle adapters over it. |
| 20 | User | Approved the stable path, managed/prebuilt ownership, package resolution, and plugin adapter design. | The implementation may proceed without another product decision. |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `packages/ext-webview/src/index.ts:161-183` | WebView style currently has common `frameless`, `resizable`, `keepOnTop`, `autoHide`, opacity, background, plus platform-specific style. | `appMode` belongs beside common shell intent; it must not be hidden under a Windows-only namespace. |
| `packages/ext-webview/src/index.ts:161-165,208-214` | `showInSwitchers` exists only in Windows style and Windows capabilities. | The current contract is platform-shaped and cannot express the requested macOS behavior. |
| `crates/opentray-ext-webview/src/windows/mod.rs:3509-3534` | Windows maps `show_in_switchers` to `WS_EX_APPWINDOW` versus `WS_EX_TOOLWINDOW`. | Existing native behavior is reusable as an adapter projection for `appMode`. |
| `crates/opentray-ext-webview/src/windows/mod.rs:5767-5771` | Native `WM_CLOSE` hides the HWND without showing a public lifecycle projection in this branch. | Close/reveal acceptance needs an explicit operational visibility contract. |
| `crates/opentray-bin/src/main.rs:370-382` | The executable broker forces macOS `ActivationPolicy::Accessory` and explicitly avoids promoting a WebView to a Dock app. | macOS app mode requires a deliberate activation-policy aggregation rule, not a window-local hack. |
| `crates/opentray-runtime-node/src/visible.rs:165-175` | The Node runtime host also forces macOS `ActivationPolicy::Accessory`. | Both runtime paths must obey one Darwin app-mode law. |
| `crates/opentray-ext-webview/src/macos/mod.rs:842-851` | macOS shows windows through `makeKeyAndOrderFront` and `orderFrontRegardless` while remaining accessory. | The current visibility path works for tray tools but does not establish normal application identity. |
| `crates/opentray-spec/src/model.rs:9-35` | App options and identity currently reuse generic `Icon` for application artwork. | The wire contract must carry a separate `AppIcon` array; tray `Icon` remains a status-surface projection. |
| `packages/cli/src/sdk.ts:20-67` | The facade currently accepts generic `Icon` for `appIcon` and validates it by candidate preference. | Replace candidate preference with strict platform/format validation before connecting to the broker. |
| `packages/ext-badge-darwin-arm64/app/main.swift:35-42,187-190` | The badge carrier sets `NSApplication` activation policy to `.regular` and handles Dock reopen. | A shared Darwin carrier can implement app-mode identity without making badge semantics own the carrier. |
| `scripts/release/build-badge-dock-helper.sh:22-29` | Badge release currently hard-codes its private `.app` source directory. | Carrier extraction is a packaging concern, but this change should define the reusable boundary and migration target. |
| `packages/darwin-arm64/package.json`, `packages/darwin-x64/package.json` | Darwin runtime packages currently publish only `bin/opentray`. | The core Darwin distribution must publish the broker executable and the shared App carrier as one runtime artifact set. |
| `scripts/release/build-darwin-app-carrier.sh` | A generic AppKit carrier builder already exists independently of badge semantics. | Reuse this builder for the Darwin runtime carrier; do not import AppKit or bundle layout into `opentray-core`. |
| `packages/cli/examples/EXAMPLE.md:40` | Existing examples retain one WebView session and use `primaryEvent`, `show`, `toVisible`, `close`, and `visibleChange`. | `skill-creator-v2` must follow the established session-authoritative pattern rather than a local boolean. |
| `packages/ext-webview/README.md:304-315` | `hide` retains a session, `toVisible` restores it, and `destroy` is explicit teardown. | App-mode Shell membership must not alter retained-session semantics. |
| `openspec/changes/darwin-runtime-carrier-and-webview-permissions/.openspec.yaml` | An existing, independent Darwin carrier change declares `vision2`. | This change must not silently modify that incomplete change; it owns only app-mode/app-icon contracts and references carrier work as a dependency boundary. |
| `openspec/specs/webview-extension/spec.md` | WebView window operations are extension-owned and capability-gated; unsupported native behavior must be explicit. | `appMode` must be represented in ext-webview capability/state contracts and never faked on unsupported platforms. |
| `crates/opentray-core/src/backend.rs:27-47` | `AppProjection` already carries app-level `title` and `icon`, and `AppBackend::sync_app` is the generic projection boundary. | App identity updates fit Core without importing native GUI or badge dependencies. |
| `crates/opentray-core/src/kernel.rs:94-106,267-288` | Core stores `AppOptions` and reprojects app title/icon together with trays. | Add app-level mutation methods and protocol frames rather than routing identity through an extension. |
| `packages/ext-badge/src/shared.ts` | Badge owns badge text/count, progress, overlay icon, and attention. | Base app title/icon are orthogonal to badge status and must not be added to the badge extension. |
| `crates/opentray-ext-webview/src/macos/metadata.rs:54-125` | WebView `setTitle` and `setIcon` intentionally mutate only `NSWindow` metadata. | Window metadata APIs must remain separate from App identity APIs. |
| `packages/darwin-app-carrier/main.swift` and `packages/cli/src/daemon/broker-command.ts` | The staged carrier is a separate idle Swift application, while the SDK still launches the raw `bin/opentray` executable. | This directly explains the accepted Dock defect: AppKit sees the raw executable, so bundle display name and icon never become broker identity. |
| macOS acceptance, 2026-07-19 | App mode produced a Dock item, but its title was `opentray` and its artwork was the generic executable icon. | Activation policy works, but carrier launch identity and App icon projection are incomplete. |
| Microsoft Learn `shell/appids` | Windows taskbar associates processes/windows with explicit AppUserModelID; shortcut/relaunch metadata supplies application identity, and window-level identity can override process identity. | `appId` controls Shell grouping; `appIcon` is the artwork source. Do not treat tray icon selection as the Windows identity mechanism. |
| Microsoft Learn `shell/taskbar-extensions` | Taskbar overlays are status notifications on an existing application button, not the base application icon. | Confirms ext-badge belongs to overlay/status effects, not base App icon/title. |
| `skill-creator-v2/resources/app-icon` | The consumer now owns hand-generated Darwin light/dark ICNS and Windows light/dark ICO assets. | Proves standard native assets can bypass the generator and form a declarative variant catalog. |
| `packages/cli/src/client.ts` | The App-scoped handle already owns App identity mutation but still uses generic `getIcon` / `setIcon` names. | Rename the unreleased API to `getAppIcon` / `setAppIcon` and let the setter accept either a catalog or a declared variant name. |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts | Pending; plan is being authored. |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | Pending implementation. |
| Self-review updates | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | Pending. |
| Normal archive | Commit containing `openspec archive <change>` result | Pending completion. |
| Abnormal handoff | Commit containing `HANDOFF.md` / `vN.HANDOFF.md` evidence before returning to user discussion | Not required in the normal path. |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
| `openspec/specs/webview-extension/spec.md` | WebView owns window protocol parsing and capability-gated window operations. | Extend with common app-mode style and explicit capability reporting. |
| `openspec/specs/runtime-host/spec.md` | Runtime host is app-isolated, caller-owned, and version/caller scoped. | Extend the app projection with app identity icon and Darwin activation aggregation. |
| `openspec/specs/client-sdk/spec.md` | Public SDK keeps App, Tray, and Session boundaries explicit. | Extend the runtime seam; do not move app identity into `createWebviewWindow`. |
| `openspec/specs/consumer-skills/spec.md` | Consumer guidance teaches retained WebView sessions and primary tray composition. | Add the normal-app window recipe and remove `keepOnTop` as a required workaround. |
| `openspec/changes/darwin-runtime-carrier-and-webview-permissions` | Existing incomplete vision2 investigation owns browser permissions and shared Darwin carrier. | Keep physically independent; coordinate only through documented carrier assumptions. |
| `openspec/changes/fix-windows-webview2-profile-path` | Current vision-driven changes use `plans/plan.md` as SSOT. | Reuse the current repository workflow. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| 和普通的应用程序一样 | A window with normal OS application identity and task switching behavior. | Application-mode window. |
| 启用 showInSwitchers | Put the window in taskbar/Alt+Tab or the macOS equivalent. | Shell membership projection. |
| 点击托盘会打开应用程序 | Tray primary event reveals the retained app window and activates it. | Tray-launched app reveal. |
| 关闭窗口，这个图标也会被关闭 | Close/hide removes Shell visibility while retaining the session for later reveal. | Operational visibility becomes false; session is not destroyed. |
| 不用 keepOnTop | Normal app discoverability must come from Shell membership, not forced z-order. | Independent z-order is not an app-mode prerequisite. |
| 行为命名 | A field name describes an implementation effect rather than product intent. | Name the product mode, then let each platform project it. |
| 顶层加一个 appIcon，默认继承 icon | App identity needs a dedicated icon source, not a tray candidate alias. | `appIcon` is an explicit platform asset array; omission keeps packaged/OS identity authoritative, and tray `Icon` is never promoted at runtime. |
| appIcon 也是数组但面向特定平台 | One cross-platform declaration may carry several OS-native assets. | Each element declares `platform` and native `format`; Linux may contribute multiple theme-size entries. |
| Windows系统的图标匹配规则 | Windows Shell first associates a process/window with AppUserModelID, then resolves launcher/window/executable artwork. | Keep grouping identity (`appId`) separate from artwork (`appIcon`) and avoid claiming tray metadata is a Shell identity. |
| 图标和标题的修改接口 | Runtime mutation of App identity, not badge status and not WebView window metadata. | Core protocol + public `AppHandle`; `ext-badge` remains overlay/status-only. |
| 默认的变体名是 default | An asset without variant metadata belongs to the canonical default state. | Normalize omission and explicit `default` to the same selection key. |
| `["default", "light"]` | One native file may serve multiple semantic names without duplicating bytes or entries. | `variant` accepts one name or a readonly name array. |
| 垃圾篓 empty/files | Variant names describe application state, not only color scheme. | Canonical term: App Icon Variant; the application decides when state changes. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| None yet | The existing Windows projection and ext-badge carrier are sufficient evidence for the first spec pass. | Add a change-local demo only if macOS activation aggregation cannot be proven with existing native tests. |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ----------------------------- |
| Should `appIcon` be configured in `createTray(..., runtimeOptions)` rather than in `createWebviewWindow(...)`? | A WebView window must not mutate process-wide Dock/taskbar identity; this is the ownership boundary that affects API shape. | Confirmed: runtime/App identity owns it. |
| Is removing public `style.platform.windows.showInSwitchers` acceptable as a breaking change? | Keeping an alias would preserve the behavior-shaped ontology the user asked to replace. | Confirmed: remove it without a public alias. |
| Should a process with mixed app-mode and tray-only WebViews use regular activation policy while any app-mode session is alive? | macOS activation policy is process-level, unlike Windows window extended styles. | Confirmed: Regular while any app-mode projection is live; Accessory after the last one closes/destroys. |
| What should happen when `appIcon` is omitted or incomplete? | Runtime conversion from tray artwork would make the contract non-deterministic. | Omission uses packaged/OS identity; an explicit array must contain a valid current-platform asset or initialization fails. |
| Where should runtime App title/icon mutation live? | Badge status and WebView window metadata are separate ownership domains. | Core protocol/kernel projection with a public `AppHandle`; ext-badge remains badge/overlay/attention only. |
| Does icon variant switching belong in WebView? | Theme or domain state may originate anywhere and WebView must not gain App identity authority. | Confirmed: no ext-webview API; consumers may expose their own typed IPC command that calls the App handle. |

## Intent

### Surface Intent

让 `skill-creator-v2` 使用一个真正的应用窗口：托盘主操作打开同一个保留窗口，窗口进入系统任务栏/切换器；用户关闭窗口后系统图标消失，但托盘仍然可以再次打开它。为此，OpenTray 用产品模式字段 `style.appMode` 取代公共 API 中的 Windows 行为字段 `showInSwitchers`，并提供顶层 `appIcon` 作为严格的平台应用身份资产数组；省略时使用平台打包或系统默认身份，不从 tray icon 推断。资产可声明 `default/light/dark` 或 `empty/files` 等语义变体，Core 只切换已声明名称，WebView 不参与 App identity 管理。

### Underlying Drive

当前 OpenTray 已经分别拥有“托盘工具窗口”和“普通应用窗口”所需的部分 native 能力，但公共契约仍按单个平台行为命名，导致消费者只能用 `keepOnTop` 补偿系统 Shell 不可见。用户要的是一个可被系统理解的应用身份，而不是另一个 z-order 开关。这个 change 将 App identity、WebView window style、session visibility 和平台 projection 重新对齐，同时保持 tray-first 和 session-authoritative 法则。

### Final Visible Effect

在 `skill-creator-v2` 中，用户从托盘点一次，应用窗口显示并获得焦点；Windows 任务栏/Alt+Tab 和 macOS Dock/应用切换器都把它当普通应用处理。macOS Dock 显示 `Skill Creator` 和调用方提供的 App 图标，而不是 `opentray`/`exec`。点击窗口关闭按钮只隐藏保留的窗口 session，系统 Shell 图标随之消失；再次点击托盘会恢复同一个窗口和页面状态。应用不需要置顶，也不会因为失去焦点而意外消失。托盘仍是生命周期入口，关闭 runtime/session 后所有 native 状态清理。

## Platform Diagnosis

- Current platform laws: App is caller-owned; Tray is a status atom; Session owns live authority; WebView owns its extension protocol; platform adapters project already-derived state; unsupported capabilities must be explicit.
- Core boundary: `opentray-core` means the platform-neutral kernel/crate and protocol layer. It owns App identity state and mutation contracts, but it cannot contain an `.app` bundle or depend on AppKit, native windowing, or a platform binary.
- Runtime distribution boundary: the published Darwin runtime atom is part of OpenTray core distribution and SHALL contain the broker executable plus the shared `.app` carrier needed for Regular/Accessory activation and App identity projection. This is a package/release responsibility, not a kernel responsibility.
- Does this fit as a regular atom: Yes. `appMode` is a common WebView shell intent; `appIcon`, its selected variant, and App identity mutation are Core/runtime identity contracts. They do not require a new public `createApp` entrypoint, a new tray event family, or an ext-webview command.
- Does this require law upgrade: Yes, in two narrow places: macOS activation policy must aggregate live app-mode windows, and app-mode close/reveal must project operational visibility consistently on every supported platform.
- Breaking update stance: Remove public `showInSwitchers` and migrate callers to `style.appMode`; do not publish a compatibility alias. Internal native variable names may remain temporarily while the adapter migration is completed.
- User confirmations still required: none for the approved `appMode`, `appIcon`, or stable appBundle direction. Remaining Linux support and platform-visible acceptance are engineering gates, not unresolved product decisions.

## Reverse-Inferred Design

### Interaction / Visual Story

```text
Tray primaryEvent
      |
      v
  hidden session? ---- no ----> activate existing app window
      |
     yes
      v
  reveal same HWND/page session
      |
      v
  Shell icon appears while appMode is visible

Window close / native hide
      |
      v
  visibleChange(false) + Shell icon disappears
      |
      v
  session remains retained for next tray reveal
```

The operator sees one application, not a new panel on every click. Tray and window remain two entry points into one session authority.

### Interface Shape

- Common WebView style gains `appMode: boolean`, default `false`.
- `appMode` is independent from `frameless`, `resizable`, `keepOnTop`, `autoHide`, background, opacity, and titlebar controls.
- Public platform style no longer exposes `showInSwitchers`; Windows and macOS adapters derive Shell membership from `appMode`.
- App-facing runtime options gain optional `appIcon?: AppIcon` next to `appId` and `appName`, where `AppIcon` is a readonly array of platform-specific standard assets.
- Every asset declares one of `darwin/icns`, `windows/ico`, or `linux/png|svg`; Linux fixed-size PNG entries carry a freedesktop theme size. Sources may be files or encoded bytes for the declared native format, but never raw RGBA, text, template, favicon, or remote URL data.
- Each asset may declare `variant?: string | readonly string[]`. Omission means `default`; a list such as `["default", "light"]` aliases one native file into both states. Names are application-defined semantic states rather than a closed theme enum.
- The resolver selects exactly the current platform and active variant. Duplicate Darwin/Windows entries or Linux sizes within one variant, malformed names/sources, missing `default`, missing selected variants, and explicit sets without a current-platform asset are typed validation failures. Omitted `appIcon` does not inherit from `trayIcon`; packaged/carrier/OS identity stays authoritative.
- The selected identity is frozen when App identity is initialized. Later tray or WebView icon changes do not mutate App identity unless the caller explicitly invokes the App identity setter.
- The public SDK exposes an App-scoped handle without introducing `createApp`: `tray.app.getName()`, `tray.app.setName(name)`, `tray.app.getAppIcon()`, `tray.app.getAppIconVariant()`, and `tray.app.setAppIcon(iconOrVariant)`.
- App-facing runtime options expose `appBundle?: { path?: string | URL; reinitialize?: boolean }`. Omission means a runtime-managed bundle at the npm-package-derived default path. `reinitialize: false` requires an explicit or default prebuilt bundle and forbids runtime mutation.
- Default bundle addressing preserves the caller package name independently from `callerLabel`: `@jixoai/skill-creator` maps to `~/.opentray/apps/@jixoai+skill-creator/<appName>.app`. Explicit `appBundle.path` has highest precedence and relative paths resolve against the caller package root, never the broker working directory.
- Package identity resolution precedence is explicit package metadata -> build-adapter project root -> `npm_package_name` -> the nearest package manifest above the caller entry script. The OpenTray package's own `import.meta.url` is never caller identity authority.
- Runtime-managed generation keeps the `.app` directory stable. It writes broker, plist, icon, and manifest through sibling-file replacement inside that directory; the manifest is the final commit record. It never rewrites a bundle owned by a live incompatible broker.
- Every `@opentray/*-plugin` exposes an appBundle build adapter backed by `@opentray/packaging`. A prebuilt bundle includes the broker, bootstrap icon, plist, and manifest required for runtime validation.
- `setAppIcon("files")` changes only the selected name in the retained catalog; `setAppIcon(nextAppIcon)` replaces the catalog and resets selection to `default`; `setAppIcon(null)` clears explicit App artwork. A rejected selection preserves the previous catalog and projection.
- `AppIconVariantOf<typeof appIcon>` derives `default` plus every literal name from an `as const` catalog so application IPC can stay name-safe without adding WebView coupling.
- `AppHandle.setName` mutates logical App identity and supported runtime/tray projections; it does not rename a packaged executable or a macOS bundle at runtime. `WebviewWindowHandle.setTitle` remains window-scoped.
- Existing `primaryEvent`, `show`, `toVisible`, `close`, `destroy`, `isVisible`, and `visibleChange` remain the lifecycle verbs.

### Data Shape

- Durable App identity: `(appId, appName, appIconCatalog, appIconVariant)` plus explicit runtime mutations stored in Core. `AppProjection` carries only the selected variant subset to native backends.
- Windows grouping identity: stable `appId` / AppUserModelID. Windows icon artwork: native App/shortcut/window/executable source selected by the resolver. These facts must not be collapsed into one tray icon field.
- Window declaration: `(trayId, window session, appMode, other WebView style)`, owned by the extension session.
- Platform projection: Windows extended styles; macOS process activation policy plus window ordering; Linux capability absence or a truthful adapter projection.
- Operational visibility: `!closed && !minimized`, emitted only when the projection changes.
- Darwin app-mode count is derived from live `(appId, sessionId, windowId)` state. Closing one window must not demote a process while another app-mode window remains.

### Architecture Shape

```text
createTray(options, runtimeOptions)
        |
        +--> npm package identity + appBundle policy
        |       { packageName, path?, reinitialize }
        |              |
        |              v
        |       ~/.opentray/apps/<package>/<appName>.app
        |              |
        |              +--> managed: rewrite owned files + commit manifest
        |              |
        |              `--> prebuilt: validate only
        |
        +--> App identity { appId, appName, appIconCatalog, activeVariant }
        |       |
        |       +--> AppHandle.setName / setAppIcon(catalog | variant)
        |
        +--> Tray projection { icon, menu, primaryEvent }
                         |
                         v
              ext-webview window session
              { style.appMode, visibility, page }
                         |
          +--------------+--------------+
          v                             v
   Windows adapter                 Darwin adapter
   APPWINDOW/TOOLWINDOW            Regular/Accessory aggregate
```

The kernel remains backend-neutral. The extension owns WebView commands and session state. Core owns App identity state and mutation frames; adapters consume the resulting projection. `ext-badge` owns only status overlays and attention. No layer infers app mode or App identity from a window title/icon.

The Darwin runtime package publishes one broker binary and a minimal carrier template. The SDK materializes a stable package-addressed bundle and launches the broker from its executable path; it does not publish a second compressed copy of the broker inside a carrier zip. Build plugins may generate the same complete bundle ahead of time. `ext-badge` may consume that carrier contract, but it does not own an `OpenTrayBadgeHelper.app` lifecycle or make its package the source of the runtime App bundle.

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| `appIcon` placement | Determines whether a window can mutate process identity. | Confirmed: Runtime/App-facing options. |
| Rename compatibility | Determines whether downstream consumers get an alias. | Confirmed: breaking removal of public `showInSwitchers`. |
| Darwin mixed-mode policy | Process activation policy is global, while window mode is local. | Confirmed: Regular while any live app-mode projection exists; Accessory otherwise. |
| App title/icon mutation ownership | Determines whether status extension or platform-neutral identity owns the API. | Core protocol/kernel + public `AppHandle`; ext-badge remains status-only. |
| App icon variant meaning | Determines whether Core hard-codes theme behavior. | Confirmed: arbitrary semantic name; omitted means `default`; one asset may declare one or many names. |
| Variant switching transport | Determines whether WebView becomes App identity authority. | Confirmed: Core/App handle only; consumer IPC is optional and application-owned. |

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [x] 2. Write specs from the intent.
- [x] 3. Write BDD tasks from specs.
- [ ] 4. Commit the revised OpenSpec artifacts before product-code work.
- [ ] 5. Implement public TypeScript/Rust contracts and Windows projection.
- [ ] 6. Implement Darwin activation aggregation, shared carrier packaging/discovery, app identity icon resolution, and lifecycle projection.
- [ ] 7. Migrate `skill-creator-v2` and remove its `keepOnTop` workaround.
- [ ] 8. Run native/unit/consumer acceptance and self-review against this intent.
- [ ] 9. Archive the completed change.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| What is the exact carrier launch/discovery mechanism for each Darwin runtime package? | The package must ship one coherent broker-plus-carrier artifact graph without duplicating the broker or making consumers hand-install a helper. | Decided: publish one broker plus a minimal plist template; reinitialize a stable package-addressed bundle in place, or validate a plugin-built prebuilt bundle, then launch its broker executable. |
| What should Linux report for `appMode` before a Shell projection is implemented? | A false success would break the capability law. | Keep `appMode` accepted only where the adapter can report truthful Shell behavior; otherwise expose capability absence or a typed unsupported result. |
| Should App identity icon resolution reject an incompatible explicit icon or fall back? | Silent fallback can make a signed app appear with the wrong identity and hide a packaging defect. | Reject malformed, duplicate, or current-platform-missing explicit `appIcon`; only omission may use the packaged/OS identity. |
| Should App title mutation rename the OS bundle/process? | macOS bundle display name and Windows shortcut identity are packaging/Shell metadata, not freely mutable runtime projection. | No. Mutate logical App name and supported current projections; keep window title and packaged bundle identity separate. |
| What happens when a selected App icon variant is absent? | Silent fallback would make application state lie. | Reject with a typed error, keep the previous active variant and native projection, and never fall back to another name. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Keep public `style.platform.windows.showInSwitchers` and add macOS beside it | It preserves a platform behavior ontology and makes consumers reason about OS effects instead of product mode. |
| Make `appMode` imply `keepOnTop` | It recreates the workaround the user wants removed and conflates Shell membership with z-order. |
| Put `appIcon` on `createWebviewWindow()` | A window would gain authority over process-wide Dock/taskbar identity, violating App ownership. |
| Recreate/destroy the native window on every tray click | It loses page/session state and violates the retained WebView session law. |
| Toggle macOS activation policy from one WebView window without aggregation | Mixed tray-only and app-mode sessions would leak or steal process identity. |
| Reuse generic `Icon` for `appIcon` | It permits tray templates, RGBA buffers, text, and favicon-like data to masquerade as process identity. |
| Treat title, favicon, or `window.setIcon()` as App identity | These are window/page metadata and must not mutate Dock/taskbar identity. |
| Put App title/icon setters in `ext-badge` | Badge is an orthogonal status extension; making it the owner would force every app identity consumer to mount a status extension and would conflate base artwork with overlays. |
| Model App icon variants as only `light/dark` | Application identity also represents semantic state such as `empty/files`; a theme enum would encode one consumer policy into Core. |
| Add variant commands to `ext-webview` | WebView is window/page metadata and must not gain authority over process-level App identity; applications can expose typed IPC when needed. |
| Treat variant selection as catalog replacement | It would discard declared alternatives and make repeated state switching depend on caller-side hidden storage. |
| Use the first tray icon as an App icon fallback | Tray artwork has different template/size semantics; runtime conversion would be implicit and non-reproducible. |
| Put the `.app` bundle in `opentray-core` | The kernel is platform-neutral and cannot contain AppKit carrier code or a native bundle; this would collapse protocol ownership into packaging. |
| Let `ext-badge` remain the owner of the shared `.app` carrier | A status extension must not become a prerequisite for every App-mode runtime and would give badge semantics ownership of process identity. |

## Exit Conditions

- Default max review iterations: 2 self-review loops after the initial implementation.
- Issue recurrence threshold: Reopen a task if the same platform/lifecycle defect appears in two independent acceptance paths.
- Custom exit condition from intent: the change is complete only when a consumer can use `style.appMode` and an optional strict platform-standard `appIcon` catalog through the published facade, select declared semantic variants without WebView coupling, Windows and macOS expose truthful Shell behavior, close/reveal preserves one session, `@opentray/darwin-*` publishes the broker plus shared `.app` carrier, and `skill-creator-v2` no longer depends on `keepOnTop` for discoverability.
