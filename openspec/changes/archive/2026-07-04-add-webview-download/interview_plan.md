# Interview Plan

## Pre-Interview Orientation

| Field | Record |
| ----- | ------ |
| Confirmed topic | `@opentray/ext-webview` 文件下载能力（`<a download>`、blob URL、可下载 MIME 类型落到本地 Downloads 文件夹） |
| Interview mother tongue | 中文（简体） |
| Thinking language for this interview | 中文 |
| Confirmation source | 用户全程用中文提问与回答；母语信号强且持续 |

## Original User Input

> 我们的 ext-webview 是否支持 Download？我的意思是 webiew 是否支持 a 标签的download 属性来下载文件到本地 Downloads 文件夹？
>
> ```ts
> function download(): void {
>   if (!exportResult) return;
>   const blob = new Blob([exportResult], { type: 'application/json' });
>   const url = URL.createObjectURL(blob);
>   const a = document.createElement('a');
>   a.href = url;
>   a.download = 'pnpm-pub-backup.json';
>   a.click();
>   URL.revokeObjectURL(url);
> }
> ```
>
> 我目前测试好像不能工作，这个需要如何做适配？

> 你来负责编写 change，按照流程开始

> 等一下，我希望改一下，不要使用 vision-driven 来管理这个change，先删掉。然后到 /Users/kzf/Dev/GitHub/jixoai-labs/agenter 这里复制 vision2-driven 这套新的标准。然后重新创建

## Q&A Ledger

访谈遵守 vision2 规则：一次一个问题，先给出推荐答案与推理；代码库能回答的不问用户。

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1    | User    | 提出 `<a download>` + blob URL 下载到 Downloads 不工作，问如何适配 | 确立 surface intent：HTML 标准下载语义在 webview 内可用 |
| 2    | Agent   | 调研后定位根因：wry 未装 download handler，macOS WKWebView 把 `<a download>` 触发的导航直接 `Cancel` | 把"不能工作"从神秘现象变成可定位的 native 缺口 |
| 3    | User    | 选择**全量范围**：下载 + saveAs + 进度 | intent 显著扩大：不只是 wire up wry 默认行为，要新增 page API、native save panel、进度事件 |
| 4    | User    | 默认行为：**静默落盘 ~/Downloads**，saveAs 作为 opt-in | 保护原始 JS 用例零配置跑通；saveAs 走显式开关 |
| 5    | User    | **接通 multipleDownloads 权限闸门** | 把 native 解析器里已存在但被忽略的 permission policy 接进下载 handler，清掉死代码 |
| 6    | User    | macOS saveAs：**在 wry started handler 内自起 NSSavePanel** | 不依赖 wry 内部默认；Windows 走 WebView2 原生 Save As |
| 7    | User    | 进度事件：**复用 `navigator.opentrayWindow` 总线**，事件集 started/progress/completed/failed | 不新建独立 namespace，与现有 windowstatechange/stylechange 模式一致；后续 turn 13 把取消语义扩成第 5 个事件 `downloadcanceled` |
| 8    | User    | macOS progress：**给 WKDownload 加 KVO observer 拿可靠进度** | 接受额外 native 工程量换取跨平台进度体验一致；不选"macOS 不发 progress" |
| 9    | User    | Linux：**unsupported by design**，跟随 webview 扩展整体立场 | 不为本 change 单独开 Linux 口子；spec 必须显式记录 |
| 10   | User    | 配置入口：**`show({ download: {...} })` 顶级选项** | 与 style/windowControlsOverlay/nativeWindowApi 同级；不污染 nativeApiPolicy |
| 11   | User    | 事件命名：**无前缀** `downloadstarted/downloadprogress/downloadcompleted/downloadfailed/downloadcanceled` | 与现有 moved/resized/closed 等无前缀事件对齐 |
| 12   | User    | completed 事件：**跨平台统一不报 path**，只报 `{ url, filename, success }` | 诚实处理 macOS WKWebView 不回最终路径的 API 限制，避免跨平台类型分裂 |
| 13   | User    | saveAs 取消语义：**单独发 `downloadcanceled` 事件**（第 5 个事件），不混进 failed | 取消是用户主动行为，与失败区分；事件集从 4 扩为 5 |
| 14   | User    | `show({ download })` 省略默认 = `enabled: true, saveAs: false` | 原始 JS 用例零配置跑通；远程由 permission 默认 deny 拦截 |
| 15   | User    | multipleDownloads prompt 复用 `darwin-runtime-carrier-and-webview-permissions` change 的 native prompt 流程 | 不在本 change 重造 prompt UI |
| 16   | User    | 加 `example:download` 示例脚本 | human-visible 证明面，与 example:webview-control 模式一致 |

## Evidence Read

| Source (file / change / spec) | Fact | Why it matters |
| ----------------------------- | ---- | -------------- |
| `crates/opentray-ext-webview/src/macos/mod.rs:654-686` | macOS `WebViewBuilder` 链：`with_initialization_script` + `with_ipc_handler` + `with_document_title_changed_handler` + `with_on_page_load_handler` + `with_transparent(true)`，**无任何 download handler** | 当前 macOS 完全没装下载钩子的安装点 |
| `crates/opentray-ext-webview/src/windows/mod.rs:1496-1530` | Windows `WebViewBuilder` 链同上，加 `with_clipboard(true)` + `with_bounds`，**无 download handler** | Windows 侧同样缺失；WebView2 默认下载 UI 在 OpenTray 自有窗口里不可预期 |
| `crates/opentray-ext-webview/src/lib.rs:159-173` | `WebviewBrowserPermissionFamily` 枚举含 `MultipleDownloads`（line 171） | family 已定义 |
| `crates/opentray-ext-webview/src/lib.rs:1178-1182` | `parse_browser_permission_policy` 把 `multiple_downloads` push 进 rules | policy 已被解析 |
| `crates/opentray-ext-webview/src/lib.rs:245, 257` | 解析后的 `browser_permission_policy` 存进 `WebviewShowSettings` 与 bootstrap settings | 已通过 session 携带，但平台层未消费 |
| grep `browser_permission_policy` in `src/macos/` & `src/windows/` | **无任何引用** | 证实这是死代码：解析了但两个平台 builder 都没读 |
| `packages/ext-webview/src/permission-store.ts:5-18` | TS facade 的 `webviewBrowserPermissionFamilies` 数组含 `"multipleDownloads"` | durable store 已为它准备持久化 |
| `packages/ext-webview/src/permission-store.ts:29-41` | decision 类型：`allow/deny/allowOnce/prompt/unsupported` | prompt 走 native permission 流程已有类型基础 |
| `wry-0.55.1/src/lib.rs:1267-1302` | `with_download_started_handler(FnMut(String, &mut PathBuf) -> bool)` + `with_download_completed_handler(Fn(String, Option<PathBuf>, bool))` | wry 原生提供钩子，签名清晰 |
| `wry-0.55.1/src/lib.rs:1270-1274` 注释 | "By default a handler that allows all downloads is set to match browser behavior." | 默认只在 page 能触发且 handler 存在时生效 |
| `wry-0.55.1/src/wkwebview/navigation.rs:50-83` | `navigation_policy`：`action.shouldPerformDownload()` 为 true 时，**有 handler 才路由到 `Download`，否则 `Cancel`** | 这是用户报告"不能工作"的精确根因 |
| `wry-0.55.1/src/wkwebview/download.rs:46-91` | `download_policy` 默认写 `dirs::download_dir()`（~/Downloads），文件名冲突自动加 `" ({n})"`，**不弹 NSSavePanel** | 默认静默落盘行为已就绪；saveAs 必须自起 panel |
| `wry-0.55.1/src/wkwebview/download.rs:93-122` | `download_did_finish` / `download_did_fail`：**completed handler 第二参数永远传 `None`** | 证实 macOS completed 事件拿不到最终路径（API 限制） |
| `wry-0.55.1/src/wkwebview/class/wry_download_delegate.rs` & `wry_navigation_delegate.rs` | delegate 只实现 finish/fail，**无 WKDownload `progress` 属性的 KVO observer** | macOS 要拿可靠 progress 必须自己加 KVO |
| `openspec/specs/webview-extension/spec.md` | 全文 grep `download` 无结果 | webview-extension spec 是真正的能力空白，本 change 需新增法律段 |
| `darwin-runtime-carrier-and-webview-permissions` change（active） | 已定义 browser permission family、source/origin policy、native prompt、allow-once、remote 注入闸门 | 下载 permission 复用既有 family 法律，不另立模型 |

## User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| 下载到本地 Downloads 文件夹 | 用户期望的默认落点 = OS 标准 Downloads 目录 | macOS `~/Downloads`，Windows `%USERPROFILE%\Downloads` |
| 不能工作 | 点击 `<a download>` 后无任何反应 | wry 静默 cancel 了 download-triggered 导航 |
| 适配 | 给 native 层加必要钩子让标准下载语义生效 | 安装 wry download handler + 配套 page API |
| 全量 | 不只打通语义，还要 saveAs + 进度 | 范围比最小可用大 |
| 静默落盘 | 不弹对话框直接写文件 | wry `download_policy` 默认行为 |

## Intent

### Surface Intent

让 `@opentray/ext-webview` 内的页面用标准 HTML 下载语义（`<a download="filename">` + `Blob` URL，或可下载 MIME 类型的响应）能把文件保存到本地 Downloads 文件夹，并支持 saveAs 与进度事件。

### Underlying Drive

OpenTray 的 webview 一直定位为"轻量工具的系统级入口"，但目前连"导出一份 JSON 备份"这种最基础的桌面能力都做不到。这不是缺一个 UI，而是 native runtime 漏装了一整类能力钩子——wry 早就提供了 download handler API，extension 却从未接通，导致 macOS 上 `<a download>` 触发的导航被静默丢弃。同时 `multipleDownloads` 权限 family 在 TS 和 native 解析层都已完整存在，唯独平台 builder 没读它，形成一道隐性安全缺口（远程内容可触发下载却无人拦截）。这个 change 的深层压力是：**把 webview 从"只能显示"升级为"能完成桌面级输出"**，并顺手清掉死代码让 permission 法律真正闭环。

### Final Visible Effect

操作者会看到：

1. 在 webview 页面里点击 `<a download="x.json">`，文件**真的**出现在 `~/Downloads/x.json`（重名自动加 `(1)` `(2)`）。
2. 页面 JS 能通过 `navigator.opentrayWindow.listen("downloadstarted"|"downloadprogress"|"downloadcompleted"|"downloadfailed", ...)` 画出下载进度 UI，且 macOS 上 progress 也是可靠的（KVO）。
3. 调用方 `show({ download: { saveAs: true } })` 后，每次下载先弹 native save panel（macOS NSSavePanel / Windows Save As），用户选定位置后再落盘。
4. 远程页面默认**不能**下载；本地页面默认允许；`multipleDownloads` policy 的 `allow/deny/prompt` 真正生效。
5. Linux 上调用方拿到 typed unsupported 错误，而不是假成功。

外部证明面：repo maintainer 用 `example:webview-control` 或新增的下载示例点 `<a download>` 能看到文件落盘 + 事件触发。

### Workflow Fit

这是新 `vision2` change。原 change 曾用 vision-driven 创建后被用户明确要求删除并改用 vision2。比对后发现 opentray 的 `openspec/schemas/vision2/` 本就已是比 agenter 更新的版本（Pre-Interview Orientation 段已存在），无需同步；`openspec/config.yaml` 顶层已是 `schema: vision2`。

## Open Questions

访谈阶段已确认 16 个决策（见 Q&A Ledger）。所有写 spec 前需要的小问题已在 Q&A turn 13–16 中确认。下列问题保留为 spec 实现期间的细化点，不影响 spec 法律定型。

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| `downloadcanceled` 事件的 payload 形态？ | 是否只带 `{ url, filename }` 即可，还是要带 saveAs 对话框信息 | 推断：`{ url, filename }`，与 started 对称 |
| `downloadprogress` 事件 payload 用百分比还是字节？ | 跨平台一致性问题 | 推断：`{ url, filename, receivedBytes, totalBytes }`，百分比由页面算 |

## Decisions

已确认的决策（与 Open Questions 分开，不让推断硬化为事实）。

| Decision | Confirmed by | Reversible? |
| -------- | ------------ | ----------- |
| 范围 = 全量（下载 + saveAs + 进度） | 用户 Q&A turn 3 | 是（可降级为最小可用） |
| 默认静默落盘 ~/Downloads，saveAs opt-in | 用户 Q&A turn 4 | 是 |
| 接通 multipleDownloads 权限闸门 | 用户 Q&A turn 5 | 是（但会留死代码） |
| macOS saveAs = wry started handler 内自起 NSSavePanel | 用户 Q&A turn 6 | 是（可换 rfd 等跨平台 crate） |
| 进度事件 = 5 事件（started/progress/completed/failed/canceled）复用 opentrayWindow 总线 | 用户 Q&A turn 7 + turn 13 | 是（可改子对象） |
| macOS progress = 给 WKDownload 加 KVO observer | 用户 Q&A turn 8 | 是（可退化为不发 progress） |
| Linux unsupported by design | 用户 Q&A turn 9 | 否（跟随 webview 扩展整体法律） |
| 配置入口 = `show({ download: {...} })` 顶级选项 | 用户 Q&A turn 10 | 是（API 形态） |
| 事件命名 = 无前缀 `downloadstarted` 等 | 用户 Q&A turn 11 | 是（命名） |
| completed 事件跨平台统一不报 path | 用户 Q&A turn 12 | 否（macOS API 限制） |
| saveAs 取消发独立 `downloadcanceled` 事件（不混进 failed） | 用户 Q&A turn 13 | 是（可改回 failed+reason） |
| `show({ download })` 省略默认 = `enabled: true, saveAs: false` | 用户 Q&A turn 14 | 是 |
| multipleDownloads prompt 复用 darwin-runtime-carrier 的 native prompt 流程 | 用户 Q&A turn 15 | 否（依赖那个 change 的法律） |
| 加 `example:download` 示例脚本 | 用户 Q&A turn 16 | 是 |
| 用 vision2 而非 vision-driven | 用户原始指令 | 否 |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| 让 wry 用默认行为，不在 started handler 里加 saveAs | 与"全量范围"决策冲突；wry 默认不弹 save panel |
| 散把 saveAs 塞进 nativeApiPolicy 或 style | 概念混合：nativeApiPolicy 是 per-origin 能力闸门，style 是窗口外观；下载语义应独立成 `download` 选项 |
| 新建 `navigator.opentrayDownload` 独立 namespace | 重复造轮子，与现有 opentrayWindow 事件总线模式不一致 |
| macOS 不发 progress 只发 started/completed/failed | 跨平台体验不一致；用户选择加 KVO 换取一致 |
| Linux 在本 change 开支持口子 | 破坏 webview 扩展整体 Linux 立场 |
| 继续用 vision-driven 管理 change | 用户明确要求删除并改用 vision2 |

## User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| spec 法律定稿前 review | 影响 native 实现与 TS facade 的契约 | spec 写完后提交给用户 review |
| macOS NSSavePanel 与 darwin-runtime-carrier change 的 prompt 流程是否存在运行时冲突 | 两个 change 都在 active 阶段，可能同时改 macOS native | 实现期检查；冲突时以 darwin-runtime-carrier 的 carrier 法律为准 |
