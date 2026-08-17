# Interview Plan

## Original User Input

Relevant original requirements, preserved verbatim:

> 5. 是的，我们需要加入“非交互模式”，可以使用非交互模式，直接创建生成应用。将我们 webui 提供的能力，都通过 cli 暴露，差别是 cli 不能去嗅探图标、不能嗅探应用名，因此这些都必须手动输入。
> 6. 使用 `npx create-opentray skill` 能进入“帮助中心”中心的功能，这个子命令支持 `list` `read` 等功能。list 可以列出路径的相对文件列表，read 可以直接查看某个文件的内容，比如 `npx create-opentray skill read SKILL.md`
> 7. 使用 `npm:yargs` 来实现主命令和子命令的管理
> 8. 创建的应用需要需要在应用目录留下一个 create-opentray.json 的配置文件，目前配置版本为 v1。
> 10. 需要在导航栏新增一个“应用列表”，扫描 `~/.opentray/create/*` 目录（也就是说这个目录是固定的，不能变，即便是允许修改，那么也必须 symlink 到`~/.opentray/create/` 目录下），将目前的应用列出来。可以编辑应用，直接进入到“新增”页面，但是带上目前的 create-opentray.json 参数，填充到页面中，并且默认开启覆盖模式（`--force`）
> 11. 如果可以，在应用列表中提供卸载功能，不过后续的 macOS-Dock 图标 和 Windows-任务栏图标 的 删除估计得用户自己手动操作了。
> 12. create-opentray 需要做好 Windows 的适配，当前环境不是 Windows，不过你先按照常识去做，包括测试也都写好，到时候我会到 Windows 平台上提供 Agent
> 13. cli 虽然没有 webui 的能力那么全，但是仍然要支持将 http-url 的 image 作为 appIcon / trayIcon 的源来进行输入。
> 14. webui 需要提供“命令导出功能”，将完整的参数都带上，支持直接复制也支持导出脚本文件（支持 shell 或者 powershell），可以选择 `.sh`文件或者`.ps1`文件。
>
> 2. 将 opentray-logo.png 用来更新我们的 README.md
> 3. 将 create-opentray-logo.png  用来更新我们的 create-opentray 的 README.md 和 webui
>
> 3. 你的责任是只撰写 openspec change

Requirement-bearing interview confirmations, preserved verbatim:

> 统一
>
> 我觉得还有一个 cli/webui 的统一内核的工作
>
> 同意，不过提供一个明确的 `npx create-opentray web`（WebUI wizard），未来万一主命令升级了，这个子命令仍然可以稳定
>
> cli的skill不需要多语言，只提供英文就好，确保skill本身的标准（是面向AI而不是人类）。
> webui上的翻译版本是webui自己做针对性提供。
>
> 是可以，但是没必要这样，可以这样做：
> `packages/create/packages/*`

## Pre-Interview Orientation

| Field | Record |
| ----- | ------ |
| Confirmed topic | Public yargs command tree and English AI Skill adapter over the unified create-opentray Core. |
| Interview mother tongue | Chinese; the user conducted and confirmed the architecture interview in Chinese. |
| Thinking language for this interview | Chinese |
| Confirmation source | The user approved the final three-Change summary and explicitly confirmed the CLI hierarchy plus stable `web` command. |

## Q&A Ledger

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | Required non-interactive creation to expose WebUI creation abilities except app-name/icon sniffing, which need explicit CLI input. | CLI must be a complete headless adapter, not a browser-launch flag mode. |
| 2 | User | Required `skill list/read`, yargs, v1 config, fixed app registry, uninstall, Windows preparation, and HTTP URL icon input. | Establishes public commands, parser engine, content access, and cross-platform evidence. |
| 3 | Assistant | Recommended a command tree with root WebUI, `create`, `app list/edit/uninstall`, and `skill list/read`. | Made the public grammar explicit. |
| 4 | User | Agreed and additionally required stable `npx create-opentray web`. | Root no-args remains compatibility behavior; `web` becomes durable explicit entry. |
| 5 | User | Required the AI Skill to be English only and standards-compliant; WebUI translations are separately owned. | CLI must not implement locale negotiation or expose WebUI-localized help content. |
| 6 | User | Required a unified Core and accepted nested packages under `packages/create/packages/*`. | CLI must be a thin nested adapter, not a second business layer or public Core package. |
| 7 | User | Rejected env secret keyword detection and required explicit risk consent whenever env exists. | Non-interactive export needs an explicit acknowledgement flag without printing values. |
| 8 | User | Approved exact argv authority, verified stop-running, external purge protection, immutable appId, and breaking v1-only registry in the Core interview. | CLI flags must expose those decisions without weakening them through prompts or aliases. |
| 9 | User | Approved the final Core -> CLI/WebUI Change graph. | This Change depends on `unify-create-opentray-core`. |

## Evidence Read

| Source (file / change / spec) | Fact | Why it matters |
| ----------------------------- | ---- | -------------- |
| `packages/create/src/bin.ts:29` | The current CLI uses a manual loop over flags and one wizard-oriented positional. | Must be replaced by yargs command ownership, not extended with more conditionals. |
| `packages/create/src/bin.ts:82` | Current help exposes only WebUI server options. | There is no stable non-interactive or app/skill command ontology yet. |
| `packages/create/package.json:16` | The package publishes one `create-opentray` bin and only README/dist files. | The English Skill must be deliberately included in package staging. |
| `packages/create/README.md:1` | Current documentation describes browser wizard and old generated layout. | README must be rewritten for stable web/non-interactive/app/skill modes and new branding. |
| `skills/opentray/SKILL.md` | The repository already keeps installed-package consumer knowledge under public `skills/`. | `skills/create-opentray` should own the AI-facing create product guide, not `.agents/skills`. |
| `openspec/changes/unify-create-opentray-core/specs/create-project-config/spec.md` | Core defines one v1 authority and exact argv vectors. | CLI must compile flags/config into that model rather than invent its own. |
| `openspec/changes/unify-create-opentray-core/specs/create-lifecycle-kernel/spec.md` | Core defines force, list, running-process, uninstall, and purge behavior. | CLI commands are projections over typed Core procedures. |

## User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| 非交互模式 | A command that completes without opening a browser or asking questions. | Deterministic headless CLI procedure. |
| 主命令和子命令 | A durable public command ontology, not ad hoc flag parsing. | yargs command tree. |
| `web` 仍然可以稳定 | The explicit WebUI entry must survive future root-command evolution. | Stable `web` subcommand. |
| skill 是面向 AI | CLI content follows Skill conventions and optimizes for agent consumption. | English AI-facing Skill tree. |
| 手动输入 | CLI requires explicit app identity/icon values instead of scraping them. | No implicit metadata enrichment in non-interactive create. |

## Intent

### Surface Intent

Add a yargs-based public command tree with stable WebUI entry, fully non-interactive creation and application management, English Skill list/read, explicit icon URL support, script export, and Windows-safe behavior.

### Underlying Drive

The current executable is named like a CLI but is structurally a browser launcher. The user wants automation, repeatability, AI consumption, and future command growth without allowing a second CLI-specific application model. Every command must compile into or inspect the same Core desired state and report exact effects.

### Final Visible Effect

`npx create-opentray web` always opens the wizard; no arguments retain that behavior. `create` can build an app without prompts from explicit identity, icons, and argv/config input. `app` can list, update, copy, export, and safely uninstall v1 registrations. `skill` can list and read the packaged English AI Skill by stable relative paths. Windows paths, process controls, and PowerShell output are specified and tested rather than assumed.

### Workflow Fit

This is a dependent `vision2` Change. It SHALL NOT begin Apply before `unify-create-opentray-core` has an implementation-ready artifact commit. The WebUI Change may proceed in parallel after the shared contract is stable.

## Open Questions

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |

## Decisions

| Decision | Confirmed by | Reversible? |
| -------- | ------------ | ----------- |
| Use yargs for root/subcommand ownership. | Original user requirement. | No within this command generation. |
| No args opens WebUI; `web` is the stable explicit WebUI command. | User explicit correction. | Root default may evolve later; `web` remains stable. |
| `create`, `app`, and `skill` are non-interactive. | User requirement and accepted grammar. | Interactive workflows remain under `web`. |
| CLI does not invoke app-name or icon sniffing. | Original user requirement. | Explicit values or config are required. |
| CLI accepts HTTP/Data/file image sources through Core. | Original user requirement plus Core resource decision. | Source types may expand later. |
| CLI Skill is English-only, AI-facing, and standards-compliant. | User explicit correction. | WebUI localizations are separate. |
| CLI lives under `packages/create/packages/*` and consumes private Core. | User topology correction. | Reversible only through a later repository Change. |
| Env-bearing export requires explicit acknowledgement without heuristic classification. | User explicit correction. | No secret detector may be implied. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Add `--non-interactive` to the old root parser. | It mixes browser server flags and deterministic creation, and cannot grow into stable app/skill commands. |
| Make `web` only an undocumented alias. | The user requires it as the future-stable entry. |
| Let CLI scrape missing app name or icons. | The user explicitly limits those enrichments to WebUI. |
| Localize the packaged AI Skill. | The Skill is for AI consumption; WebUI owns targeted human translations. |
| Reimplement config validation or filesystem effects in yargs handlers. | That recreates the CLI/WebUI drift the Core Change exists to remove. |

## User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |

