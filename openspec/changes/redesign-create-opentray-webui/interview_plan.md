# Interview Plan

## Original User Input

Relevant original requirements, preserved verbatim:

> 现在基本的布局、功能都已经打磨完毕。我们开始要打磨美学和可访问性：
> 1. 国际化，我们需要在页面的最左侧，新增一个导航栏。到时我们可以在这个导航栏的底部，加入切换语言的支持。需要加入 中日韩、英语、阿拉伯（rtl）、法语、西班牙语、德语、俄语的支持
> 2. 加入 theme 切换的能力：system|light|dark
> 3. shadcnui 更新到最新版，并使用 baseui 作为底层引擎。并检查所有的页面上出现的组件、思考它们的形态在 shadcnui 中，是否有更契合的组件来呈现？
> 4. 在导航栏加入一个“帮助中心”，这里本质上是一个list-detail 页面，list 提供文件列表，detail 提供文件详情。也就是说帮助中心其实是一个简单的 Readonly 的文件夹浏览器，只提供了 markdown 的查看，这个文件夹的结构符合 skill 的标准，默认展示的就是 SKILL.md 的文件内容 。这里我们会解释 opentray 的工作原理、然后再解释 create-opentray 的工作原理。并且介绍 create-opentray 的 cli 工具。
> 9. 我们现有的“新增”应用，是导航栏的默认路由。
> 10. 需要在导航栏新增一个“应用列表”，扫描 `~/.opentray/create/*` 目录（也就是说这个目录是固定的，不能变，即便是允许修改，那么也必须 symlink 到`~/.opentray/create/` 目录下），将目前的应用列出来。可以编辑应用，直接进入到“新增”页面，但是带上目前的 create-opentray.json 参数，填充到页面中，并且默认开启覆盖模式（`--force`）
> 11. 如果可以，在应用列表中提供卸载功能，不过后续的 macOS-Dock 图标 和 Windows-任务栏图标 的 删除估计得用户自己手动操作了。
> 14. webui 需要提供“命令导出功能”，将完整的参数都带上，支持直接复制也支持导出脚本文件（支持 shell 或者 powershell），可以选择 `.sh`文件或者`.ps1`文件。不过这里有一个难点，如果遇到是用户自己上传的图片，那么导出的时候，只能 默认导出脚本文件，然后将用户上传的图片内容嵌入到这个脚本中。如果非要使用复制粘贴，内容可能会非常长，所以除非用户强制选择“直接复制到剪切板”，这也是有可能的，因为内容可能是 svg，最终体积不会非常大。
> 15. icon 相关的提供一个高级选项：imageSmoothingEnabled，这对于上传的图片是一个低分辨率的非常有用，因为用户很有可能就是在做像素风格的图标。如果禁用imageSmoothingEnabled，那么我们将它等比放大成 appIcon 的前景 和 trayIcon 就可以保护其中的锯齿行为。
> 16. 新增一个选项：允许开发者模式。默认不勾选
>
> 1. 我新增了logo 资源：/Users/kzf/Dev/GitHub/jixoai-labs/opentray/.agents/images/create-opentray-logo.png ，/Users/kzf/Dev/GitHub/jixoai-labs/opentray/.agents/images/opentray-logo.png
> 2. 将 opentray-logo.png 用来更新我们的 README.md
> 3. 将 create-opentray-logo.png  用来更新我们的 create-opentray 的 README.md 和 webui
>
> 3. 你的责任是只撰写 openspec change

Requirement-bearing interview confirmations, preserved verbatim:

> create-opentray webui 相关的开发聚合成一个 change 吧。
>
> 统一
>
> 我觉得还有一个 cli/webui 的统一内核的工作
>
> 同意，这样确实可以保护用户自己磁盘上的文件。不过我们在打印的时候需要明确体现出这个信息
>
> cli的skill不需要多语言，只提供英文就好，确保skill本身的标准（是面向AI而不是人类）。
> webui上的翻译版本是webui自己做针对性提供。
>
> 我们无法区分敏感值，否则你还得搞一套关键字，这并不合理，一旦出问题用户反而要怪你为什么没有识别到这关键字。
> 因此核心应是“复制或下载包含敏感值的完整命令前，必须明确确认一次。”，如果有配置env，那么需要让用户勾选同意风险的免责声明checkbox
> 在确认env的时候，界面上确实可以提供可写的表单，用户可以在这里直接修改，手动清空或者改成安全模板关键字

## Pre-Interview Orientation

| Field | Record |
| ----- | ------ |
| Confirmed topic | One aggregated create-opentray WebUI workbench Change covering navigation, aesthetics, accessibility, localization, registry workflows, help, export, and form additions. |
| Interview mother tongue | Chinese; the user conducted and confirmed the architecture interview in Chinese. |
| Thinking language for this interview | Chinese |
| Confirmation source | The user explicitly required one aggregated WebUI Change and approved the final three-Change dependency summary. |

## Q&A Ledger

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | Said core layout/functionality is already polished and shifted focus to aesthetics and accessibility. | This is a production-tool refinement, not a new marketing landing page or wholesale workflow replacement. |
| 2 | User | Required a left navigation rail, nine locale families including Arabic RTL, and system/light/dark theme. | Establishes global shell, direction, localization, persistence, and theme state. |
| 3 | User | Required latest shadcn/ui using Base UI and a page-wide component suitability review. | Migration must replace the primitive engine and audit semantics, not only bump versions. |
| 4 | User | Required a read-only Markdown list-detail help center with Skill-shaped paths and default `SKILL.md`. | Adds a real routed work surface with safe content projection. |
| 5 | User | Required Add as default route plus app list/edit/uninstall over the fixed registry. | Turns the one-screen wizard into a workbench with registry lifecycle. |
| 6 | User | Required full command copy and `.sh`/`.ps1` export, with uploaded image bytes embedded in scripts and force-copy still possible. | Export is a first-class workflow, not a debug text preview. |
| 7 | User | Required image smoothing control and developer mode, both default-safe. | Adds durable advanced form state that must round-trip through Core. |
| 8 | User | Required all WebUI work in one Change. | Navigation, help, apps, export, i18n, theme, component migration, and branding cannot be split into independent Changes. |
| 9 | User | Required a shared CLI/WebUI Core. | WebUI browser/server code must not keep its duplicate domain model or filesystem procedures. |
| 10 | Assistant | Recommended one physical registration envelope, safe linked uninstall, immutable appId, and Core Plan/Apply. | Defines the data/lifecycle contract WebUI must present. |
| 11 | User | Confirmed and required removal/retention output to be explicit. | UI confirmations and results must distinguish unlink, retain, purge, and manual OS pin cleanup. |
| 12 | Assistant | Recommended developer mode mean only per-window WebView DevTools admission. | Prevented a vague toggle from enabling unrelated behavior. |
| 13 | User | Confirmed. | The form option maps only to Core `developerMode`. |
| 14 | User | Rejected env secret heuristics; required an editable env review and disclaimer checkbox before complete copy/download. | UI gates every env-bearing export uniformly and lets the user sanitize values manually. |
| 15 | Assistant | Proposed localized overlays inside the AI Skill tree. | Raised the content-ownership boundary. |
| 16 | User | Corrected it: CLI Skill stays English and AI-facing; WebUI owns targeted translations. | Human help content is a WebUI projection, not localized AI Skill files. |
| 17 | User | Approved breaking v1-only behavior and the final Core -> CLI/WebUI graph. | App list does not need legacy UI/migration, and implementation may proceed only after Core contract readiness. |

## Evidence Read

| Source (file / change / spec) | Fact | Why it matters |
| ----------------------------- | ---- | -------------- |
| `packages/create-webui/src/app.tsx:1` | Current UI is one large wizard page with route, server, form, icon, terminal, and dialog state in one component. | A routed workbench needs explicit page ownership and shared state boundaries. |
| `packages/create-webui/src/wizard-protocol.ts:1` | Browser code manually mirrors server types and endpoint helpers. | WebUI must consume a shared adapter contract derived from Core rather than a second model. |
| `packages/create-webui/package.json:13` | Current component primitives are seven Radix packages. | Base UI migration is a full engine replacement, not a no-op shadcn refresh. |
| `packages/create-webui/src/index.css:3` | Current tokens are dark-first only. | System/light/dark requires complete paired semantic tokens and no flash-before-theme. |
| `packages/create-webui/src/index.css:92` | Current CSS globally customizes browser scrollbars. | The design-system audit must decide one accessible scrollbar treatment rather than inheriting one dark-only global rule. |
| `packages/create-webui/src/components/ui/*` | Current local shadcn layer includes Accordion, Badge, Button, Dialog, Input, Label, Select, Switch, and Tabs. | The audit must evaluate missing Sidebar, AlertDialog, Field, ScrollArea, Resizable, Tooltip, Skeleton, and other better-fitting official components. |
| `.agents/images/create-opentray-logo.png` | Supplied create-opentray logo is a 1024x1024 RGBA PNG. | The workbench must promote it into a stable product-owned asset and use it as a first-viewport identity signal. |
| shadcn/ui current Base registry docs | Current shadcn maintains Base UI and Radix registries; migration changes `asChild` to `render` and state attributes to Base UI presence/state APIs. | Component source and tests must be regenerated/audited, not mechanically swap imports. |
| shadcn/ui current Sidebar RTL docs | Sidebar accepts `dir`, mirrors side, sheet, rail, and directional icons for RTL. | Arabic must be a structural direction test, not text alignment only. |
| Base UI DirectionProvider docs | Base UI direction context is explicit for RTL-aware primitives. | Locale direction must reach primitives as well as the document `dir`. |
| `openspec/changes/unify-create-opentray-core/toc.md` | Core owns v1 state, registry, lifecycle, resources, process observation, and export plan. | WebUI owns interaction and projection only. |

## User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| 新增 | The primary create/edit work surface and default route. | Add Application page. |
| 应用列表 | Current v1 registrations under the fixed create registry. | Application management route. |
| 帮助中心 | Read-only human documentation browser, not a support ticket portal. | Markdown list-detail route. |
| list-detail | Persistent file list/tree plus selected document detail. | Responsive two-pane help layout. |
| shadcnui 中更契合的组件 | Standard task semantics should use the most suitable current official component. | Component inventory and semantic replacement audit. |
| 阿拉伯（rtl） | Direction changes shell and interaction geometry, not just glyph order. | Full RTL projection with LTR technical islands. |
| 强制选择直接复制 | User knowingly overrides the script-default path for embedded uploads. | Explicit long-command force-copy action. |
| 免责声明checkbox | A real blocking acknowledgement when any env entry is exported. | Uniform env-risk gate with editable values. |

## Intent

### Surface Intent

Turn the finished wizard into an aesthetically polished, accessible, localized create-opentray workbench with navigation, themes, application management, human help, export, and advanced icon/developer controls, while updating shadcn to the latest Base UI engine.

### Underlying Drive

The user is no longer asking for isolated controls. The WebUI is becoming the human operator for the same declarative system used by automation. It needs stable routes, quiet information density, reliable direction/theme/keyboard behavior, truthful destructive results, and a component vocabulary users already understand. Browser convenience may enrich input, but cannot own application truth.

### Final Visible Effect

The first viewport identifies create-opentray and presents a restrained task shell. Add is the default route; Apps lists and safely edits/uninstalls v1 registrations; Help opens localized human Markdown in a list-detail browser with `SKILL.md` selected. Language and theme controls live at the navigation bottom, Arabic mirrors the shell, and technical content stays readable LTR. Every form/export/destructive workflow is keyboard- and screen-reader-operable, uses current shadcn/Base UI components, and projects Core plans without duplicating business rules.

### Workflow Fit

This is one aggregated `vision2` WebUI Change, as explicitly required. It depends on the implementation-ready `unify-create-opentray-core` contract. Its stable `create-opentray web` end-to-end gate also depends on `add-create-opentray-cli`; internal WebUI implementation may proceed in parallel after Core stabilizes.

## Open Questions

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |

## Decisions

| Decision | Confirmed by | Reversible? |
| -------- | ------------ | ----------- |
| All create-opentray WebUI work is one Change. | User explicit instruction. | No for this delivery. |
| Add is the default route; Apps and Help are peer navigation routes. | Original user requirement. | Route paths may evolve, roles do not. |
| Support zh-CN, ja, ko, en, ar, fr, es, de, and ru; Arabic is RTL. | Original user requirement. | More locales may be added later. |
| Theme modes are system, light, and dark. | Original user requirement. | No within this UI contract. |
| Current shadcn with Base UI fully replaces Radix runtime primitives. | Original requirement plus audited current docs. | A later Change could select another engine; no dual stack here. |
| Human help translations are WebUI-owned; CLI Skill remains English AI content. | User explicit correction. | Shared facts must stay aligned, wording may differ. |
| Edit reuses Add form with v1 values, immutable appId, and force enabled for verified payload replacement. | Original request plus confirmed Core identity/ownership law. | No within v1. |
| Any env entry triggers editable review and a mandatory disclaimer checkbox; no secret heuristics. | User explicit correction. | No heuristic may be implied. |
| Uploaded bytes default to script export; direct copy requires explicit force-copy. | Original user requirement. | No for this workflow. |
| `developerMode` means DevTools admission only and defaults off. | User confirmed. | No within v1. |
| Legacy applications are not listed or migrated. | User required breaking update. | Intentionally breaking. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Split theme/i18n, help, app list, and export into separate WebUI Changes. | The user explicitly wants one aggregated WebUI delivery. |
| Keep Radix beside Base UI during an open-ended migration. | Dual primitives create inconsistent interaction/a11y behavior and fail the requested engine switch. |
| Treat Arabic as translated strings inside an LTR shell. | RTL affects navigation side, icons, focus order, overlays, and layout geometry. |
| Localize the AI Skill for WebUI. | WebUI help is human-targeted content; CLI Skill stays English and AI-facing. |
| Detect likely secret env names. | The user rejects incomplete heuristics and requires uniform acknowledgement instead. |
| Hide invalid v1 registrations or report uninstall as one generic success. | Operators need truthful repair/destructive evidence. |
| Turn the new navigation into a marketing landing page. | This is a repeated task tool; Add must remain the first working surface. |

## User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |

