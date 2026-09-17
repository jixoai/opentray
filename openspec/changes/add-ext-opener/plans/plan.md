# add-ext-opener — Intent Document (SSOT)

> 原始需求（Owner，2026-09-18）：
> 1. 「继续持续迭代…直到 notification/clipboard/opener 等工作全部完成。」
> 2. 「确保同步更新 skills 文档…其它 AI 能通过文档写出正确的代码。」
>
> 用户语言系统：**「能力原子」「默认应用打开」「其它 AI 能通过文档写出正确的代码」**。
> 关联 change：`add-ext-dialog` / `add-ext-sound`（同族已归档——embedded artifact kind、
> pack-size 审计、V2 Immediate 命令 ABI、typed 错误码 details 对象、Linux typed
> unsupported 等共享基建**直接复用，无依赖门**）；同波 sibling：`add-ext-notification`、
> `add-ext-clipboard`。
> 评审记录：design draft（`plans/design-reference.md` 为规范附录，实现以它为准）；
> **Codex 评审 pending**——对抗点为 O1（scheme 白名单宽严），裁决回写前 scheme 门不冻结。

## 最终可见效果（operator 视角）

- `pnpm add @opentray/ext-opener` 一个包即得：`open(target)`（URL 或绝对文件路径以用户默认应用打开）与 `revealInFolder(path)`（文件管理器中定位，非打开）。
- preflight 冻结矩阵：绝对路径（存在性非受理前提）→ 原生打开；可解析有协议 URL → 原生打开（scheme 白名单 `http/https/file/mailto`，大小写不敏感）；其余 → typed `opener_target_invalid`。
- 非白名单 scheme（`ssh:`/`chrome://`/自定义处理器）→ typed `opener_scheme_blocked`（details 含 scheme）；路径含引号字符 → typed `opener_target_invalid`（reason: path-quote）——冻结拒绝而非转义。
- `open`/`revealInFolder` 为 resolve-on-acceptance（同族）：原生调用受理成功即 resolve；目标应用何时/是否呈现不属于受理语义。
- 内嵌四目标二进制单包发布（复用 embedded artifact kind），薄逻辑库远低于 2MB 警告线。
- Linux 调用得到 typed `opener_platform_unsupported`，不触碰 broker。
- skills/opentray 公共文档随包同步交付：其它 AI 仅凭文档（安装 / API 面 / 错误码 / 平台降级 / 最小可运行示例）能写出正确的 opener 消费代码。

## 调研事实（API 层面，实现批核验补锚点）

- darwin：`NSWorkspace.open(URL(fileURLWithPath:))` / `NSWorkspace.open(url)` 是默认应用打开标准面；`NSWorkspace.activateFileViewerSelecting([url])` 是 Finder 定位面；均经 owner 线程。
- win32：`ShellExecuteW("open", ...)` 打开 URL/文件/Explorer；`explorer.exe /select,<path>` 定位——经 `ShellExecuteW("open", "explorer", params)`，参数经完整路径传参不拼接 shell 元字符；`ShellExecuteW` 不要求显式 CoInitialize 调用方补偿（若实测要求则跟随现有 STA 初始化纪律）。
- 安全面：host 侧 API 无页面同源约束；自定义 scheme 处理器注册表可被滥用为持久化驻留向量（白名单 = 最小惊讶面）；`explorer /select` 参数注入面——`/select,` 前缀与路径间不得存在用户可控空隙，路径以引号包裹单参数传递。
- 与 dialog/sound 同族：`tray.extend` 家族、session-scoped、单会话运行时；打开命令非模态（V2 Immediate ABI 直达，无 DeferredOperation 需求）。

## 决策（D1–D6；细节以 design-reference.md 为准）

| # | 决策 | 依据 |
|---|------|------|
| D1 | 包 `@opentray/ext-opener`，crate `crates/opentray-ext-opener`，embedded 单包内嵌四目标（复用 dialog/sound 归档基建，不重复建设，**无依赖门**）；contract fingerprint `opentray-ext-opener-contract-1` | 同族框架已归档落地；体积规范（2026-09-16） |
| D2 | 能力面 = `open(target)` + `revealInFolder(path)` + `getBackend()` 异步冻结快照；resolve-on-acceptance 同族律 | design §1 |
| D3 | 目标解析 preflight 冻结 = ① 绝对文件路径（存在性不作受理前提；不可读/不可 stat 的路径参数仍透传原生，原生拒绝 → typed `opener_failed`）→ `NSWorkspace.open(URL(fileURLWithPath:))` / `ShellExecuteW("open", path)`；② URL（`new URL()` 可解析且有协议）→ `NSWorkspace.open(url)` / `ShellExecuteW("open", url)`；③ 其余（相对路径、无协议字符串）→ typed `opener_target_invalid`（details: {reason}） | design §2 冻结 |
| D4 | scheme 白名单 v1 冻结 = `http/https/file/mailto`（scheme 大小写不敏感，`HTTPS://` 通过）；其余 → typed `opener_scheme_blocked`（details 含 scheme）——最小惊讶面（host 侧无同源约束；自定义处理器注册表滥用向量）；**宽严裁决见开放问题 O1（Codex-pending）** | design §2 安全裁决 |
| D5 | revealInFolder = 路径必须绝对（相对 → typed `opener_target_invalid`）；darwin `NSWorkspace.activateFileViewerSelecting([url])`；win32 `explorer.exe /select,<path>` 经 `ShellExecuteW("open", "explorer", params)` 引号单参数传递；**路径含引号字符 → typed `opener_target_invalid`（reason: path-quote）——冻结拒绝而非转义**（转义矩阵是持续性攻击面） | design §2/§4 冻结 |
| D6 | 流程：单 change，批次 A（spec 类型）→ B（crate 双平台）→ C（facade）→ D（staging + 体积门）→ E（验收 + 文档 + changeset） | sound 同款编排 |

## 开放问题（Codex 对抗中——裁决回写前不冻结）

| 问题 | 状态 |
|------|------|
| O1 scheme 白名单宽严 | v1 冻结候选 = 四 scheme 白名单（`http/https/file/mailto`）——最小惊讶面；若 Codex 裁定过严 → 放宽为「拒绝可执行类 scheme（`file` 除外）+ 透传其余」。裁决回写本表与 spec 后 scheme 门才冻结。**Codex-pending** |

## 拒绝路径

| 路径 | 拒绝原因 |
|------|----------|
| 应用选择器（OpenWithDialog） | 超出「默认应用打开」原子范围（design §0 不做清单） |
| 默认应用查询/设置、深链返回值 | 系统 preference 面，非打开原子 |
| 拖放 | 超出打开原子范围 |
| Linux 原生 | typed `opener_platform_unsupported`（与 dialog/sound 同律） |
| 路径引号转义 | 冻结拒绝而非转义——转义矩阵是持续性攻击面（design §4） |

## 实施计划（specs/tasks 追溯）

1. 批次 A：`@opentray/spec` opener 类型（OpenerCapability 面、OpenerBackendCapabilities、typed 错误码四枚 details 判别联合）——embedded artifact kind 与 pack-size 审计**直接复用 dialog/sound 归档基建，无依赖门**。
2. 批次 B：crates/opentray-ext-opener——darwin（NSWorkspace open/reveal，owner 线程，seam）+ win32（ShellExecuteW 投影、explorer /select 引号传参、scheme 大小写不敏感匹配）。
3. 批次 C：packages/ext-opener facade（attachOpener、preflight 解析矩阵 + scheme 门（按 O1 裁决冻结）、contract.json、embedded 描述符）。
4. 批次 D：staging 到 `platforms/<target>/` + pack-size 接入 + 真实体积实测。
5. 批次 E：双平台真机验证（open(https URL) 默认浏览器受理、open(绝对文件) 默认应用受理、revealInFolder 定位人工/截图取证、blocked scheme typed 断言）+ skills 公共文档（一等任务，见 tasks 7.2）+ changeset（minor）。
