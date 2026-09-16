# add-ext-dialog — Tasks

> 规范附录：`plans/design-reference.md` 是实现准绳——API 形态、平台命名空间矩阵、模态
> 架构、embedded 打包与体积门、DTO 序列化法则全部以其为准。

## 1. Alignment

- [ ] 1.1 plan 索引与 design-reference 一致；validate 通过；每个 checkbox 仅由当前工作上下文完成并验证后勾选。

## 2. BDD Contract（批次 A：spec + SDK）

- [ ] 2.1 `@opentray/spec`：Dialog 命令/选项/结果类型（MessageDialogOptions、FilePickOptions、DirectoryPickOptions、SavePickOptions、MessageDialogResult、darwin/win32 命名空间类型、typed 错误码四枚：`dialog_platform_unsupported` / `dialog_platform_namespace_mismatch` / `dialog_invalid_options` / `dialog_capability_unavailable` / `dialog_session_busy`）+ DialogBackendCapabilities DTO；单测（repr 冻结同族）。
- [ ] 2.2 opentray SDK：`NativeExtensionEmbeddedArtifact` kind——相对 facade 包根解析、realpath 校验、artifactSetVersion=facade version、缺目标/不可达 typed 错误与 package kind 同族；单测（多目标/缺目标/不可达/artifactSet 随版本）。
- [ ] 2.3 `scripts/check-pack-size.mjs`：对内嵌二进制包跑 `npm pack --dry-run` 量 tarball 压缩体积，≥2MB 警告、>3MB 失败；脚本自身 fixture 双臂单测。

## 3. Implementation — 批次 B（crates/opentray-ext-dialog）

- [ ] 3.1 macOS：NSAlert（suppression accessory、severity、escape 映射 cancelId）/ NSOpenPanel / NSSavePanel；**modal-session 步进集成进 wint ControlFlow**（禁裸 runModal）；pending response 注册/回帧。
- [ ] 3.2 Windows：TaskDialogIndirect（comctl6 清单声明 + MessageBox 降级路径与 `taskDialog:false` 上报）+ IFileOpenDialog / IFileSaveDialog（STA、FOS 全量选项）；同 pending response 机制。
- [ ] 3.3 并发与清理：每 session 一对话框（busy typed 拒绝在 native 前置）；session close 撤销未决对话框并以 cancel 语义回帧；跨 session 并发共存。
- [ ] 3.4 BackendCapabilities DTO 嵌入与上报；交叉编译门（darwin target 编过 = win32 序列化齐全）。

## 4. Implementation — 批次 C（packages/ext-dialog facade）

- [ ] 4.1 `attachDialog(tray, options?)` → capability（tray.extend 家族同构 attachBadge）；`contract.json`（extensionName "dialog"、fingerprint contract-1）；embedded artifact 描述符。
- [ ] 4.2 TS 类型面（§1 公共 API 全量）+ facade 前置校验（命名空间 mismatch/未知字段/能力前置拒绝——comctl6 不可用时 commandLink → `dialog_capability_unavailable`）；Linux → `dialog_platform_unsupported` 前置。
- [ ] 4.3 vitest 确定性套件：糖语义、强制关闭法则、cancel=null、命名空间校验矩阵、embedded 解析错误矩阵。

## 5. Packaging — 批次 D

- [ ] 5.1 构建管线：crates/opentray-ext-dialog 双平台 staging 到 `platforms/<target>/`（Windows 可执行位按「存在性断言」法则）；package.json `files` 收口。
- [ ] 5.2 CI：check-pack-size 接入（2MB warn / 3MB fail）；首次实测体积数字归档进验证记录（体积门首例锚点）。

## 6. Verification

- [ ] 6.1 双平台原生验收：每方法冒烟；**对话框打开期间 tray 存活证据**（同 app 双 tray + 跨 app 事件照常）；session close 撤销；busy typed；跨 session 并发；suppression 回传；commandLink/expander 真机截证（win）。
- [ ] 6.2 全量门：workspace 测试 + typecheck + 交叉编译 + vision validate；`npm pack --dry-run` 体积证据。
- [ ] 6.3 self-review（md+html）+ check ok:true；（remix：Codex/子代理复核轮，见工作流裁决）。

## 7. Release

- [ ] 7.1 AGENTS.md：Monorepo Law += 包体积门（Owner ruling 2026-09-16，首例 ext-dialog，已在工作树预落）；新章 Dialog Extension Law（从 design-reference §9 提炼）。
- [ ] 7.1b 同步 `.agents/skills/develop-opentray-ext`：Non-Negotiable「Do not ship one fat cross-platform native package」按体积门裁决修订为「≤3MB 内嵌合法，>3MB 必拆」，platform-packages.md 同步；避免子代理读到旧法则与本设计打架。
- [ ] 7.2 skills/opentray 公共消费文档（Documentation Ownership 法则：决策树/场景进 public skill，不进 .agents）；packages/ext-dialog/README。
- [ ] 7.3 changeset（minor）→ 合并 main → version → push → CI 全绿 → npm 上线。
