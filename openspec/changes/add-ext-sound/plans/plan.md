# add-ext-sound — Intent Document (SSOT)

> 原始需求（Owner，2026-09-17）：
> 1. 「关于 beep，新增 @opentray/ext-sound 这个包，提供 playSystemSound(name or platform-name)、beep(BeepKind)。playSound(path) 这个看情况提供，我们优先保持轻量，如果平台能低成本提供，那就做，如果只有部分平台能低成本提供，那就做成部分平台特供接口。」
> 2. 「后续就和 Codex 去讨论。除非有重大决策项需要我参与就停下来问我，否则以 Codex 的决策为准。如果可以就持续推进，直到全部开发和测试全部完成。」
>
> 用户语言系统：**「优先保持轻量」「能力原子」「以 Codex 的决策为准」**。
> 关联 change：`add-ext-dialog`（同波开发；其批次 A 交付的 embedded artifact kind 与
> pack-size 审计是本 change 直接复用的共享基建；beep 从 dialog 移出的裁决记录在该 change）。

## 最终可见效果（operator 视角）

- `pnpm add @opentray/ext-sound` 一个包即得：`beep(kind)`（win32 五级 MessageBeep；darwin NSBeep 文档化降级）、`playSystemSound(name)`（通用名表 + 平台原生音名直通）、`playSound(path)`（双平台低成本结论成立 → 通用 API，win32 WAV-only typed 拒绝非 WAV）。
- 内嵌四目标二进制单包发布（复用 embedded artifact kind），压缩体积远低于 2MB 警告线。
- 声音播放为 fire-and-forget（播放**开始**即 resolve，无完成事件）；session close 停止该 session 启动的播放。
- Linux 调用得到 typed `sound_platform_unsupported`，不触碰 broker。

## 调研事实（API 层面，实现批核验补锚点）

- win32：`MessageBeep` 五级（OK/ICONASTERISK/ICONEXCLAMATION/ICONHAND/ICONQUESTION，winmm/user32）；`PlaySound(SND_FILENAME|SND_ASYNC)` 仅 WAV、**进程级单声道**（后一次调用取消前一次）；压缩格式需 Media Foundation（重依赖，违反轻量）。系统事件音走 `SND_ALIAS`（注册表声音方案名 SystemHand/SystemExclamation/SystemAsterisk 等）。
- darwin：`NSBeep()` 单一系统 alert 音；`NSSound(named:)` 命名系统音目录（Basso/Sosumi/Glass/Pop…）+ `NSSound(contentsOfFile:)` 播放文件（wav/aiff/mp3/m4a 等 CoreAudio 格式），实例须存活至播放完成（delegate/retain）；AppKit 经 Darwin carrier 已就绪（ext-badge 同族依赖）。
- 两个平台对 `playSound` 都是低成本（winmm / AppKit 均无新增链接依赖）→ 按 Owner 裁决规则做成**通用 API + 行为矩阵**，无需平台特供形态。
- 声音命令非模态、不阻塞——无 dialog 的模态集成问题；无 EventPort 需求（完成事件 v1 不做）。

## 决策（D1–D5；细节以 design-reference.md 为准）

| # | 决策 | 依据 |
|---|------|------|
| D1 | 包 `@opentray/ext-sound`，crate `crates/opentray-ext-sound`，embedded 单包内嵌四目标（复用 `add-ext-dialog` 批次 A 基建，不重复建设） | Owner 裁决原文；体积规范（2026-09-16）；薄封装预期 << 2MB |
| D2 | 能力面 = `beep(BeepKind)` + `playSystemSound(通用名 \| 平台原生名)` + `playSound(path)`；**playSound 成本结论：双平台低成本 → 通用 API**，win32 WAV-only（非 WAV typed `sound_format_unsupported` 前置拒绝） | Owner 成本规则的两分支裁决；PlaySound/NSSound 事实 |
| D3 | `playSystemSound` 解析顺序：通用名表 → 平台原生音名（darwin NSSound 目录 / win32 SND_ALIAS）→ miss 则 typed `sound_not_found`，绝不静默无声 | 「绝不静默降级」家族法则一致性 |
| D4 | 播放语义 = fire-and-forget：resolve 于播放**开始**；无完成事件（EventPort producer 留待需求证实）；session close 停止本 session 播放（NSSound.stop / PlaySound(NULL)） | 轻量优先；会话权威法则 |
| D5 | 流程：单 change，批次 A（spec 类型，embedded 基建依赖 add-ext-dialog 批次 A）→ B（crate 双平台）→ C（facade）→ D（staging + 体积门配置）→ E（验证 + 文档 + changeset） | 与 add-ext-dialog 同款编排 |

## 开放问题（默认假设先行，Codex 评审裁决）

| 问题 | 默认假设 |
|------|----------|
| 通用系统音名表的确切集合与双平台映射 | 提案 `'notification' \| 'warning' \| 'error'` 三名起步（映射见 design-reference §2.2），Codex 可增删 |
| win32 playSound 并发取消语义（PlaySound 进程级单声道）是否升格为显式 API | 不升格——文档化降级（后播放取消前播放），需求出现再议 |
| NSSound 播放完成后的实例回收机制 | delegate didFinishPlaying 回收；无 delegate 环境兜底定时探测 |

## 拒绝路径

| 路径 | 拒绝原因 |
|------|----------|
| 播放完成/进度事件（EventPort producer） | 需求未证实；v1 fire-and-forget 已覆盖 beep/系统音场景 |
| win32 压缩格式支持（Media Foundation） | 重依赖，违反「优先保持轻量」；WAV-only typed 拒绝是诚实边界 |
| 通用混音/多实例引擎、音量/循环控制 | 超出轻量系统能力原子范围；那是播放器/媒体包的领地 |
| beep 留在 ext-dialog | Owner 已裁决声音是独立能力词（2026-09-17） |
| 平台特供 playSound | 双平台均低成本，不满足「仅部分平台低成本」分支条件 |

## 实施计划（specs/tasks 追溯）

1. 批次 A：`@opentray/spec` 声音类型（BeepKind、SystemSoundName、SoundBackendCapabilities、typed 错误码）——embedded artifact kind 与 pack-size 审计**不重复建设**（add-ext-dialog 批次 A 交付，本 change 排在其后）。
2. 批次 B：crates/opentray-ext-sound——darwin（NSBeep/NSSound 目录与文件播放/实例回收）+ win32（MessageBeep/PlaySound SND_ALIAS 与 SND_FILENAME/session 停止）。
3. 批次 C：packages/ext-sound facade（attachSound、解析顺序校验、WAV 前置校验、contract.json、embedded 描述符）。
4. 批次 D：staging 到 `platforms/<target>/` + pack-size 配置。
5. 批次 E：双平台真机验证（可闻性不作为门，命令层语义验证为主）+ skills 公共文档 + changeset（minor）。
