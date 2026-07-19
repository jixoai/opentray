# Intent Document

## Current Round

- Round: 5
- Status: macOS acceptance proved that packaging a carrier zip is insufficient: the raw broker still enters Dock as `opentray` with the generic `exec` icon. The runtime must execute the broker from a caller-materialized `.app` and project the Core App icon before app-mode promotion. Consumer icon generation now belongs to the linked `@opentray/vite-plugin`, whose cache must include the implementation artifact and whose source-dev tray lookup must prefer `webui/static` over a stale build directory.
- Previous plan backup: `plans/plan-v3.md`

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

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | `skill-creator-v2` should behave like a normal application: tray primary action reveals the window, the window appears in the system taskbar/switcher, closing it removes the taskbar icon, and the tray can reveal it again. | The target is a retained window session with normal Shell membership, not a recreated window per click. |
| 2 | User | `keepOnTop` is only a workaround for the absence of switcher membership and should no longer be needed for the application-mode consumer. | `keepOnTop` remains an independent z-order capability; app mode must not imply it. |
| 3 | User | macOS must support the same app-mode effect; the existing `ext-badge` `.app` carrier proves the effect is feasible. | Darwin runtime activation policy and app identity become part of the same cross-platform contract. |
| 4 | User | `showInSwitchers` is behavior-shaped naming and should be replaced by a dedicated standard name. | Public API uses `style.appMode`; the old public Windows field is removed rather than aliased. |
| 5 | User | Proposed `style.appMode: bool` plus a top-level `appIcon` that defaults to `icon`, with a request for design improvement. | App identity is configured at the App-facing runtime seam; inheritance is a one-time initialization rule, not a live alias. |
| 6 | User | The work must now proceed through OpenSpec. | This change must complete the vision-driven artifact chain before product-code implementation. |
| 7 | User | Confirmed removal of public `showInSwitchers`, App runtime placement of `appIcon`, and Darwin Regular/Accessory aggregation. | These are approved breaking/platform decisions; implementation may proceed after the artifact update. |
| 8 | User | Requested that `appIcon` inheritance follow Windows system icon matching rules. | The resolver must separate AppUserModelID/group identity from icon artwork and prefer native App identity sources before convenience tray inheritance. |
| 9 | User | Asked for interfaces to change App icon and title, and whether they belong in `ext-badge` or Core. | App identity mutation is a Core/runtime contract; ext-badge remains status overlay capability; window title/icon remain ext-webview metadata. |
| 10 | User | Clarified that although the platform-neutral Core must not package `.app`, the OpenTray core runtime distribution should contain the App bundle. | Separate kernel source ownership from Darwin runtime distribution: the shared carrier ships with `@opentray/darwin-*`, while `ext-badge` no longer owns a private carrier. |
| 11 | User | macOS visual acceptance found a Dock item titled `opentray` with the generic `exec` icon. | A carrier artifact that is merely staged but never launches the broker is not a carrier implementation. The broker must run from a caller-specific materialized bundle and App artwork must reach `NSApplication`. |
| 12 | User | During rapid iteration, `skill-creator-v2` should directly link the local OpenTray checkout; every `pnpm dev` must prepare all required local artifacts first. | Add a reproducible linked-consumer preparation command and wire it into `skill-creator-v2` `predev`; do not require a publish cycle for native acceptance. |
| 13 | User | The icon generator itself must participate in cache identity; changing `color-symbol` to `flat-symbol` must update the tray/app assets, and the whole chain must move into the linked `@opentray/vite-plugin`. | Move normalization and ICNS generation into the plugin, hash its built implementation plus source/recipe/encoder identity, rebuild it from `skill-creator-v2` `predev`, and resolve source-dev icons from `webui/static` so stale `webui/build` output cannot win. |

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
| `crates/opentray-spec/src/model.rs:9-20` | `AppOptions` already carries an optional `icon`. | Protocol-level `appIcon` duplication is unnecessary; the facade/runtime seam can feed existing app identity. |
| `packages/cli/src/sdk.ts:20-37,50-67` | `createTray` accepts runtime `appId`/`appName` but no `appIcon`; tray options own only tray icon. | `appIcon` should be added to App-facing runtime configuration rather than to a WebView window. |
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
| 顶层加一个 appIcon，默认继承 icon | App identity needs a dedicated icon source with ergonomic fallback. | Explicit App identity icon, resolved with native identity precedence and only then convenience tray inheritance. |
| Windows系统的图标匹配规则 | Windows Shell first associates a process/window with AppUserModelID, then resolves launcher/window/executable artwork. | Keep grouping identity (`appId`) separate from artwork (`appIcon`) and avoid claiming tray metadata is a Shell identity. |
| 图标和标题的修改接口 | Runtime mutation of App identity, not badge status and not WebView window metadata. | Core protocol + public `AppHandle`; `ext-badge` remains overlay/status-only. |

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
| What should the App icon inheritance order be? | Windows Shell uses AppUserModelID for grouping and native app/window/shortcut sources for artwork; blindly inheriting a tray icon can override the actual application identity. | Explicit `appIcon` -> packaged/carrier App icon -> explicit App-level `AppOptions.icon` -> first native-capable tray icon snapshot -> OS default. |
| Where should runtime App title/icon mutation live? | Badge status and WebView window metadata are separate ownership domains. | Core protocol/kernel projection with a public `AppHandle`; ext-badge remains badge/overlay/attention only. |

## Intent

### Surface Intent

让 `skill-creator-v2` 使用一个真正的应用窗口：托盘主操作打开同一个保留窗口，窗口进入系统任务栏/切换器；用户关闭窗口后系统图标消失，但托盘仍然可以再次打开它。为此，OpenTray 需要用产品模式字段 `style.appMode` 取代公共 API 中的 Windows 行为字段 `showInSwitchers`，并提供顶层 `appIcon` 作为 App identity 输入，缺省时从启动阶段的 tray icon 继承。

### Underlying Drive

当前 OpenTray 已经分别拥有“托盘工具窗口”和“普通应用窗口”所需的部分 native 能力，但公共契约仍按单个平台行为命名，导致消费者只能用 `keepOnTop` 补偿系统 Shell 不可见。用户要的是一个可被系统理解的应用身份，而不是另一个 z-order 开关。这个 change 将 App identity、WebView window style、session visibility 和平台 projection 重新对齐，同时保持 tray-first 和 session-authoritative 法则。

### Final Visible Effect

在 `skill-creator-v2` 中，用户从托盘点一次，应用窗口显示并获得焦点；Windows 任务栏/Alt+Tab 和 macOS Dock/应用切换器都把它当普通应用处理。macOS Dock 显示 `Skill Creator` 和调用方提供的 App 图标，而不是 `opentray`/`exec`。点击窗口关闭按钮只隐藏保留的窗口 session，系统 Shell 图标随之消失；再次点击托盘会恢复同一个窗口和页面状态。应用不需要置顶，也不会因为失去焦点而意外消失。托盘仍是生命周期入口，关闭 runtime/session 后所有 native 状态清理。

## Platform Diagnosis

- Current platform laws: App is caller-owned; Tray is a status atom; Session owns live authority; WebView owns its extension protocol; platform adapters project already-derived state; unsupported capabilities must be explicit.
- Core boundary: `opentray-core` means the platform-neutral kernel/crate and protocol layer. It owns App identity state and mutation contracts, but it cannot contain an `.app` bundle or depend on AppKit, native windowing, or a platform binary.
- Runtime distribution boundary: the published Darwin runtime atom is part of OpenTray core distribution and SHALL contain the broker executable plus the shared `.app` carrier needed for Regular/Accessory activation and App identity projection. This is a package/release responsibility, not a kernel responsibility.
- Does this fit as a regular atom: Yes. `appMode` is a common WebView shell intent; `appIcon` and App identity mutation are Core/runtime identity contracts. They do not require a new public `createApp` entrypoint or a new tray event family.
- Does this require law upgrade: Yes, in two narrow places: macOS activation policy must aggregate live app-mode windows, and app-mode close/reveal must project operational visibility consistently on every supported platform.
- Breaking update stance: Remove public `showInSwitchers` and migrate callers to `style.appMode`; do not publish a compatibility alias. Internal native variable names may remain temporarily while the adapter migration is completed.
- User confirmations still required: none for the approved `appMode`/`appIcon` direction. Remaining Linux support and exact packaged-carrier implementation are engineering gates, not unresolved product decisions.

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
- App-facing runtime options gain optional `appIcon?: Icon` next to `appId` and `appName`.
- App icon inheritance follows the Windows identity/artwork split: `appId` is the stable Shell grouping identity, while `appIcon` is artwork. The resolver order is explicit `appIcon` -> packaged/carrier App icon -> explicit App-level `AppOptions.icon` -> first native-capable tray icon snapshot -> OS default.
- The inheritance result is frozen when App identity is initialized. Later tray or WebView icon changes do not mutate App identity unless the caller explicitly invokes the App identity setter.
- The app icon must be a native-capable icon source. Remote WebView URLs and tray-only text templates are not silently promoted to a high-quality application icon.
- The public SDK exposes an App-scoped handle without introducing `createApp`: `tray.app.getName()`, `tray.app.setName(name)`, `tray.app.getIcon()`, and `tray.app.setIcon(icon)`.
- `AppHandle.setName` mutates logical App identity and supported runtime/tray projections; it does not rename a packaged executable or a macOS bundle at runtime. `WebviewWindowHandle.setTitle` remains window-scoped.
- Existing `primaryEvent`, `show`, `toVisible`, `close`, `destroy`, `isVisible`, and `visibleChange` remain the lifecycle verbs.

### Data Shape

- Durable App identity: `(appId, appName, resolvedAppIcon)` plus explicit runtime mutations stored in Core.
- Windows grouping identity: stable `appId` / AppUserModelID. Windows icon artwork: native App/shortcut/window/executable source selected by the resolver. These facts must not be collapsed into one tray icon field.
- Window declaration: `(trayId, window session, appMode, other WebView style)`, owned by the extension session.
- Platform projection: Windows extended styles; macOS process activation policy plus window ordering; Linux capability absence or a truthful adapter projection.
- Operational visibility: `!closed && !minimized`, emitted only when the projection changes.
- Darwin app-mode count is derived from live `(appId, sessionId, windowId)` state. Closing one window must not demote a process while another app-mode window remains.

### Architecture Shape

```text
createTray(options, runtimeOptions)
        |
        +--> Darwin runtime materializer
        |       { carrier template, appId, appName }
        |              |
        |              v
        |       <runtime>/OpenTray.app/Contents/MacOS/opentray
        |
        +--> App identity { appId, appName, resolvedAppIcon }
        |       |
        |       +--> AppHandle.setName / setIcon
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

The shared Darwin carrier is composed and published by the Darwin runtime package. The SDK materializes that template inside the caller-scoped runtime directory and launches the broker from the bundle executable path; staging an unrelated idle `.app` beside a raw broker is not sufficient. `ext-badge` may consume that carrier contract, but it does not own an `OpenTrayBadgeHelper.app` lifecycle or make its package the source of the runtime App bundle.

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| `appIcon` placement | Determines whether a window can mutate process identity. | Confirmed: Runtime/App-facing options. |
| Rename compatibility | Determines whether downstream consumers get an alias. | Confirmed: breaking removal of public `showInSwitchers`. |
| Darwin mixed-mode policy | Process activation policy is global, while window mode is local. | Confirmed: Regular while any live app-mode projection exists; Accessory otherwise. |
| App title/icon mutation ownership | Determines whether status extension or platform-neutral identity owns the API. | Core protocol/kernel + public `AppHandle`; ext-badge remains status-only. |

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
| What is the exact carrier launch/discovery mechanism for each Darwin runtime package? | The package must ship one coherent broker-plus-carrier artifact graph without making consumers hand-install a helper. | Decided: package a broker-bearing carrier template, materialize it atomically under the caller runtime directory, set `CFBundleIdentifier`/`CFBundleName`/`CFBundleDisplayName`, then launch that bundle's broker executable. |
| What should Linux report for `appMode` before a Shell projection is implemented? | A false success would break the capability law. | Keep `appMode` accepted only where the adapter can report truthful Shell behavior; otherwise expose capability absence or a typed unsupported result. |
| Should App identity icon resolution reject an incompatible explicit icon or fall back? | Silent fallback can make a signed app appear with the wrong identity. | Reject an explicit non-native-capable `appIcon`; only implicit inheritance may use the documented fallback chain. |
| Should App title mutation rename the OS bundle/process? | macOS bundle display name and Windows shortcut identity are packaging/Shell metadata, not freely mutable runtime projection. | No. Mutate logical App name and supported current projections; keep window title and packaged bundle identity separate. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Keep public `style.platform.windows.showInSwitchers` and add macOS beside it | It preserves a platform behavior ontology and makes consumers reason about OS effects instead of product mode. |
| Make `appMode` imply `keepOnTop` | It recreates the workaround the user wants removed and conflates Shell membership with z-order. |
| Put `appIcon` on `createWebviewWindow()` | A window would gain authority over process-wide Dock/taskbar identity, violating App ownership. |
| Recreate/destroy the native window on every tray click | It loses page/session state and violates the retained WebView session law. |
| Toggle macOS activation policy from one WebView window without aggregation | Mixed tray-only and app-mode sessions would leak or steal process identity. |
| Add a public `appIcon` field to the wire `AppOptions` immediately | The protocol already has `AppOptions.icon`; duplicating the field would create two competing identity sources. |
| Treat title, favicon, or `window.setIcon()` as App identity | These are window/page metadata and must not mutate Dock/taskbar identity. |
| Put App title/icon setters in `ext-badge` | Badge is an orthogonal status extension; making it the owner would force every app identity consumer to mount a status extension and would conflate base artwork with overlays. |
| Use the first tray icon as the unconditional App icon | Windows Shell separates AppUserModelID/grouping from launcher/window/executable artwork; a tray icon is only a convenience fallback. |
| Put the `.app` bundle in `opentray-core` | The kernel is platform-neutral and cannot contain AppKit carrier code or a native bundle; this would collapse protocol ownership into packaging. |
| Let `ext-badge` remain the owner of the shared `.app` carrier | A status extension must not become a prerequisite for every App-mode runtime and would give badge semantics ownership of process identity. |

## Exit Conditions

- Default max review iterations: 2 self-review loops after the initial implementation.
- Issue recurrence threshold: Reopen a task if the same platform/lifecycle defect appears in two independent acceptance paths.
- Custom exit condition from intent: The change is complete only when a consumer can use `style.appMode` and optional `appIcon` through the published facade, Windows and macOS expose truthful Shell behavior, close/reveal preserves one session, `@opentray/darwin-*` publishes the broker plus shared `.app` carrier, and `skill-creator-v2` no longer depends on `keepOnTop` for discoverability.
