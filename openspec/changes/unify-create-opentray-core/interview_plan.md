# Interview Plan

## Original User Input

Relevant original requirements, preserved verbatim:

> 5. 是的，我们需要加入“非交互模式”，可以使用非交互模式，直接创建生成应用。将我们 webui 提供的能力，都通过 cli 暴露，差别是 cli 不能去嗅探图标、不能嗅探应用名，因此这些都必须手动输入。
> 8. 创建的应用需要需要在应用目录留下一个 create-opentray.json 的配置文件，目前配置版本为 v1。
> 10. 需要在导航栏新增一个“应用列表”，扫描 `~/.opentray/create/*` 目录（也就是说这个目录是固定的，不能变，即便是允许修改，那么也必须 symlink 到`~/.opentray/create/` 目录下），将目前的应用列出来。可以编辑应用，直接进入到“新增”页面，但是带上目前的 create-opentray.json 参数，填充到页面中，并且默认开启覆盖模式（`--force`）
> 11. 如果可以，在应用列表中提供卸载功能，不过后续的 macOS-Dock 图标 和 Windows-任务栏图标 的 删除估计得用户自己手动操作了。
> 12. create-opentray 需要做好 Windows 的适配，当前环境不是 Windows，不过你先按照常识去做，包括测试也都写好，到时候我会到 Windows 平台上提供 Agent
> 13. cli 虽然没有 webui 的能力那么全，但是仍然要支持将 http-url 的 image 作为 appIcon / trayIcon 的源来进行输入。
> 14. webui 需要提供“命令导出功能”，将完整的参数都带上，支持直接复制也支持导出脚本文件（支持 shell 或者 powershell），可以选择 `.sh`文件或者`.ps1`文件。不过这里有一个难点，如果遇到是用户自己上传的图片，那么导出的时候，只能 默认导出脚本文件，然后将用户上传的图片内容嵌入到这个脚本中。如果非要使用复制粘贴，内容可能会非常长，所以除非用户强制选择“直接复制到剪切板”，这也是有可能的，因为内容可能是 svg，最终体积不会非常大。
> 15. icon 相关的提供一个高级选项：imageSmoothingEnabled，这对于上传的图片是一个低分辨率的非常有用，因为用户很有可能就是在做像素风格的图标。如果禁用imageSmoothingEnabled，那么我们将它等比放大成 appIcon 的前景 和 trayIcon 就可以保护其中的锯齿行为。
> 16. 新增一个选项：允许开发者模式。默认不勾选
>
> 1. 使用 openspec 进行推进，不用非要一个 changes，你可以构建多个 changes，但是要说明它们的依赖关系
> 2. 开始之前有问题请使用 grill-me 这个 skills 和我进行讨论
> 3. 你的责任是只撰写 openspec change

Requirement-bearing interview corrections and confirmations, preserved verbatim:

> create-opentray webui 相关的开发聚合成一个 change 吧。
>
> 我觉得还有一个 cli/webui 的统一内核的工作
>
> 端口发现 是 webui 独有的？其它几个我没意见，因为只要依赖浏览器，所以本身也不可能进入 core
>
> 是，这种问题没有质量，你我都是高级架构师，直接问关键的边界问题
>
> 我在想要不要直接把 用户上传的的图标的 base64 url 直接写到 json 中，这样会更简单，因为我们没有太多其它资源。如果走 create-opentray.json+外置文件，其实也可以，但是我们必须记录绝对路径，但是问题是，我们可能不能记录在 `~/.opentray/create/*/`文件夹下，因为这个文件夹可能是 symlink…… 对了，应该这样设计：
> ```
> ~/.opentray/create/*/
>   - create-opentray.json
>   - app/ # 可以symlink
>   - appIcon.svg|png # 可以被 create-opentray.json 相对引用
>   - .. # 其它一些平级的文件、文件夹
> ```
>
> 我说的这两个方案，你自己决策看看
>
> 我们无法区分敏感值，否则你还得搞一套关键字，这并不合理，一旦出问题用户反而要怪你为什么没有识别到这关键字。
> 因此核心应是“复制或下载包含敏感值的完整命令前，必须明确确认一次。”，如果有配置env，那么需要让用户勾选同意风险的免责声明checkbox
> 在确认env的时候，界面上确实可以提供可写的表单，用户可以在这里直接修改，手动清空或者改成安全模板关键字
>
> 直接破坏性更新就好

## Pre-Interview Orientation

| Field | Record |
| ----- | ------ |
| Confirmed topic | Split create-opentray into one shared headless Core plus CLI and WebUI adapters, with this Change owning the Core contract. |
| Interview mother tongue | Chinese; the user conducted and confirmed the complete architecture interview in Chinese. |
| Thinking language for this interview | Chinese |
| Confirmation source | The user approved the final three-Change dependency summary with `同意`. |

## Q&A Ledger

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | Requested internationalized/themed WebUI, help center, non-interactive CLI parity, persisted v1 configuration, fixed application registry, app editing/uninstall, Windows support, URL icons, command/script export, image smoothing, developer mode, and logo use. | The work crosses data authority, lifecycle, CLI, and UI and cannot remain one wizard-only implementation. |
| 2 | User | Required all create-opentray WebUI work to be aggregated into one Change. | WebUI concerns must not be split across aesthetic, help, registry, or export Changes. |
| 3 | User | Required a unified CLI/WebUI Core. | Shared behavior must become adapter-neutral instead of living in CLI flags or browser forms. |
| 4 | Assistant | Initially proposed keeping port discovery outside Core as WebUI enrichment. | Exposed an incorrect boundary for user review. |
| 5 | User | Challenged whether port discovery is actually WebUI-only. | Port discovery must be treated as a headless capability; adapter exposure and capability ownership are separate questions. |
| 6 | Assistant | Recommended that Core own all headless capabilities while adapters decide what to expose. | Established the shared-kernel boundary. |
| 7 | User | Confirmed. | Core owns command preview, process observation, port/HTTP discovery, scraping, configuration lifecycle, materialization, registry actions, and export planning. |
| 8 | Assistant | Recommended making `create-opentray.json v1` the declarative source of truth, with all runtime files derived through Apply. | Established one editable authority. |
| 9 | User | Confirmed. | `opentray.app.json` cannot remain a second editable authority. |
| 10 | Assistant | Recommended recognizing ownership only from a valid matching v1 registration and rejecting destructive adoption of unknown non-empty directories. | Established the destructive boundary for `--force`. |
| 11 | User | Confirmed. | Force applies only to recognized create-opentray ownership. |
| 12 | Assistant | Recommended deleting direct managed apps on uninstall, unlinking external app targets by default, requiring `--purge-target` for external deletion, and leaving Dock/taskbar pins manual. | Established uninstall semantics. |
| 13 | User | Confirmed and required output to state exactly what was retained or deleted. | Every destructive result needs explicit resolved-path reporting. |
| 14 | User | Proposed a stable registration envelope containing config and source assets, with `app/` allowed to be a link. | Registration metadata and regenerable application output must be physically separated. |
| 15 | Assistant | Chose sibling icon files over Base64-in-JSON, while retaining Data URL as an input/export encoding. | Config remains readable and relocatable; Apply normalizes bytes into managed relative resources. |
| 16 | Assistant | Recommended defining developer mode only as WebView DevTools admission. | Prevented a vague mode from silently enabling unrelated diagnostics or runtime behavior. |
| 17 | User | Confirmed. | `developerMode` maps only to per-window `devtools: true` and defaults false. |
| 18 | Assistant | Recommended immutable `appId`, with identity changes represented as copy/create-new. | Prevented edit from becoming an implicit registry and native-identity migration. |
| 19 | User | Confirmed. | Existing registrations cannot mutate `appId`. |
| 20 | User | Rejected keyword-based secret detection and required an environment-risk acknowledgement plus an editable env review. | Core may detect only whether env entries exist; adapters must not claim to identify secrets. |
| 21 | Assistant | Recommended verified PID plus unique token ownership, typed `app_running`, and explicit stop/restart choices. | Established safe live-process mutation. |
| 22 | User | Confirmed. | Apply/uninstall never kill by name or appId alone. |
| 23 | Assistant | Recommended exact argv vectors as command authority and explicit shell executables for shell semantics. | Established cross-platform command determinism. |
| 24 | User | Confirmed. | Core stores executable/args/cwd/env, never an implicitly interpreted shell command. |
| 25 | Assistant | Recommended explicit migration for old `opentray.app.json` projects. | Raised the release compatibility boundary. |
| 26 | User | Rejected migration and required a direct breaking update. | Core recognizes only the v1 registration model; no legacy scanner or compatibility layer is in scope. |
| 27 | User | Approved the final Core -> CLI/WebUI dependency graph. | The interview is closed and authoring may proceed. |

## Evidence Read

| Source (file / change / spec) | Fact | Why it matters |
| ----------------------------- | ---- | -------------- |
| `packages/create/src/bin.ts:29` | The current bin manually parses one wizard-oriented flag surface. | CLI concerns are mixed into the published package and do not provide a command tree. |
| `packages/create/src/wizard.ts:72` | Wizard form values currently own app identity, icon fields, package manager, force, and shell booleans. | The browser form is acting as an implicit domain model. |
| `packages/create-webui/src/wizard-protocol.ts:12` | WebUI duplicates `WizardFormValues` instead of consuming one contract. | Confirms model drift and the need for one Core contract. |
| `packages/create/src/scaffold.ts:17` | `ScaffoldAppConfig` is a second partial configuration model. | The persisted runtime shape is not sufficient as a create-project source of truth. |
| `packages/create/src/scaffold.ts:53` | Old project ownership is identified by `opentray.app.json` and `main.mjs`. | The approved v1 update intentionally breaks this legacy marker model. |
| `packages/create/src/materialize.ts:155` | Current `--force` recursively clears the selected target directory. | A registration envelope and verified ownership gate are required before destructive replacement. |
| `packages/create/src/port-scan.ts:38` | Listener discovery uses platform tools and no browser API. | Port discovery belongs in Core. |
| `packages/create/src/scrape.ts:59` | Title/favicon extraction is headless HTTP/image processing. | Scraping can remain a Core capability even though CLI policy does not expose it. |
| `packages/ext-webview/src/index.ts:106` | WebView creation already exposes `devtools?: boolean`. | Developer mode should project this existing capability instead of inventing a broader mode. |

## User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| 统一内核 | One adapter-neutral source for all create-opentray behavior. | Headless Core shared by CLI and WebUI server. |
| 端口发现 | Attribute HTTP listeners to the command's process tree. | OS/process observation, not browser discovery. |
| 注册目录 | The fixed discoverable record under `~/.opentray/create/*`. | Stable registration envelope. |
| 可以 symlink | The generated application payload may live elsewhere while remaining registered. | `app/` is a directory or platform-appropriate directory link. |
| 直接破坏性更新 | Do not spend this Change on old generated-project compatibility. | v1-only registry with no legacy migration. |
| 允许开发者模式 | Let generated WebViews admit DevTools when explicitly enabled. | Per-window DevTools capability, default off. |
| 保护用户自己磁盘上的文件 | Uninstall or force must not erase external targets implicitly. | Destructive action requires verified ownership and explicit purge. |

## Intent

### Surface Intent

Create one headless create-opentray Core shared by CLI and WebUI. Persist a v1 configuration, register applications under a fixed home directory, support linked external application payloads, expose deterministic create/update/list/uninstall/export operations, preserve explicit image rendering choices, and behave safely on macOS and Windows.

### Underlying Drive

The existing wizard has become the accidental architecture: browser form types, HTTP event types, CLI parsing, materialization inputs, and generated runtime config each describe overlapping application state. The user wants product channels to become replaceable projections over one declarative model. A WebUI edit, non-interactive CLI invocation, exported script, or future adapter must produce the same plan and the same filesystem result.

### Final Visible Effect

Every v1 app has one stable registration envelope under `~/.opentray/create/`, one readable `create-opentray.json`, stable source icon snapshots, and one `app/` payload that can be rebuilt or linked elsewhere. Core produces typed plans and results for create, update, list, uninstall, command observation, and export. It never silently adopts unknown directories, kills unverifiable processes, deletes external targets, infers shell semantics, guesses secrets, or reads legacy projects.

### Workflow Fit

This is the prerequisite `vision2` Change. `add-create-opentray-cli` and `redesign-create-opentray-webui` depend on it. No product implementation is authorized by this authoring-only turn.

## Open Questions

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |

## Decisions

| Decision | Confirmed by | Reversible? |
| -------- | ------------ | ----------- |
| Core owns every headless capability; adapters own exposure policy. | User answered `是`. | Only through a later architectural Change. |
| `create-opentray.json v1` is the only editable desired-state authority. | User answered `确认`. | No within v1. |
| Registration is fixed under `~/.opentray/create/*`; each record owns config/resources and an `app/` directory or link. | User proposed the layout and delegated the file-vs-Base64 decision. | Layout may evolve only with a new schema version. |
| Uploaded/Data URL/HTTP icon bytes normalize into sibling files referenced relatively. | Assistant decision explicitly delegated by the user. | Reversible only in a future schema. |
| `appId` is immutable after registration. | User answered `同意`. | Identity change creates a new app. |
| Force may replace only a verified managed payload, never adopt an unknown non-empty directory. | User answered `确认`. | No without weakening disk safety. |
| External target deletion requires explicit purge; normal uninstall unlinks it. | User answered `同意`. | No without weakening disk safety. |
| Running-app mutation requires verified PID+token ownership and explicit stop authorization. | User answered `同意`. | No without weakening process safety. |
| Commands persist as exact argv vectors; shell behavior is explicit in the vector. | User answered `同意`. | No within v1. |
| Developer mode means WebView DevTools admission only and defaults false. | User answered `同意`. | The name can expand only in a future schema. |
| Env values are never heuristically classified; presence of env sets a risk flag for adapter acknowledgement. | User correction. | No heuristic may be added without a later explicit decision. |
| Legacy `opentray.app.json` projects are not discovered or migrated. | User required `直接破坏性更新`. | Intentionally breaking. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Keep Core inside the old wizard session. | CLI and WebUI would continue to own separate input and result semantics. |
| Treat port discovery as WebUI-only. | It is a headless process/OS capability and is already implemented without browser APIs. |
| Put uploaded image Base64 directly in config. | It bloats the authority file and couples binary lifetime to JSON while a stable registration envelope already solves relative addressing. |
| Make the registration root itself a relocatable symlink. | Config and source-resource authority must remain fixed; only the regenerable `app/` payload is relocatable. |
| Infer secrets from env names or values. | False negatives would create a misleading security claim; any non-empty env receives the same explicit risk treatment. |
| Migrate legacy generated projects. | The user chose a direct breaking update. |

## User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |

