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
> **Codex R1 已裁并回写冻结**（commit 6e84d41a，根边界终稿 93380cdc）——O1 裁：严格白名单
> （`http/https/file/mailto`；放宽方向是未来的兼容性增量）；裁决全文见 design-reference §2/§4，
> 开放问题已清零。

## 最终可见效果（operator 视角）

- `pnpm add @opentray/ext-opener` 一个包即得：`open(target)`（URL 或绝对文件路径以用户默认应用打开）与 `revealInFolder(path)`（文件管理器中定位，非打开）。
- preflight 冻结矩阵：绝对路径（存在性非受理前提；win32 `C:\x` 绝对、`C:x` drive-relative 拒绝、UNC 合法、`\\?\` 字面前传不规范化）→ 原生打开；可解析有协议 URL → 原生打开（scheme 白名单 `http/https/file/mailto`，大小写不敏感；`file:` URL 原样传原生，不做 URL→路径规范化）；其余 → typed `opener_target_invalid`。
- 非白名单 scheme（`ssh:`/`chrome://`/自定义处理器）→ typed `opener_scheme_blocked`（details 含 scheme）——**O1 已裁：严格白名单冻结，放宽方向是未来的兼容性增量**；revealInFolder 路径含引号/NUL/任一 C0 控制字符（0x00–0x1F）→ typed `opener_target_invalid`（reason: path-quote / path-control-char）——冻结拒绝而非转义；win32 受理语义冻结：`ShellExecuteW` 返回 > 32 = 受理，≤ 32 → typed `opener_failed`（details 含 shellExecuteResult 与 SE_ERR_* reason）。
- `open`/`revealInFolder` 为 resolve-on-acceptance（同族）：原生调用受理成功即 resolve；目标应用何时/是否呈现不属于受理语义。
- 内嵌四目标二进制单包发布（复用 embedded artifact kind），薄逻辑库远低于 2MB 警告线。
- Linux 调用得到 typed `opener_platform_unsupported`，不触碰 broker。
- skills/opentray 公共文档随包同步交付：其它 AI 仅凭文档（安装 / API 面 / 错误码 / 平台降级 / 最小可运行示例）能写出正确的 opener 消费代码。

## 调研事实（API 层面，实现批核验补锚点）

- darwin：`NSWorkspace.open(URL(fileURLWithPath:))` / `NSWorkspace.open(url)` 是默认应用打开标准面；`NSWorkspace.activateFileViewerSelecting([url])` 是 Finder 定位面；均经 owner 线程。
- win32：`ShellExecuteW("open", ...)` 打开 URL/文件/Explorer；`explorer.exe /select,<path>` 定位——经 `ShellExecuteW("open", "explorer", params)`，参数经完整路径传参不拼接 shell 元字符；COM 前提冻结为进程级初始化纪律：owner 线程在 broker 启动时已完成 apartment 初始化（winit/事件泵既有纪律），扩展命令路径不做任何 CoInitialize/CoUninitialize 补偿——若实测发现例外，属实现期 P0 回写设计契约，而非现场补偿。
- 安全面：host 侧 API 无页面同源约束；自定义 scheme 处理器注册表可被滥用为持久化驻留向量（白名单 = 最小惊讶面）；`explorer /select` 参数注入面——`/select,` 前缀与路径间不得存在用户可控空隙，路径以引号包裹单参数传递。
- 与 dialog/sound 同族：`tray.extend` 家族、session-scoped、单会话运行时；打开命令非模态（V2 Immediate ABI 直达，无 DeferredOperation 需求）。

## 决策（D1–D6；细节以 design-reference.md 为准）

| # | 决策 | 依据 |
|---|------|------|
| D1 | 包 `@opentray/ext-opener`，crate `crates/opentray-ext-opener`，embedded 单包内嵌四目标（复用 dialog/sound 归档基建，不重复建设，**无依赖门**）；contract fingerprint `opentray-ext-opener-contract-1` | 同族框架已归档落地；体积规范（2026-09-16） |
| D2 | 能力面 = `open(target)` + `revealInFolder(path)` + `getBackend()` 异步冻结快照；resolve-on-acceptance 同族律 | design §1 |
| D3 | 目标解析 preflight 冻结 = ① 绝对文件路径（POSIX `/` 起；win32 `[A-Za-z]:[\\/]` 形态绝对，`C:x` 无分隔符 = drive-relative → typed 拒绝 reason:"drive-relative"，UNC `\\server\share\…` 合法绝对路径，`\\?\` 前缀字面传原生不规范化——规范化是调用方职责；存在性不作受理前提；不可读/不可 stat 的路径参数仍透传原生，原生拒绝 → typed `opener_failed`）→ `NSWorkspace.open(URL(fileURLWithPath:))` / `ShellExecuteW("open", path)`；② URL（`new URL()` 可解析且有协议）→ `NSWorkspace.open(url)` / `ShellExecuteW("open", url)`；`file:` URL 原样传原生，不做 URL→路径规范化（需要路径语义的调用方应直接传绝对路径）；③ 其余（相对路径、无协议字符串）→ typed `opener_target_invalid`（details: {reason}）；win32 受理语义冻结：`ShellExecuteW` > 32 = 受理，≤ 32 → typed `opener_failed`（details: {shellExecuteResult} + SE_ERR_* reason 如 noassoc/filenotfound/accessdenied） | design §2 冻结 |
| D4 | scheme 白名单 v1 冻结 = `http/https/file/mailto`（scheme 大小写不敏感，`HTTPS://` 通过）；其余 → typed `opener_scheme_blocked`（details 含 scheme）——最小惊讶面（host 侧无同源约束；自定义处理器注册表滥用向量）；**O1 已裁：严格白名单冻结（Codex R1）——放宽方向是未来的兼容性增量（经显式 spec 变更落地，非运行时静默放宽），收紧会破坏既有调用** | design §2 安全裁决（R1 冻结） |
| D5 | revealInFolder = 路径必须绝对（相对/drive-relative → typed `opener_target_invalid`）；拒绝集合冻结 = 路径含 `"` 引号、NUL、或任一 C0 控制字符（0x00–0x1F）→ typed `opener_target_invalid`（reason: path-quote / path-control-char）——冻结拒绝而非转义（转义矩阵是持续性攻击面）；尾随分隔符裁剪律（含根路径边界，冻结）= 仅当裁剪后仍是合法绝对路径才裁一个尾随分隔符（`C:\foo\`→`C:\foo`、`/foo/`→`/foo`），根路径（`C:\`、`/`、UNC 根 `\\server\share\`）不裁剪——裁剪会漂移为 drive-relative（`C:`）或空串，根路径 reveal 语义 = 打开该根（win32 `explorer <root>` 不带 `/select`；darwin `activateFileViewerSelecting([根URL])` 按平台原生根语义）；UNC 非根路径合法；darwin `NSWorkspace.activateFileViewerSelecting([url])`；win32 `explorer.exe /select,<path>` 经 `ShellExecuteW("open", "explorer", params)` 引号单参数传递，`/select,` 前缀与路径间无用户可控空隙 | design §2/§4 冻结（R1 补根边界） |
| D6 | 流程：单 change，批次 A（spec 类型）→ B（crate 双平台）→ C（facade）→ D（staging + 体积门）→ E（验收 + 文档 + changeset） | sound 同款编排 |

## 开放问题（无——Codex R1 裁决已回写冻结）

| 问题 | 状态 |
|------|------|
| O1 scheme 白名单宽严 | **已裁：严格白名单（冻结）**——v1 = 四 scheme 白名单（`http/https/file/mailto`，大小写不敏感）；理由：host 侧输入可能来自外部数据、自定义处理器注册表有持久化驻留与意外副作用面、严格列表最小惊讶；**放宽方向是未来的兼容性增量**（经显式 spec 变更写入本表与 requirement，非运行时静默放宽）；收紧会破坏既有调用，v1 从严 |

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
3. 批次 C：packages/ext-opener facade（attachOpener、preflight 解析矩阵 + scheme 门（O1 已裁冻结：严格白名单四 scheme）+ reveal 拒绝集合与尾随分隔符/根边界裁剪律、contract.json、embedded 描述符）。
4. 批次 D：staging 到 `platforms/<target>/` + pack-size 接入 + 真实体积实测。
5. 批次 E：双平台真机验证（open(https URL) 默认浏览器受理、open(绝对文件) 默认应用受理、revealInFolder 定位人工/截图取证、blocked scheme typed 断言）+ skills 公共文档（一等任务，见 tasks 7.2）+ changeset（minor）。
